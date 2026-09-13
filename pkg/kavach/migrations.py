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
    """Apply every migration not yet recorded, in order. Returns the versions applied."""
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
