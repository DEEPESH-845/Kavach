# Phase 1 — Database layer, concurrency, migrations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `kavach.db.connect()` that opens SQLite or Postgres behind the same call-site shape, serialises writers correctly, and versions the schema — plus the backend bugs found in the audit.

**Architecture:** A thin `Connection` wrapper (`pkg/kavach/db.py`) over `sqlite3` / `psycopg` exposing `execute/executescript/fetch*`, dict-and-index rows, a nesting-aware `transaction()` (outermost = `BEGIN IMMEDIATE` / pg advisory lock; nested = SAVEPOINT), and DDL translation for the four dialect differences. All existing SQL stays SQLite-flavoured; the only runtime rewrite is `?`→`%s`. `INSERT OR IGNORE/REPLACE` become standard `ON CONFLICT` at their call sites (valid in both engines).

**Tech Stack:** Python 3.11+, stdlib `sqlite3` (≥3.35 for `RETURNING`), `psycopg[binary]>=3.1` as optional extra `kavach[postgres]`, pytest, GitHub Actions Postgres service.

**Spec:** `docs/superpowers/specs/2026-09-13-production-readiness-design.md` (§Phase 0, §1)

## Global Constraints

- Python `>=3.11`; ruff `E,F,I,UP,B,SIM`, line length 96. `ruff check pkg/ tests/ apps/` must pass.
- No new required dependency. `psycopg` is an optional extra only.
- Money is integer minor units everywhere. No float touches money.
- Every fix ships with one regression test in `tests/`.
- The hash chain semantics (`eventlog.append` hash inputs, `proof._expected`) do not change.
- Commit after every task with the attribution trailer from the session reminder.

---

### Task 1: `kavach.db` — Connection wrapper, rows, transactions (SQLite)

**Files:**
- Create: `pkg/kavach/db.py`
- Test: `tests/test_db.py`

**Interfaces:**
- Produces: `db.connect(target: str, *, same_thread: bool = True) -> Connection`; `Connection.execute(sql, params=()) -> Cursor`; `Connection.executescript(sql)`; `Connection.transaction() -> ContextManager`; `Connection.commit()/rollback()/close()`; `Connection.dialect: Literal["sqlite","postgres"]`; `db.IntegrityError` (exception tuple); `db.Row` (dict subclass with int indexing).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_db.py
from __future__ import annotations

import threading

import pytest
from kavach import db


def test_row_supports_name_and_index():
    c = db.connect(":memory:")
    c.executescript("CREATE TABLE t (a INTEGER, b TEXT)")
    c.execute("INSERT INTO t (a, b) VALUES (?, ?)", (1, "x"))
    r = c.execute("SELECT a, b FROM t").fetchone()
    assert r["a"] == 1 and r[1] == "x" and dict(r) == {"a": 1, "b": "x"}
    assert list(r.keys()) == ["a", "b"]


def test_transaction_commits_and_rolls_back():
    c = db.connect(":memory:")
    c.executescript("CREATE TABLE t (a INTEGER PRIMARY KEY)")
    with c.transaction():
        c.execute("INSERT INTO t (a) VALUES (1)")
    with pytest.raises(RuntimeError), c.transaction():
        c.execute("INSERT INTO t (a) VALUES (2)")
        raise RuntimeError("boom")
    assert [r["a"] for r in c.execute("SELECT a FROM t")] == [1]


def test_nested_transaction_is_a_savepoint():
    c = db.connect(":memory:")
    c.executescript("CREATE TABLE t (a INTEGER PRIMARY KEY)")
    with c.transaction():
        c.execute("INSERT INTO t (a) VALUES (1)")
        with pytest.raises(RuntimeError), c.transaction():
            c.execute("INSERT INTO t (a) VALUES (2)")
            raise RuntimeError("inner")
        c.execute("INSERT INTO t (a) VALUES (3)")
    assert [r["a"] for r in c.execute("SELECT a FROM t ORDER BY a")] == [1, 3]


def test_integrity_error_is_catchable():
    c = db.connect(":memory:")
    c.executescript("CREATE TABLE t (a INTEGER PRIMARY KEY)")
    c.execute("INSERT INTO t (a) VALUES (1)")
    with pytest.raises(db.IntegrityError):
        c.execute("INSERT INTO t (a) VALUES (1)")


