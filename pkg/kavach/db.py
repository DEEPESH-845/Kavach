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

try:  # optional extra: pip install 'kavach[postgres]'
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
            cur = self._raw.cursor()
            cur.execute(sql.replace("?", "%s"), params)
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
        """Outermost: the engine's write lock. Nested: a savepoint. Commit on exit, roll
        back on any exception, at both levels."""
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
        self.execute(f"SAVEPOINT {name}")
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
