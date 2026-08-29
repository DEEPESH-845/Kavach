"""Command-centre aggregates.

Everything here is a query over the event log and the intent ledger. No number in this
module is stored, cached or seeded: `protected_minor` is the sum of amounts on intents the
governor actually refused, and if the governor stops refusing things it goes to zero. A
metric that cannot go down is a decoration.
"""

from __future__ import annotations

import json
import sqlite3
import time
from typing import Any

from ..ledger import open_obligations
from ..proof import verify_event_chain
from .decisions import DENIED, ESCALATED, EXECUTED, REVIEW_STATUSES, UNRESOLVED_STATUSES

_DAY = 86_400


def _scalar(conn: sqlite3.Connection, sql: str, args: tuple = ()) -> int:
    row = conn.execute(sql, args).fetchone()
    return int(row[0] or 0)


def overview(conn: sqlite3.Connection, now: int | None = None) -> dict[str, Any]:
    if now is None:
        now = int(time.time())

    obligations = open_obligations(conn, now)
    exposure_minor = sum(f.amount_minor for f in obligations)
    oldest = max((f.unresolved_for for f in obligations), default=0)

    by_status = {r["status"]: r["n"] for r in conn.execute(
        "SELECT status, COUNT(*) n FROM intents GROUP BY status").fetchall()}
    governed = sum(by_status.values())
    refused = by_status.get(DENIED, 0)
    escalated = by_status.get(ESCALATED, 0)
    executed = by_status.get(EXECUTED, 0)

    q = ",".join("?" * len(UNRESOLVED_STATUSES))
    unresolved = _scalar(
        conn, f"SELECT COUNT(*) FROM intents WHERE status IN ({q}) AND result_id IS NULL",
        UNRESOLVED_STATUSES)

    protected_minor = _scalar(
        conn, "SELECT COALESCE(SUM(amount_minor),0) FROM intents WHERE status IN (?,?)",
        (DENIED, ESCALATED))
    governed_minor = _scalar(conn, "SELECT COALESCE(SUM(amount_minor),0) FROM intents")

    # Duplicate risk is only "detected" where the estimator actually ran and cleared the
    # governor's threshold. Counting escalations of any kind here would quietly credit the
    # model for cap breaches it had nothing to do with.
    duplicate_flagged = 0
    for r in conn.execute("SELECT decision FROM intents WHERE decision != '{}'").fetchall():
        try:
            score = json.loads(r["decision"]).get("duplicate_risk")
        except (json.JSONDecodeError, AttributeError):
            continue
        if isinstance(score, (int, float)) and score >= 0.5:
            duplicate_flagged += 1

    chain_ok, chain_message = verify_event_chain(conn)
    events_total = _scalar(conn, "SELECT COUNT(*) FROM events")

    return {
        "as_of": now,
        "exposure": {
            "open_minor": exposure_minor,
            "open_count": len(obligations),
            "oldest_seconds": oldest,
        },
        "governed": {
            "intents": governed,
            "amount_minor": governed_minor,
            "executed": executed,
            "last_24h": _scalar(conn, "SELECT COUNT(*) FROM intents WHERE created_at > ?",
                                (now - _DAY,)),
        },
        "refused": {
            "denied": refused,
            "escalated": escalated,
            "protected_minor": protected_minor,
            "duplicate_flagged": duplicate_flagged,
        },
        "review_queue": sum(by_status.get(s, 0) for s in REVIEW_STATUSES),
        "unresolved_outcomes": unresolved,
        "agents": {
            "active": _scalar(conn, "SELECT COUNT(DISTINCT agent_id) FROM intents"),
            "admission_rate": (round((governed - refused - escalated) / governed, 4)
                               if governed else None),
        },
        "integrity": {
            "chain_verified": chain_ok,
            "message": chain_message,
            "events": events_total,
        },
        "by_status": by_status,
    }


def stream(conn: sqlite3.Connection, limit: int = 40,
           before: int | None = None) -> dict[str, Any]:
    """The decision stream, newest first, cursored on `created_at`.

    Cursored rather than offset-paged: new decisions arrive at the head while an operator is
    reading, and an offset would silently re-show or skip rows as the head moves.
    """
    sql = ("SELECT intent_id, agent_id, session_id, tool, target_type, target_id,"
           " amount_minor, reason_text, created_at, status, decision, result_id"
           " FROM intents")
    args: list[Any] = []
    if before is not None:
        sql += " WHERE created_at < ?"
        args.append(before)
    sql += " ORDER BY created_at DESC, rowid DESC LIMIT ?"
    args.append(limit)

    rows = conn.execute(sql, args).fetchall()
    items = [_stream_row(r) for r in rows]
    return {
        "items": items,
        "next_before": items[-1]["created_at"] if len(items) == limit else None,
    }


def _stream_row(r: sqlite3.Row) -> dict[str, Any]:
    try:
        decision = json.loads(r["decision"]) if r["decision"] else {}
    except json.JSONDecodeError:
        decision = {}
    return {
        "intent_id": r["intent_id"],
        "agent_id": r["agent_id"],
        "session_id": r["session_id"],
        "tool": r["tool"],
        "target": f"{r['target_type']}:{r['target_id']}",
        "target_type": r["target_type"],
        "target_id": r["target_id"],
        "amount_minor": r["amount_minor"],
        "reason_text": r["reason_text"],
        "created_at": r["created_at"],
        "status": r["status"],
        "result_id": r["result_id"],
        "action": decision.get("action"),
        "risk": decision.get("duplicate_risk"),
        "headline": (decision.get("reasons") or [None])[0],
        "exposure": decision.get("open_exposure"),
    }
