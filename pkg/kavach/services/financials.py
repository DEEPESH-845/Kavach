"""Payments, refunds, obligations, and the truth behind each.

The distinction this module exists to keep visible: a row here is a DERIVED fact, not a
stored record. `payments()` does not read a payments table -- there isn't one -- it folds
the event log per entity through truth.derive. Which is why every response carries the
event seqs it was derived from: the fact and its evidence travel together or neither is
worth much.
"""

from __future__ import annotations

import sqlite3
import time
from typing import Any

from .. import ledger
from ..eventlog import Event, for_entity
from ..truth import Confidence, derive

_STALE_NOTE = ("derived from the event log at request time; nothing here is a stored "
               "status field")


def _event(e: Event, *, payload: bool = False) -> dict[str, Any]:
    out = {"seq": e.seq, "source": e.source, "external_id": e.external_id,
           "event_type": e.event_type, "occurred_at": e.occurred_at,
           "received_at": e.received_at, "sig_verified": e.sig_verified,
           "previous_event_hash": e.previous_event_hash, "event_hash": e.event_hash}
    if payload:
        out["payload"] = e.payload
    return out


def _entity_ids(conn: sqlite3.Connection, entity_type: str, limit: int,
                offset: int) -> tuple[list[str], int]:
    total = conn.execute(
        "SELECT COUNT(DISTINCT entity_id) FROM events WHERE entity_type = ?",
        (entity_type,)).fetchone()[0]
    rows = conn.execute(
        "SELECT entity_id, MAX(occurred_at) AS latest FROM events WHERE entity_type = ?"
        " GROUP BY entity_id ORDER BY latest DESC, entity_id LIMIT ? OFFSET ?",
        (entity_type, limit, offset)).fetchall()
    return [r["entity_id"] for r in rows], int(total)


def _summary(conn: sqlite3.Connection, entity_type: str, entity_id: str,
             now: int) -> dict[str, Any] | None:
    fact = ledger.fact_for(conn, entity_type, entity_id, now)
    if fact is None:
        return None
    out = {
        "entity_type": entity_type, "entity_id": entity_id,
        "rail_state": fact.rail_state.value,
        "obligation_open": fact.obligation_open,
        "confidence": fact.confidence.value,
        "amount_minor": fact.amount_minor, "currency": fact.currency,
        "because": fact.reason, "evidence": fact.evidence,
        "unresolved_for": fact.unresolved_for, "arn": fact.arn,
        "settled_to_customer": bool(fact.arn) and not fact.obligation_open,
        "as_of": now,
    }
    if entity_type == "payment":
        out["exposure_minor"] = ledger.exposure(conn, entity_id, now)
    return out


def listing(conn: sqlite3.Connection, entity_type: str, *, limit: int = 50,
            offset: int = 0, now: int | None = None) -> dict[str, Any]:
    if now is None:
        now = int(time.time())
    ids, total = _entity_ids(conn, entity_type, limit, offset)
    items = [s for eid in ids if (s := _summary(conn, entity_type, eid, now))]
    return {"items": items, "total": total, "limit": limit, "offset": offset,
            "note": _STALE_NOTE}


def detail(conn: sqlite3.Connection, entity_type: str, entity_id: str,
           now: int | None = None) -> dict[str, Any] | None:
    """One entity: its derived fact, the events it came from, and what it is linked to."""
    if now is None:
        now = int(time.time())
    events = for_entity(conn, entity_type, entity_id)
    if not events:
        return None
    summary = _summary(conn, entity_type, entity_id, now)
    if summary is None:
        return None

    related: dict[str, Any] = {}
    if entity_type == "payment":
        child_ids = [r["entity_id"] for r in conn.execute(
            "SELECT DISTINCT entity_id FROM events WHERE entity_type='refund'"
            " AND parent_entity_id = ?", (entity_id,)).fetchall()]
        related["refunds"] = [s for cid in child_ids
                              if (s := _summary(conn, "refund", cid, now))]
        related["intents"] = [{
            "intent_id": i.intent_id, "agent_id": i.agent_id, "session_id": i.session_id,
            "amount_minor": i.amount_minor, "reason_text": i.reason_text,
            "status": i.status, "created_at": i.created_at, "result_id": i.result_id}
            for i in ledger.prior_intents(conn, "payment", entity_id)]
    elif entity_type == "refund":
        parent = events[0].parent_entity_id
        related["payment"] = (_summary(conn, "payment", parent, now) if parent else None)

    return {**summary, "timeline": [_event(e, payload=True) for e in events],
            "related": related, "note": _STALE_NOTE}


def obligations(conn: sqlite3.Connection, now: int | None = None) -> dict[str, Any]:
    if now is None:
        now = int(time.time())
    facts = ledger.open_obligations(conn, now)
    items = [{
        "entity_type": f.entity_type, "entity_id": f.entity_id,
        "amount_minor": f.amount_minor, "currency": f.currency,
        "rail_state": f.rail_state.value, "confidence": f.confidence.value,
        "because": f.reason, "unresolved_for": f.unresolved_for,
        "evidence": f.evidence, "arn": f.arn,
    } for f in sorted(facts, key=lambda f: -f.unresolved_for)]
    return {
        "items": items,
        "total_minor": sum(f.amount_minor for f in facts),
        "count": len(facts),
        "oldest_seconds": max((f.unresolved_for for f in facts), default=0),
        "ambiguous": sum(1 for f in facts if f.confidence is Confidence.UNKNOWN),
        "as_of": now,
    }


def truth_trace(conn: sqlite3.Connection, entity_type: str, entity_id: str,
                now: int | None = None) -> dict[str, Any] | None:
    """The derivation, step by step: which event moved the state, and what it changed to.

    Built by re-deriving after each event rather than by instrumenting derive(). The
    derivation stays pure, and the trace is provably the same function the governor read --
    the last row of the trace IS the fact.
    """
    if now is None:
        now = int(time.time())
    events = for_entity(conn, entity_type, entity_id)
    if not events:
        return None

    steps, previous = [], None
    for i, e in enumerate(events, start=1):
        try:
            fact = derive(events[:i], now=now)
        except ValueError as exc:
            steps.append({"event": _event(e), "error": str(exc)})
            continue
        steps.append({
            "event": _event(e),
            "rail_state": fact.rail_state.value,
            "obligation_open": fact.obligation_open,
            "confidence": fact.confidence.value,
            "because": fact.reason,
            "changed": previous != fact.rail_state.value,
        })
        previous = fact.rail_state.value

    final = derive(events, now=now)
    return {
        "entity_type": entity_type, "entity_id": entity_id,
        "steps": steps,
        "fact": _summary(conn, entity_type, entity_id, now),
        # The vocabulary the UI labels each row with. Stated by the backend so the
        # frontend cannot quietly relabel an inference as an observation.
        "provenance": {
            "observed": "a status carried by a source event",
            "derived": "the fold of every observed status, in causal order",
            "inferred": "a conclusion no single event states -- staleness, contradiction, "
                        "or an ARN closing an obligation",
            "policy": "not present here; the governor decides separately, over this fact",
        },
        "final_confidence": final.confidence.value,
        "as_of": now,
    }