def test_concurrent_writers_serialise(tmp_path):
    """Two connections both inside transaction(): the second waits, neither fails."""
    path = str(tmp_path / "w.db")
    db.connect(path).executescript("CREATE TABLE t (a INTEGER PRIMARY KEY AUTOINCREMENT)")
    errors: list[BaseException] = []

    def writer():
        try:
            c = db.connect(path)
            for _ in range(25):
                with c.transaction():
                    c.execute("INSERT INTO t DEFAULT VALUES")
        except BaseException as e:  # noqa: BLE001
            errors.append(e)

    ts = [threading.Thread(target=writer) for _ in range(4)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert errors == []
    assert db.connect(path).execute("SELECT COUNT(*) c FROM t").fetchone()["c"] == 100


def test_on_conflict_do_nothing_reports_rowcount():
    c = db.connect(":memory:")
    c.executescript("CREATE TABLE t (a INTEGER PRIMARY KEY)")
    assert c.execute("INSERT INTO t (a) VALUES (1) ON CONFLICT DO NOTHING").rowcount == 1
    assert c.execute("INSERT INTO t (a) VALUES (1) ON CONFLICT DO NOTHING").rowcount == 0
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_db.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'kavach.db'`

- [ ] **Step 3: Implement `pkg/kavach/db.py`**

```python
"""One connection shape over SQLite and Postgres.

Every call site in Kavach writes `conn.execute(sql, params)` with `?` placeholders and reads
rows by column name. That shape is kept; this module makes it true of Postgres as well.

What is translated, and nothing else:
  * `?` -> `%s` at execute time (Postgres only). SQL text stays SQLite-flavoured.
  * DDL: `INTEGER PRIMARY KEY AUTOINCREMENT` -> `BIGSERIAL PRIMARY KEY`, `INTEGER` ->
    `BIGINT`, `BLOB` -> `BYTEA` (Postgres only). `PRAGMA` lines are dropped.
Upserts are written as `ON CONFLICT ...` at the call sites, which both engines accept.

Writers serialise through `transaction()`. The outermost level takes the engine's write
lock -- `BEGIN IMMEDIATE` on SQLite, one advisory lock on Postgres -- so two appends to the
hash chain can never read the same head. Nested levels are SAVEPOINTs. The old code opened a
deferred SAVEPOINT and, under a concurrent writer, failed with SQLITE_BUSY_SNAPSHOT instead
of waiting; that is the bug this module closes.
ponytail: one global writer lock per engine. Per-table locks if write throughput matters.
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, Literal

Dialect = Literal["sqlite", "postgres"]

_PG_PREFIXES = ("postgres://", "postgresql://")
#: Serialises every writer on Postgres. Arbitrary constant, must be stable.
_PG_WRITER_LOCK = 0x4B415641  # "KAVA"

try:  # optional extra: pip install kavach[postgres]
    import psycopg
    IntegrityError: tuple[type[Exception], ...] = (sqlite3.IntegrityError,
                                                  psycopg.IntegrityError)
except ImportError:  # pragma: no cover - exercised only without the extra
    psycopg = None
    IntegrityError = (sqlite3.IntegrityError,)


class Row(dict):
    """A row addressable by column name or position, on both engines."""

    def __getitem__(self, key):  # type: ignore[override]
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


def _sqlite_row(cursor: sqlite3.Cursor, values: tuple) -> Row:
    return Row(zip([d[0] for d in cursor.description], values, strict=True))


def _pg_row(cursor):  # psycopg RowFactory
    names = [d.name for d in cursor.description] if cursor.description else []

    def make(values):
        return Row(zip(names, values, strict=True))
    return make


_DDL = (
    (re.compile(r"INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT", re.I), "BIGSERIAL PRIMARY KEY"),
    (re.compile(r"\bINTEGER\b", re.I), "BIGINT"),
    (re.compile(r"\bBLOB\b", re.I), "BYTEA"),
)


def _pg_ddl(script: str) -> str:
    lines = [ln for ln in script.splitlines() if not ln.strip().upper().startswith("PRAGMA")]
    out = "\n".join(lines)
    for pat, rep in _DDL:
        out = pat.sub(rep, out)
    return out


class Connection:
    def __init__(self, raw: Any, dialect: Dialect):
        self._raw = raw
        self.dialect: Dialect = dialect
        self._depth = 0

    # ------------------------------------------------------------ statements
    def execute(self, sql: str, params: Any = ()) -> Any:
        if self.dialect == "postgres":
            sql = sql.replace("?", "%s")
            cur = self._raw.cursor()
            cur.execute(sql, params)
            return cur
        return self._raw.execute(sql, params)

    def executescript(self, script: str) -> None:
        if self.dialect == "postgres":
            with self._raw.cursor() as cur:
                cur.execute(_pg_ddl(script))
            return
        self._raw.executescript(script)

    # ------------------------------------------------------------ transactions
    @contextmanager
    def transaction(self) -> Iterator[None]:
        """Outermost: the engine's write lock. Nested: a savepoint. Commit on exit,
        roll back on any exception, on both levels."""
        if self._depth == 0:
            if self.dialect == "postgres":
                self._raw.autocommit = False
                self.execute("SELECT pg_advisory_xact_lock(?)", (_PG_WRITER_LOCK,))
            else:
                self._raw.execute("BEGIN IMMEDIATE")
            self._depth = 1
            try:
                yield
            except BaseException:
                self._raw.rollback()
                raise
            else:
                self._raw.commit()
            finally:
                self._depth = 0
                if self.dialect == "postgres":
                    self._raw.autocommit = True
            return
        name = f"sp{self._depth}"
        self._depth += 1
        self._raw.execute(f"SAVEPOINT {name}") if self.dialect == "sqlite" \
            else self.execute(f"SAVEPOINT {name}")
        try:
            yield
        except BaseException:
            self.execute(f"ROLLBACK TO SAVEPOINT {name}")
            raise
        else:
            self.execute(f"RELEASE SAVEPOINT {name}")
        finally:
            self._depth -= 1

    @property
    def in_transaction(self) -> bool:
        return self._depth > 0

    def commit(self) -> None:
        self._raw.commit()

    def rollback(self) -> None:
        self._raw.rollback()

    def close(self) -> None:
        self._raw.close()

    # sqlite-only escape hatch used by the tamper demo's in-memory copy
    def backup(self, target: Connection) -> None:
        if self.dialect != "sqlite" or target.dialect != "sqlite":
            raise NotImplementedError("backup() is SQLite-only; use rows()")
        self._raw.backup(target._raw)


def connect(target: str = "kavach.db", *, same_thread: bool = True) -> Connection:
    """Open the store. `target` is a SQLite path (or ":memory:") or a postgres:// URL.

    `same_thread=False` relaxes sqlite3's thread-affinity guard and must only be passed by a
    caller that gives each unit of work its OWN connection (the HTTP API does: a request's
    handler and its teardown may land on different threadpool workers, sequentially).
    """
    if target.startswith(_PG_PREFIXES):
        if psycopg is None:
            raise RuntimeError("KAVACH_DB is a postgres URL but psycopg is not installed; "
                               "pip install 'kavach[postgres]'")
        raw = psycopg.connect(target, autocommit=True, row_factory=_pg_row)
        return Connection(raw, "postgres")
    if sqlite3.sqlite_version_info < (3, 35, 0):
        raise RuntimeError(f"SQLite {sqlite3.sqlite_version} is too old; 3.35+ is needed "
                           "for RETURNING")
    raw = sqlite3.connect(target, isolation_level=None, check_same_thread=same_thread,
                          timeout=30.0)
    raw.row_factory = _sqlite_row
    raw.execute("PRAGMA journal_mode=WAL")
    raw.execute("PRAGMA foreign_keys=ON")
    raw.execute("PRAGMA busy_timeout=30000")
    return Connection(raw, "sqlite")
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_db.py -q`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add pkg/kavach/db.py tests/test_db.py
git commit -m "feat(db): one connection shape over SQLite and Postgres with serialised writers"
```

---

### Task 2: Route `eventlog.connect` through `db.connect`; append uses `transaction()` + `RETURNING`

**Files:**
- Modify: `pkg/kavach/eventlog.py` (connect, append)
- Modify: `pkg/kavach/proof.py:26` type hint only (`sqlite3.Row` → `Any`)
- Test: `tests/test_eventlog.py` (add), `tests/test_db.py` (add)

**Interfaces:**
- Consumes: `db.connect`, `Connection.transaction()`
- Produces: `eventlog.connect(path, *, same_thread=True) -> db.Connection` (unchanged signature, now returns the wrapper); `eventlog.append(...) -> tuple[int, bool]` (unchanged).

- [ ] **Step 1: Write the failing test** — concurrent appends on a file DB all succeed and the chain stays intact.

```python
# append to tests/test_eventlog.py
import threading

from kavach import proof
from kavach.eventlog import append, connect


def test_concurrent_appends_serialise_and_chain_holds(tmp_path):
    path = str(tmp_path / "chain.db")
    connect(path).close()
    errors: list[BaseException] = []

    def writer(n: int):
        try:
            c = connect(path)
            for i in range(20):
                append(c, source="t", external_id=f"{n}:{i}", entity_type="payment",
                       entity_id=f"pay_{n}", event_type="x", payload={"i": i},
                       occurred_at=1, received_at=1)
        except BaseException as e:  # noqa: BLE001
            errors.append(e)

    ts = [threading.Thread(target=writer, args=(n,)) for n in range(5)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert errors == []
    status = proof.scan(connect(path))
    assert status["ok"] and status["events"] == 100
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_eventlog.py::test_concurrent_appends_serialise_and_chain_holds -q`
Expected: FAIL — `errors` contains `sqlite3.OperationalError: database is locked` (or the SAVEPOINT snapshot error).

- [ ] **Step 3: Rewrite `connect` and `append` in `pkg/kavach/eventlog.py`**

Replace the `connect` function body and the whole `append` function:

```python
from . import db


def connect(path: str = "kavach.db", *, same_thread: bool = True) -> db.Connection:
    """Open the log and make sure its table exists. See kavach.db for what `same_thread`
    permits and what it does not."""
    conn = db.connect(path, same_thread=same_thread)
    conn.executescript(SCHEMA)
    return conn


def append(conn: db.Connection, *, source: str, external_id: str, entity_type: str,
           entity_id: str, event_type: str, payload: dict[str, Any], occurred_at: int,
           received_at: int, sig_verified: bool = False,
           parent_entity_id: str | None = None) -> tuple[int, bool]:
    """Append one event, hash-chained to the current head. Returns (seq, is_new).

    Runs inside conn.transaction(): the outermost level takes the engine's write lock, so
    the head read here is the head this row is chained to. A duplicate (source, external_id)
    is ignored and its existing seq returned -- ingestion is idempotent.
    """
    payload_str = json.dumps(payload, sort_keys=True)
    with conn.transaction():
        prev = conn.execute("SELECT event_hash FROM events ORDER BY seq DESC LIMIT 1").fetchone()
        prev_hash = prev["event_hash"] if prev else None
        h = hashlib.sha256()
        if prev_hash:
            h.update(prev_hash.encode())
        h.update(f"{source}:{external_id}:{entity_type}:{entity_id}:{event_type}:"
                 f"{payload_str}:{occurred_at}:{int(sig_verified)}".encode())
        if parent_entity_id:
            h.update(parent_entity_id.encode())
        event_hash = h.hexdigest()
        row = conn.execute(
            "INSERT INTO events (source, external_id, entity_type, entity_id, "
            "parent_entity_id, event_type, payload, occurred_at, received_at, sig_verified, "
            "previous_event_hash, event_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT (source, external_id) DO NOTHING RETURNING seq",
            (source, external_id, entity_type, entity_id, parent_entity_id, event_type,
             payload_str, occurred_at, received_at, int(sig_verified), prev_hash, event_hash),
        ).fetchone()
        if row is not None:
            return int(row["seq"]), True
        row = conn.execute("SELECT seq FROM events WHERE source=? AND external_id=?",
                           (source, external_id)).fetchone()
        return int(row["seq"]), False
```

Move `import hashlib` to the module imports; remove `import sqlite3` if nothing else uses it (keep `sqlite3.Row` references replaced by `db.Row`). In `_row_to_event`, the parameter type becomes `db.Row`.

- [ ] **Step 4: Run the whole suite**

Run: `python -m pytest tests/ -q`
Expected: all pass (the new test included). If `tests/test_concurrency.py` fails because it builds a raw `sqlite3.connect(":memory:")`, that is fixed in Task 5 — note it and continue.

- [ ] **Step 5: Commit**

```bash
git add pkg/kavach/eventlog.py pkg/kavach/proof.py tests/test_eventlog.py
git commit -m "fix(eventlog): serialise concurrent appends with an immediate transaction; route connect through kavach.db"
```

---

### Task 3: Replace raw SAVEPOINT / BEGIN EXCLUSIVE sites with `transaction()`; upserts to `ON CONFLICT`

**Files:**
- Modify: `pkg/kavach/services/decisions.py:127-146`
- Modify: `pkg/kavach/services/stepup.py:153-213`
- Modify: `pkg/kavach/services/review.py:75-90`
- Modify: `pkg/kavach/gate/envelope.py:91-97,159`
- Modify: `pkg/kavach/services/checkout.py:145`
- Modify: `pkg/kavach/ledger.py:66` (`except db.IntegrityError`)
- Test: existing suites cover these paths; add `tests/test_envelope.py::test_register_issuer_replaces_key`

**Interfaces:**
- Consumes: `Connection.transaction()`, `db.IntegrityError`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_envelope.py
def test_register_issuer_replaces_key(conn):
    from kavach.gate import envelope
    envelope.register_issuer(conn, "k1", b"\x01" * 32)
    envelope.register_issuer(conn, "k1", b"\x02" * 32)
    row = conn.execute("SELECT public_key FROM gate_issuers WHERE key_id='k1'").fetchone()
    assert bytes(row["public_key"]) == b"\x02" * 32
```

- [ ] **Step 2: Run** — passes already on SQLite (`INSERT OR REPLACE`); it exists to hold the behaviour through the rewrite. Run: `python -m pytest tests/test_envelope.py -q` → PASS.

- [ ] **Step 3: Rewrite each site**

`decisions.record`:
```python
    payload = decision.to_dict()
    with conn.transaction():
        out = governor.reserve(conn, intent, decision)
        seq, _ = append(conn, source="governor", external_id=f"decision:{intent.intent_id}",
                        entity_type="intent", entity_id=intent.intent_id,
                        parent_entity_id=intent.target_id,
                        event_type=f"{DECIDED}.{decision.action.value.lower()}",
                        payload={... unchanged ...},
                        occurred_at=now, received_at=now, sig_verified=False)
    return {**out, "intent_id": intent.intent_id, "decision_event_seq": seq}
```

`review.act`: replace `conn.execute("SAVEPOINT review")` … `except Exception: ROLLBACK` with `with conn.transaction():` around the append + settle.

`stepup.resolve`: replace the SAVEPOINT block with `with conn.transaction():`; drop the two `conn.execute("RELEASE SAVEPOINT stepup_resolve")` lines before the `raise StepUpError(...)` (a raise inside the block rolls back, and nothing was written before either raise). Remove the `except StepUpError: raise / except Exception: rollback` tail.

`envelope.register_issuer`:
```python
    conn.execute("INSERT INTO gate_issuers (key_id, public_key) VALUES (?,?) "
                 "ON CONFLICT (key_id) DO UPDATE SET public_key=excluded.public_key",
                 (key_id, public_key))
```
`envelope.revoke`:
```python
    conn.execute("INSERT INTO gate_revocations (mandate_id, revoked_at, reason) VALUES (?,?,?) "
                 "ON CONFLICT (mandate_id) DO UPDATE SET revoked_at=excluded.revoked_at, "
                 "reason=excluded.reason", (mandate_id, at, reason))
```
`envelope.claim_nonce_for_env`: `"INSERT INTO gate_nonces (nonce, mandate_id, claimed_at) VALUES (?,?,?) ON CONFLICT DO NOTHING"`.

`checkout.start`: `"INSERT INTO checkouts (...) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING"`.

`ledger.record`: `except db.IntegrityError as e:` with `from . import db`.

Grep to confirm nothing is left: `grep -rn "INSERT OR\|SAVEPOINT" pkg/kavach` → only the comment in `db.py`.

- [ ] **Step 4: Run** `python -m pytest tests/ -q` → all pass; `ruff check pkg/ tests/ apps/` → clean.

- [ ] **Step 5: Commit**

```bash
git add pkg/kavach
git commit -m "refactor(db): transactions through Connection.transaction(); upserts as ON CONFLICT"
```

---

### Task 4: Dialect-neutral demo reset and tamper copy; MCP server opens a connection per call

**Files:**
- Modify: `pkg/kavach/services/demo.py:105-111` (clear)
- Modify: `pkg/kavach/services/tamper.py:73-75`
- Modify: `pkg/kavach/mcp/server.py` (remove import-time `_conn`; every tool opens its own)
- Modify: `tests/test_concurrency.py` (fixture uses a tmp file DB and `server._DB`)
- Test: `tests/test_mcp_http.py` (existing), `tests/test_concurrency.py`

**Interfaces:**
- Produces: `mcp.server._open() -> ContextManager[db.Connection]`; `mcp.server._DB: str` (module variable tests may point at a temp file).

- [ ] **Step 1: Update the concurrency test fixture to the new shape**

```python
@pytest.fixture
def conn(tmp_path, monkeypatch):
    path = str(tmp_path / "race.db")
    monkeypatch.setattr(server, "_DB", path)
    c = eventlog.connect(path)
    ledger.init(c)
    eventlog.append(c, source="api", external_id="pay_1_create", entity_type="payment",
                    entity_id="pay_1", event_type="api.payment.captured",
                    payload={"id": "pay_1", "status": "captured", "amount": 10000},
                    occurred_at=1000, received_at=1000)
    server._policy = Policy()
    yield c
    c.close()
```

Run: `python -m pytest tests/test_concurrency.py -q` → FAIL (`server._conn` still used).

- [ ] **Step 2: Rewrite the MCP module's connection handling**

Replace lines 62–66 (`_DB`, `_conn = connect(...)`, `ledger.init`, `envelope.init`) with:

```python
_DB = os.environ.get("KAVACH_DB", "kavach.db")


@contextmanager
def _open() -> Iterator[db.Connection]:
    """One connection per tool call, closed when it returns. Opening is microseconds on
    SQLite and lets `uvicorn --workers N` run this module in every worker."""
    conn = connect(_DB, same_thread=False)
    try:
        ledger.init(conn)
        envelope.init(conn)
        yield conn
    finally:
        conn.close()
```

Then in every tool replace the `_conn` uses: wrap the body in `with _open() as conn:` and substitute `conn` for `_conn`. For `create_refund`:

```python
    with _open() as conn:
        if ledger.fact_for(conn, "payment", payment_id, _now()) is None:
            _ingest(conn, "payment", _client.fetch_payment(payment_id))
        with conn.transaction():
            intent = governor.new_intent(agent_id, session_id, payment_id, parse_inr(amount),
                                         reason, _now())
            d, _truth = decisions.evaluate(conn, intent, now=_now(), policy=_policy,
                                           model=_model)
            out = decisions.record(conn, intent, d, now=_now())
        if d.action == governor.Action.ALLOW:
            out = governor.execute_provider(conn, _client, intent, d)
            if out.get("refund_id"):
                _ingest(conn, "refund", _client.fetch_refund(out["refund_id"]))
    out["intent_id"] = intent.intent_id
    return out
```

`_ingest` and `_ingest_checkout` gain a leading `conn` parameter. Add `from contextlib import contextmanager`, `from collections.abc import Callable, Iterator`, `from .. import db`.

- [ ] **Step 3: Demo reset and tamper copy**

`demo.clear`:
```python
    for table in ("intents", "events", "gate_nonces", "gate_revocations", "stepups",
                  "checkouts"):
        conn.execute(f"DELETE FROM {table}")
    if conn.dialect == "sqlite":
        conn.execute("DELETE FROM sqlite_sequence WHERE name='events'")
    else:
        conn.execute("ALTER SEQUENCE events_seq_seq RESTART WITH 1")
```

`tamper.demo` — replace the `sqlite3.connect(":memory:")` + `conn.backup(mem)` with a row copy that works on either engine:
```python
    mem = db.connect(":memory:")
    mem.executescript(eventlog.SCHEMA)
    cols = ("seq", "source", "external_id", "entity_type", "entity_id", "parent_entity_id",
            "event_type", "payload", "occurred_at", "received_at", "sig_verified",
            "previous_event_hash", "event_hash")
    for r in conn.execute(f"SELECT {', '.join(cols)} FROM events ORDER BY seq"):
        mem.execute(f"INSERT INTO events ({', '.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                    tuple(r[c] for c in cols))
```
Remove `import sqlite3` from tamper.py; add `from .. import db, eventlog`.

- [ ] **Step 4: Run** `python -m pytest tests/ -q` and `ruff check pkg/ tests/ apps/` → green.

- [ ] **Step 5: Commit**

```bash
git add pkg/kavach tests/test_concurrency.py
git commit -m "fix(mcp): open a connection per tool call instead of at import; dialect-neutral reset and tamper copy"
```

---

### Task 5: Schema migrations table

**Files:**
- Create: `pkg/kavach/migrations.py`
- Modify: `pkg/kavach/services/demo.py:97-103` (`init_all` calls `migrations.apply`)
- Modify: `apps/api_server.py:172-190` (`_open` calls `migrations.apply`)
- Test: `tests/test_migrations.py`

**Interfaces:**
- Produces: `migrations.apply(conn) -> list[int]` (versions applied this call); `migrations.MIGRATIONS: list[tuple[int, str, str]]` (version, name, SQL). Later phases append `(2, "api_keys", ...)` etc.

- [ ] **Step 1: Failing test**

```python
# tests/test_migrations.py
from kavach import migrations
from kavach.eventlog import connect


def test_apply_is_idempotent_and_records_versions():
    c = connect(":memory:")
    first = migrations.apply(c)
    assert first == [v for v, _, _ in migrations.MIGRATIONS]
    assert migrations.apply(c) == []
    rows = c.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
    assert [r["version"] for r in rows] == first
```

Run: `python -m pytest tests/test_migrations.py -q` → FAIL (no module).

- [ ] **Step 2: Implement**

```python
"""Ordered, recorded schema changes.

Every module still creates its own tables with CREATE TABLE IF NOT EXISTS -- that is fine
for a table that never changes shape. Anything that ALTERs an existing table, or adds one a
later feature depends on, lands here as a numbered step so a ledger written by one version
is upgraded exactly once by the next.
"""

from __future__ import annotations

import time

from . import db

SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at INTEGER NOT NULL
);
"""

#: (version, name, SQL). Append only. SQL is dialect-neutral DDL (see db._pg_ddl).
MIGRATIONS: list[tuple[int, str, str]] = [
    (1, "baseline", "SELECT 1"),
]


def apply(conn: db.Connection) -> list[int]:
    conn.executescript(SCHEMA)
    done = {r["version"] for r in conn.execute("SELECT version FROM schema_migrations")}
    applied: list[int] = []
    for version, name, sql in MIGRATIONS:
        if version in done:
            continue
        with conn.transaction():
            conn.executescript(sql)
            conn.execute("INSERT INTO schema_migrations (version, name, applied_at) "
                         "VALUES (?,?,?)", (version, name, int(time.time())))
        applied.append(version)
    return applied
```

Wire it: in `demo.init_all` add `migrations.apply(conn)` after `checkout.init(conn)`; in `api_server._open` add `migrations.apply(conn)` after `checkout.init(conn)`.

- [ ] **Step 3: Run** the suite → green. **Step 4: Commit** `feat(db): schema_migrations table and ordered migration list`.

---

### Task 6: API server fixes — thread-safe counter, CORS `Authorization`, workers, incremental chain verify

**Files:**
- Modify: `apps/api_server.py:97-105` (CORS), `:107-135` (counter), `:360-395` (health), `:876-896` (metrics), `:929-947` (main)
- Modify: `pkg/kavach/proof.py` (add `verify_head(conn)` incremental cache)
- Test: `tests/test_proof.py` (add), `tests/test_api_journey.py` (add CORS preflight check)

**Interfaces:**
- Produces: `proof.status(conn) -> dict` — same shape as `scan()` but verifies only rows appended since the last verified head, per process. `scan()` stays the full walk and is what `/api/proof/verify` calls.

- [ ] **Step 1: Failing tests**

```python
# append to tests/test_proof.py
from kavach import proof


def test_status_is_incremental_and_detects_later_tamper(conn, refund_event):
    refund_event("rfnd_1", "processed", 10)
    s1 = proof.status(conn)
    assert s1["ok"] and s1["events"] == 1
    refund_event("rfnd_2", "processed", 20)
    s2 = proof.status(conn)
    assert s2["ok"] and s2["events"] == 2 and s2["checked"] == 2
    conn.execute("UPDATE events SET payload='{}' WHERE seq=2")
    refund_event("rfnd_3", "processed", 30)
    s3 = proof.status(conn)
    assert not s3["ok"] and s3["broken_at"] == 3   # seq 3 chained to a hash that no longer reproduces
```

Note on the last assertion: `status()` re-verifies from the last verified head (seq 2, hash h2). Row 3 stored `previous_event_hash == h2` and chains correctly to h2, so an incremental walk from the cached head **cannot** see the edit at seq 2. This is the honest limit of an incremental check: it proves rows appended since the head chain to it, not that earlier rows are intact. The test therefore asserts the *documented* behaviour instead:

```python
    assert s3["ok"] and s3["events"] == 3 and s3["incremental"] is True
    full = proof.scan(conn)
    assert not full["ok"] and full["broken_at"] == 2
```

```python
# append to tests/test_api_journey.py
def test_cors_preflight_allows_authorization(client):
    r = client.options("/api/overview", headers={
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization"})
    assert r.status_code == 200
    assert "authorization" in r.headers["access-control-allow-headers"].lower()
```

(Use the `client` fixture the file already defines; if it is named differently, use that name.)

- [ ] **Step 2: Implement**

`proof.py` — add after `scan`:

```python
#: Per-process verified head: (seq, hash, events counted). A health check every 30 s must
#: not walk a million rows; it walks what arrived since the last check.
_head: tuple[int, str] | None = None
_head_lock = threading.Lock()


def status(conn) -> dict[str, Any]:
    """Chain status for health/metrics: verifies rows appended since the last verified head.

    Proves that new rows chain to the head this process last verified. It does NOT re-prove
    rows before that head -- `scan()` does, and /api/proof/verify calls it. Reported as
    `incremental: True` so a reader knows which claim they are holding.
    """
    global _head
    with _head_lock:
        since, prev_hash = _head if _head else (0, None)
        rows = conn.execute("SELECT * FROM events WHERE seq > ? ORDER BY seq",
                            (since,)).fetchall()
        total = conn.execute("SELECT COUNT(*) c, COALESCE(MAX(seq),0) m FROM events").fetchone()
        if int(total["m"]) < since:          # the log was reset underneath us
            _head, since, prev_hash = None, 0, None
            rows = conn.execute("SELECT * FROM events ORDER BY seq").fetchall()
        checked = 0
        for r in rows:
            if _expected(r, prev_hash) != r["event_hash"] or r["previous_event_hash"] != prev_hash:
                return {"ok": False, "events": int(total["c"]), "checked": since + checked,
                        "broken_at": int(r["seq"]), "head_hash": prev_hash,
                        "incremental": True}
            prev_hash, checked = r["event_hash"], checked + 1
        if rows:
            _head = (int(rows[-1]["seq"]), prev_hash)
        return {"ok": True, "events": int(total["c"]), "checked": since + checked,
                "broken_at": None, "head_hash": prev_hash, "incremental": True}
```

Add `import threading`. Check `scan()`'s return keys and make `status()` return the same keys plus `incremental`.

`api_server.py`:
- CORS: `allow_headers=["Content-Type", "Authorization", "X-Request-Id"]`, `allow_methods=["GET", "POST", "DELETE", "OPTIONS"]`.
- Counter: replace `global _requests; _requests += 1` with `_requests = itertools.count()` at module level and `next(_requests)` in the middleware; metrics reads a separate `_served = itertools.count()`… simpler: keep one `threading.Lock`-free `itertools.count()` named `_request_counter` and expose `_requests_total()` that peeks via a second counter. Concretely:

```python
_request_counter = itertools.count(1)
_requests_served = 0

@app.middleware("http")
async def _request_id_and_limits(request, call_next):
    global _requests_served
    _requests_served = next(_request_counter)   # atomic under the GIL; last value wins
    ...
```
- Health and metrics call `proof.status(conn)` instead of `proof.scan(conn)`; `/api/proof/verify` keeps `scan`.
- `main()`: read `KAVACH_WORKERS` (default 1); if >1 call `uvicorn.run("apps.api_server:app", workers=n, ...)` (string import path is required for workers) else the existing call. Add `--workers` CLI flag mirroring the env.

- [ ] **Step 3: Run** suite + ruff → green. **Step 4: Commit** `fix(api): incremental chain check for health, CORS Authorization, workers flag, atomic request counter`.

---

### Task 7: Postgres extra, CI matrix job, test hook, docs

**Files:**
- Modify: `pyproject.toml` (`[project.optional-dependencies] postgres = ["psycopg[binary]>=3.1"]`)
- Modify: `tests/conftest.py` (`conn` fixture honours `KAVACH_TEST_PG`)
- Modify: `.github/workflows/ci.yml` (new `postgres` job)
- Modify: `documents/11-deploy.md` (KAVACH_DB accepts a URL; section "Postgres")
- Modify: `.env.example` (KAVACH_DB comment)

- [ ] **Step 1: conftest**

```python
@pytest.fixture
def conn():
    url = os.environ.get("KAVACH_TEST_PG")
    c = connect(url or ":memory:")
    if url:
        for t in ("events", "intents", "gate_issuers", "gate_nonces", "gate_revocations",
                  "stepups", "checkouts", "schema_migrations"):
            c.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
        c.close()
        c = connect(url)
    ledger.init(c)
    envelope.init(c)
    yield c
    c.close()
```

`_no_ambient_credentials` must not delete `KAVACH_TEST_PG`.

- [ ] **Step 2: CI job**

```yaml
  postgres:
    runs-on: ubuntu-latest
    services:
      pg:
        image: postgres:16
        env: { POSTGRES_PASSWORD: kavach, POSTGRES_DB: kavach }
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -e ".[dev,postgres]"
      - run: pytest tests/test_db.py tests/test_eventlog.py tests/test_ledger.py tests/test_governor.py tests/test_envelope.py tests/test_proof.py tests/test_migrations.py -q
        env: { KAVACH_TEST_PG: "postgresql://postgres:kavach@localhost:5432/kavach" }
```

- [ ] **Step 3: Run locally** if Postgres is available (`brew services list | grep postgres` or `docker run -d -e POSTGRES_PASSWORD=kavach -p 5432:5432 postgres:16`); otherwise note that the pg path is verified in CI on the next push. Fix any dialect issue the run surfaces (`%` in SQL, `RETURNING`, DDL).

- [ ] **Step 4: Docs** — in `documents/11-deploy.md` env table, `KAVACH_DB`: "a file path (SQLite, WAL) or a `postgresql://` URL (needs `pip install 'kavach[postgres]'`; the image includes it)". Add the extra to the Dockerfile `pip install ".[postgres]"`. Update the README "Scaling shape" bullet that says the Postgres adapter is not written.

- [ ] **Step 5: Commit** `feat(db): Postgres extra, CI job, deploy docs`.

---

## Self-review

- Spec §Phase 0 items: append concurrency (T2), MCP import-time connection (T4), counter/CORS (T6), image default `KAVACH_DEMO` — **moved to Phase 2** with auth, where flipping it is safe. UI verification — Phase 6.
- Spec §1: shim (T1), migrations (T5), pg tests in CI (T7). `INSERT OR REPLACE` → `ON CONFLICT (pk) DO UPDATE` (T3).
- Type consistency: `db.Connection`, `conn.transaction()`, `db.IntegrityError`, `migrations.apply(conn)`, `proof.status(conn)`, `mcp.server._open()` used consistently.
