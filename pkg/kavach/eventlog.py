"""Append-only event log with idempotent ingestion.

Everything Kavach believes is derived from this table and nothing else. A fact with no
event behind it is a fact we invented, so the evidence chain is enforced structurally:
truth.py may only cite event ids that exist here.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    seq              INTEGER PRIMARY KEY AUTOINCREMENT,
    source           TEXT    NOT NULL,   -- webhook | api_response | poll | agent_intent
    external_id      TEXT    NOT NULL,   -- x-razorpay-event-id, request id, or synthetic
    entity_type      TEXT    NOT NULL,   -- payment | refund | order | payout
    entity_id        TEXT    NOT NULL,   -- pay_xxx / rfnd_xxx
    event_type       TEXT    NOT NULL,   -- refund.processed, api.create_refund, ...
    payload          TEXT    NOT NULL,   -- raw json, never mutated
    occurred_at      INTEGER NOT NULL,   -- epoch seconds, from the source
    received_at      INTEGER NOT NULL,   -- epoch seconds, when we saw it
    sig_verified     INTEGER NOT NULL,   -- 0/1, HMAC checked for webhooks
    UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_events_entity
    ON events (entity_type, entity_id, occurred_at, seq);
"""


@dataclass(frozen=True)
class Event:
    seq: int
    source: str
    external_id: str
    entity_type: str
    entity_id: str
    event_type: str
    payload: dict[str, Any]
    occurred_at: int
    received_at: int
    sig_verified: bool


def connect(path: str = "kavach.db") -> sqlite3.Connection:
    conn = sqlite3.connect(path, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    return conn


def append(
    conn: sqlite3.Connection,
    *,
    source: str,
    external_id: str,
    entity_type: str,
    entity_id: str,
    event_type: str,
    payload: dict[str, Any],
    occurred_at: int,
    received_at: int,
    sig_verified: bool = False,
) -> tuple[int, bool]:
    """Append one event. Returns (seq, is_new).

    is_new is False when (source, external_id) was already ingested. Callers MUST branch on
    it: a redelivered webhook must not re-trigger downstream action. This is the replay
    guard. It is deliberately NOT the duplicate-intent guard -- that is ledger.py + risk.py,
    and conflating the two is the mistake the whole project exists to point at.
    """
    cur = conn.execute(
        "INSERT OR IGNORE INTO events "
        "(source, external_id, entity_type, entity_id, event_type, payload,"
        " occurred_at, received_at, sig_verified) VALUES (?,?,?,?,?,?,?,?,?)",
        (source, external_id, entity_type, entity_id, event_type,
         json.dumps(payload, sort_keys=True), occurred_at, received_at, int(sig_verified)),
    )
    if cur.rowcount == 1:
        return int(cur.lastrowid), True
    row = conn.execute(
        "SELECT seq FROM events WHERE source=? AND external_id=?", (source, external_id)
    ).fetchone()
    return int(row["seq"]), False


def _row_to_event(r: sqlite3.Row) -> Event:
    return Event(
        seq=r["seq"], source=r["source"], external_id=r["external_id"],
        entity_type=r["entity_type"], entity_id=r["entity_id"], event_type=r["event_type"],
        payload=json.loads(r["payload"]), occurred_at=r["occurred_at"],
        received_at=r["received_at"], sig_verified=bool(r["sig_verified"]),
    )


def for_entity(conn: sqlite3.Connection, entity_type: str, entity_id: str) -> list[Event]:
    """Events for one entity in causal order.

    Ordered by occurred_at then seq, NOT by arrival: Razorpay webhooks can and do arrive
    out of order, and a state machine fed arrival order will happily walk backwards.
    """
    rows = conn.execute(
        "SELECT * FROM events WHERE entity_type=? AND entity_id=? ORDER BY occurred_at, seq",
        (entity_type, entity_id),
    ).fetchall()
    return [_row_to_event(r) for r in rows]


def by_seq(conn: sqlite3.Connection, seqs: list[int]) -> list[Event]:
    """Fetch specific events by seq -- used to materialise an evidence chain."""
    if not seqs:
        return []
    q = ",".join("?" * len(seqs))
    rows = conn.execute(
        f"SELECT * FROM events WHERE seq IN ({q}) ORDER BY occurred_at, seq", seqs
    ).fetchall()
    return [_row_to_event(r) for r in rows]
