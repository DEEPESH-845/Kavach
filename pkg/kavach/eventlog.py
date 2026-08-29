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
    parent_entity_id TEXT,               -- payment_id for a refund, etc.
    event_type       TEXT    NOT NULL,   -- refund.processed, api.create_refund, ...
    payload          TEXT    NOT NULL,   -- raw json, never mutated
    occurred_at      INTEGER NOT NULL,   -- epoch seconds, from the source
    received_at      INTEGER NOT NULL,   -- epoch seconds, when we saw it
    sig_verified     INTEGER NOT NULL,   -- 0/1, HMAC checked for webhooks
    previous_event_hash TEXT,            -- cryptographic chain link
    event_hash       TEXT    NOT NULL,   -- sha256 of this event + previous hash
    UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_events_entity
    ON events (entity_type, entity_id, occurred_at, seq);
CREATE INDEX IF NOT EXISTS idx_events_parent
    ON events (parent_entity_id) WHERE parent_entity_id IS NOT NULL;
"""


@dataclass(frozen=True)
class Event:
    seq: int
    source: str
    external_id: str
    entity_type: str
    entity_id: str
    parent_entity_id: str | None
    event_type: str
    payload: dict[str, Any]
    occurred_at: int
    received_at: int
    sig_verified: bool
    previous_event_hash: str | None
    event_hash: str


def connect(path: str = "kavach.db", *, same_thread: bool = True) -> sqlite3.Connection:
    """Open the log.

    `same_thread=False` relaxes sqlite3's thread-affinity guard and must only be passed by a
    caller that gives each unit of work its OWN connection. The HTTP API needs it because a
    threadpool may run a request handler on one thread and the teardown that closes its
    connection on another -- sequentially, never concurrently. Sharing one connection across
    threads that actually run at the same time is still unsafe, and the guard stays on by
    default so nothing acquires that behaviour by accident.
    """
    conn = sqlite3.connect(path, isolation_level=None, check_same_thread=same_thread)
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
    parent_entity_id: str | None = None,
) -> tuple[int, bool]:
    import hashlib
    payload_str = json.dumps(payload, sort_keys=True)
    
    conn.execute("SAVEPOINT append_event")
    try:
        prev = conn.execute(
            "SELECT event_hash FROM events ORDER BY seq DESC LIMIT 1"
        ).fetchone()
        prev_hash = prev["event_hash"] if prev else None

        h = hashlib.sha256()
        if prev_hash:
            h.update(prev_hash.encode())
        h.update(f"{source}:{external_id}:{entity_type}:{entity_id}:{event_type}:{payload_str}:{occurred_at}:{int(sig_verified)}".encode())
        if parent_entity_id:
            h.update(parent_entity_id.encode())
        event_hash = h.hexdigest()

        cur = conn.execute(
            "INSERT OR IGNORE INTO events "
            "(source, external_id, entity_type, entity_id, parent_entity_id, event_type, "
            "payload, occurred_at, received_at, sig_verified, previous_event_hash, "
            "event_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (source, external_id, entity_type, entity_id, parent_entity_id, event_type,
             payload_str, occurred_at, received_at, int(sig_verified), prev_hash, event_hash),
        )
        if cur.rowcount == 1:
            conn.execute("RELEASE SAVEPOINT append_event")
            return int(cur.lastrowid), True

        row = conn.execute(
            "SELECT seq FROM events WHERE source=? AND external_id=?", (source, external_id)
        ).fetchone()
        conn.execute("RELEASE SAVEPOINT append_event")
        return int(row["seq"]), False
    except Exception:
        conn.execute("ROLLBACK TO SAVEPOINT append_event")
        raise


def _row_to_event(r: sqlite3.Row) -> Event:
    return Event(
        seq=r["seq"], source=r["source"], external_id=r["external_id"],
        entity_type=r["entity_type"], entity_id=r["entity_id"], 
        parent_entity_id=r["parent_entity_id"], event_type=r["event_type"],
        payload=json.loads(r["payload"]), occurred_at=r["occurred_at"],
        received_at=r["received_at"], sig_verified=bool(r["sig_verified"]),
        previous_event_hash=r["previous_event_hash"], event_hash=r["event_hash"]
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



