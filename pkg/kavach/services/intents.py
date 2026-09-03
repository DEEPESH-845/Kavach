"""Intents, and the one unified view of a decision.

`detail()` assembles the seven things an operator or a disputing customer needs about a
single decision -- the intent, the truth it was decided against, the risk that was scored,
the governor's verdict, what the provider did, the audit events, and the proof they are
intact. It is one function rather than seven endpoints because the value of the view is that
the parts line up: a risk score shown next to a different decision's truth would be worse
than showing neither.
"""

from __future__ import annotations

import json
import sqlite3
import time
from typing import Any

from .. import ledger
from ..eventlog import Event, by_seq, for_entity
from ..proof import verify_range
from ..truth import Confidence
from . import decisions
from .decisions import DENIED, ESCALATED, REVIEW_STATUSES, UNRESOLVED_STATUSES

_FIELDS = ("intent_id", "agent_id", "session_id", "tool", "target_type", "target_id",
           "amount_minor", "reason_text", "created_at", "status", "result_id")


def _decision(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        out = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return out if isinstance(out, dict) else {}


def _row(r: sqlite3.Row) -> dict[str, Any]:
    return {**{k: r[k] for k in _FIELDS}, "decision": _decision(r["decision"])}


def _event(e: Event) -> dict[str, Any]:
    return {"seq": e.seq, "source": e.source, "external_id": e.external_id,
            "entity_type": e.entity_type, "entity_id": e.entity_id,
            "parent_entity_id": e.parent_entity_id, "event_type": e.event_type,
            "occurred_at": e.occurred_at, "received_at": e.received_at,
            "sig_verified": e.sig_verified,
            "previous_event_hash": e.previous_event_hash, "event_hash": e.event_hash,
            "payload": e.payload}


def listing(conn: sqlite3.Connection, *, status: str | None = None,
            agent_id: str | None = None, target_id: str | None = None,
            limit: int = 50, offset: int = 0) -> dict[str, Any]:
    where, args = [], []
    if status:
        where.append("status = ?")
        args.append(status)
    if agent_id:
        where.append("agent_id = ?")
        args.append(agent_id)
    if target_id:
        where.append("target_id = ?")
        args.append(target_id)
    clause = (" WHERE " + " AND ".join(where)) if where else ""

    total = conn.execute(f"SELECT COUNT(*) FROM intents{clause}", args).fetchone()[0]
    rows = conn.execute(
        f"SELECT * FROM intents{clause} ORDER BY created_at DESC, rowid DESC"
        " LIMIT ? OFFSET ?", (*args, limit, offset)).fetchall()
    return {"items": [_row(r) for r in rows], "total": int(total),
            "limit": limit, "offset": offset}


def review_queue(conn: sqlite3.Connection) -> dict[str, Any]:
    q = ",".join("?" * len(REVIEW_STATUSES))
    rows = conn.execute(
        f"SELECT * FROM intents WHERE status IN ({q}) ORDER BY created_at DESC",
        REVIEW_STATUSES).fetchall()
    return {"items": [_row(r) for r in rows], "total": len(rows)}


def unresolved(conn: sqlite3.Connection) -> dict[str, Any]:
    """Intents we committed to and hold no provider result for. The reconciler's backlog."""
    q = ",".join("?" * len(UNRESOLVED_STATUSES))
    rows = conn.execute(
        f"SELECT * FROM intents WHERE status IN ({q}) AND result_id IS NULL"
        " ORDER BY created_at DESC", UNRESOLVED_STATUSES).fetchall()
    return {"items": [_row(r) for r in rows], "total": len(rows)}


def get(conn: sqlite3.Connection, intent_id: str) -> dict[str, Any] | None:
    r = conn.execute("SELECT * FROM intents WHERE intent_id = ?", (intent_id,)).fetchone()
    return _row(r) if r else None


def detail(conn: sqlite3.Connection, intent_id: str,
           now: int | None = None) -> dict[str, Any] | None:
    """Everything about one decision, in the order the decision was made."""
    intent = get(conn, intent_id)
    if intent is None:
        return None
    if now is None:
        now = int(time.time())

    decision = intent["decision"]
    target_type, target_id = intent["target_type"], intent["target_id"]

    fact = ledger.fact_for(conn, target_type, target_id, now)
    open_facts = (ledger.open_against_payment(conn, target_id, now)
                  if target_type == "payment" else [])

    # The events the governor actually cited, fetched by the seqs it recorded -- not
    # re-derived now. A dispute is about what was known then.
    cited = by_seq(conn, [s for s in decision.get("evidence_events", [])
                          if isinstance(s, int)])

    audit = for_entity(conn, "intent", intent_id)
    result_events = (for_entity(conn, "refund", intent["result_id"])
                     if intent["result_id"] else [])

    siblings = [i for i in ledger.prior_intents(conn, target_type, target_id)
                if i.intent_id != intent_id]

    chain_seqs = sorted({e.seq for e in (*cited, *audit, *result_events)})
    chain_ok, chain_message = verify_range(conn, chain_seqs)

    return {
        "intent": intent,
        "truth": {
            "fact": fact.to_agent() if fact else None,
            "evidence": [_event(e) for e in cited],
            "open_obligations": [f.to_agent() for f in open_facts],
            "exposure_minor": (ledger.exposure(conn, target_id, now)
                               if target_type == "payment" else 0),
        },
        "risk": {
            "score": decision.get("duplicate_risk"),
            "factors": decision.get("risk_factors", []),
            "assessed": decision.get("duplicate_risk") is not None,
        },
        "governor": {
            "action": decision.get("action") or intent["status"],
            "reasons": decision.get("reasons", []),
            "open_exposure": decision.get("open_exposure"),
        },
        "integration": {
            "result_id": intent["result_id"],
            "provider_events": [_event(e) for e in result_events],
            "settled": intent["status"],
        },
        "audit": {
            "events": [_event(e) for e in audit],
            "sibling_intents": [{
                "intent_id": i.intent_id, "agent_id": i.agent_id,
                "session_id": i.session_id, "amount_minor": i.amount_minor,
                "reason_text": i.reason_text, "status": i.status,
                "created_at": i.created_at, "result_id": i.result_id}
                for i in siblings],
        },
        "proof": {
            "verified": chain_ok,
            "message": chain_message,
            "event_seqs": chain_seqs,
        },
    }


def duplicate_candidate(conn: sqlite3.Connection,
                        now: int | None = None) -> dict[str, Any] | None:
    """A payment against which a duplicate refund is genuinely possible right now.

    That means: an obligation already OPEN (money dispatched, no ARN) whose intent was
    recorded long enough ago to look like a re-decision rather than a double-click. The
    distinction is the product's own (ADR-008): a repeat seconds later is a REPLAYED
    request, which Razorpay's idempotency key already refuses; a repeat an hour later is a
    NEW intent for the same obligation, which only the ledger and the estimator can catch.
    The duplicate-risk model learned that difference -- `log_time_gap` is its largest
    positive coefficient -- so pointing the demonstration at a fresh payment would be
    asking the model a question its corpus never contained.

    Returns None when nothing in the ledger qualifies, rather than naming a payment that
    would not actually escalate.
    """
    if now is None:
        now = int(time.time())
    best: dict[str, Any] | None = None
    for f in ledger.open_obligations(conn, now):
        if f.entity_type != "refund":
            continue
        payment_id = _parent_of(conn, f.entity_id)
        if payment_id is None:
            continue
        all_priors = ledger.prior_intents(conn, "payment", payment_id)
        priors = [i for i in all_priors if i.status == decisions.EXECUTED]
        if not priors:
            continue
        age = now - max(i.created_at for i in priors)
        # under fifteen minutes is a replay, not a re-decision
        if age < 900:
            continue
        row = {"payment_id": payment_id, "refund_id": f.entity_id,
               "amount_minor": f.amount_minor, "open_for_seconds": f.unresolved_for,
               "intent_age_seconds": age, "reason_text": priors[-1].reason_text,
               "confidence": f.confidence.value, "rail_state": f.rail_state.value,
               "asks": len(all_priors)}
        if best is None or _better(row, best):
            best = row
    return best


def _better(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """Prefer the obligation whose state Kavach is CERTAIN of, then the oldest intent.

    An AMBIGUOUS obligation already escalates one rung earlier, on truth confidence -- so
    demonstrating the duplicate estimator against one would credit the model for a refusal
    the truth plane makes without it. The interesting target is the obligation we are sure
    is in flight, where only the ledger and the estimator can see the collision.
    """
    certain = (a["confidence"] != Confidence.UNKNOWN.value,
               b["confidence"] != Confidence.UNKNOWN.value)
    if certain[0] != certain[1]:
        return certain[0]
    # Then the obligation nobody has re-asked yet: a target that already carries a second
    # intent would put the caller's ask THIRD, and the estimator reads the gap to the
    # closest prior -- so the question it would be answering is a different one.
    fresh = (a["asks"] == 1, b["asks"] == 1)
    if fresh[0] != fresh[1]:
        return fresh[0]
    return a["intent_age_seconds"] > b["intent_age_seconds"]


def _parent_of(conn: sqlite3.Connection, refund_id: str) -> str | None:
    r = conn.execute("SELECT parent_entity_id FROM events WHERE entity_type='refund' AND "
                     "entity_id=? AND parent_entity_id IS NOT NULL LIMIT 1",
                     (refund_id,)).fetchone()
    return r["parent_entity_id"] if r else None


def agents(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT agent_id,"
        "       COUNT(*) AS intents,"
        "       COALESCE(SUM(amount_minor), 0) AS requested_minor,"
        "       SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS denied,"
        "       SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS escalated,"
        "       MIN(created_at) AS first_seen,"
        "       MAX(created_at) AS last_seen,"
        "       COUNT(DISTINCT session_id) AS sessions"
        " FROM intents GROUP BY agent_id ORDER BY last_seen DESC",
        (DENIED, ESCALATED)).fetchall()
    out = []
    for r in rows:
        total = int(r["intents"])
        refused = int(r["denied"]) + int(r["escalated"])
        out.append({
            "agent_id": r["agent_id"], "intents": total,
            "requested_minor": int(r["requested_minor"]),
            "denied": int(r["denied"]), "escalated": int(r["escalated"]),
            "sessions": int(r["sessions"]),
            "admission_rate": round((total - refused) / total, 4) if total else None,
            "first_seen": r["first_seen"], "last_seen": r["last_seen"],
        })
    return out


def agent_detail(conn: sqlite3.Connection, agent_id: str) -> dict[str, Any] | None:
    summary = next((a for a in agents(conn) if a["agent_id"] == agent_id), None)
    if summary is None:
        return None
    rows = conn.execute(
        "SELECT * FROM intents WHERE agent_id = ? ORDER BY created_at DESC LIMIT 100",
        (agent_id,)).fetchall()
    return {**summary, "intents": [_row(r) for r in rows]}
