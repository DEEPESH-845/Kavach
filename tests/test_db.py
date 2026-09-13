"""kavach.db: one connection shape, serialised writers, both engines."""

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


def test_pg_ddl_translation():
    src = ("PRAGMA foo;\nCREATE TABLE e (seq INTEGER PRIMARY KEY AUTOINCREMENT, "
           "n INTEGER NOT NULL, k BLOB);")
    out = db._pg_ddl(src)
    assert "PRAGMA" not in out
    assert "seq BIGSERIAL PRIMARY KEY" in out
    assert "n BIGINT NOT NULL" in out and "k BYTEA" in out
