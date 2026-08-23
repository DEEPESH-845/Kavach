"""Open-object ledger: which obligations are in flight, and what agents already tried.

A spend cap asks "is this under the limit?". An idempotency key asks "have I seen this
exact request?". Neither asks the only question that matters here:

    is there already money in flight for this obligation?

The ledger answers that by deriving facts for every entity we hold events for and keeping
the ones whose obligation is still OPEN, alongside the intent log of what agents have
already asked for against the same target.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass

from .eventlog import for_entity
from .truth import FinancialFact, derive

SCHEMA = """
CREATE TABLE IF NOT EXISTS intents (
    intent_id     TEXT PRIMARY KEY,
    agent_id      TEXT NOT NULL,
    session_id    TEXT NOT NULL,   -- a NEW session is exactly how a duplicate is born
    tool          TEXT NOT NULL,   -- create_refund, create_payout, ...
    target_type   TEXT NOT NULL,   -- payment | order
    target_id     TEXT NOT NULL,
    amount_minor  INTEGER NOT NULL,
    reason_text   TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL,
    status        TEXT NOT NULL,   -- PROPOSED|APPROVED|EXECUTED|BLOCKED|ESCALATED|FAILED
    decision      TEXT NOT NULL DEFAULT '{}',
    result_id     TEXT
);
CREATE INDEX IF NOT EXISTS idx_intents_target ON intents (target_type, target_id, created_at);
"""


@dataclass(frozen=True)
class Intent:
    intent_id: str
    agent_id: str
    session_id: str
    tool: str
    target_type: str
    target_id: str
    amount_minor: int
    reason_text: str
    created_at: int
    status: str = "PROPOSED"
    result_id: str | None = None


def init(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def record(conn: sqlite3.Connection, i: Intent, decision: dict | None = None) -> None:
    """Write-ahead: an intent is durable BEFORE it is executed.

    If we crash between here and the API call, recovery can see an intent with no result
    and reconcile it, instead of the agent silently retrying into a duplicate.
    """
    conn.execute(
        "INSERT OR REPLACE INTO intents (intent_id, agent_id, session_id, tool, target_type,"
        " target_id, amount_minor, reason_text, created_at, status, decision, result_id)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (i.intent_id, i.agent_id, i.session_id, i.tool, i.target_type, i.target_id,
         i.amount_minor, i.reason_text, i.created_at, i.status,
         json.dumps(decision or {}, sort_keys=True), i.result_id),
    )


def settle(conn: sqlite3.Connection, intent_id: str, status: str,
           result_id: str | None = None) -> None:
    conn.execute("UPDATE intents SET status=?, result_id=COALESCE(?, result_id) "
                 "WHERE intent_id=?", (status, result_id, intent_id))


def _to_intent(r: sqlite3.Row) -> Intent:
    return Intent(r["intent_id"], r["agent_id"], r["session_id"], r["tool"], r["target_type"],
                  r["target_id"], r["amount_minor"], r["reason_text"], r["created_at"],
                  r["status"], r["result_id"])


def prior_intents(conn: sqlite3.Connection, target_type: str, target_id: str) -> list[Intent]:
    """Everything any agent has already asked for against this target, in any session."""
    rows = conn.execute(
        "SELECT * FROM intents WHERE target_type=? AND target_id=? ORDER BY created_at",
        (target_type, target_id)).fetchall()
    return [_to_intent(r) for r in rows]


def fact_for(conn: sqlite3.Connection, entity_type: str, entity_id: str,
             now: int) -> FinancialFact | None:
    evs = for_entity(conn, entity_type, entity_id)
    if not evs:
        return None
    try:
        return derive(evs, now=now)
    except ValueError:
        return None


def open_obligations(conn: sqlite3.Connection, now: int) -> list[FinancialFact]:
    """Every entity we hold whose obligation is still OPEN."""
    rows = conn.execute(
        "SELECT DISTINCT entity_type, entity_id FROM events").fetchall()
    out = []
    for r in rows:
        f = fact_for(conn, r["entity_type"], r["entity_id"], now)
        if f and f.obligation_open:
            out.append(f)
    return out


def open_against_payment(conn: sqlite3.Connection, payment_id: str,
                         now: int) -> list[FinancialFact]:
    """Open refunds whose parent is this payment.

    A refund's link to its payment lives in the event payload, so we read it back out of
    the log rather than keeping a second copy that can drift.
    """
    rows = conn.execute(
        "SELECT DISTINCT entity_id FROM events WHERE entity_type='refund'"
        " AND payload LIKE ?", (f'%"{payment_id}"%',)).fetchall()
    out = []
    for r in rows:
        f = fact_for(conn, "refund", r["entity_id"], now)
        if f and f.obligation_open:
            out.append(f)
    return out


def exposure(conn: sqlite3.Connection, payment_id: str, now: int) -> int:
    """Minor units already committed against this payment and not yet closed out.

    Counts open refunds PLUS intents that were executed but whose result we have no events
    for yet -- the window where a naive agent double-refunds.
    """
    total = sum(f.amount_minor for f in open_against_payment(conn, payment_id, now))
    # Every refund we hold ANY event for -- open or closed. If an intent produced one of
    # these, its state is already accounted for above and adding it again double-counts.
    observed = {r["entity_id"] for r in conn.execute(
        "SELECT DISTINCT entity_id FROM events WHERE entity_type='refund' AND payload LIKE ?",
        (f'%"{payment_id}"%',)).fetchall()}
    for i in prior_intents(conn, "payment", payment_id):
        if i.status == "EXECUTED" and i.result_id not in observed:
            total += i.amount_minor
    return total
