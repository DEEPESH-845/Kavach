"""Payments and Refunds Service for Kavach API."""

import sqlite3
import time
from typing import Any
from kavach.truth import FinancialFact
from kavach.ledger import fact_for
from kavach.eventlog import for_entity


def _get_entities(conn: sqlite3.Connection, entity_type: str, limit: int = 50, offset: int = 0, now: int | None = None) -> list[dict[str, Any]]:
    if now is None:
        now = int(time.time())
        
    rows = conn.execute(
        "SELECT DISTINCT entity_id FROM events WHERE entity_type = ? ORDER BY seq DESC LIMIT ? OFFSET ?", 
        (entity_type, limit, offset)
    ).fetchall()
    
    out = []
    for r in rows:
        fact = fact_for(conn, entity_type, r["entity_id"], now)
        if fact:
            out.append(fact.to_agent())
    return out


def get_all_payments(conn: sqlite3.Connection, limit: int = 50, offset: int = 0, now: int | None = None) -> list[dict[str, Any]]:
    return _get_entities(conn, "payment", limit, offset, now)


def get_all_refunds(conn: sqlite3.Connection, limit: int = 50, offset: int = 0, now: int | None = None) -> list[dict[str, Any]]:
    return _get_entities(conn, "refund", limit, offset, now)


def get_payment_detail(conn: sqlite3.Connection, payment_id: str, now: int | None = None) -> dict[str, Any] | None:
    if now is None:
        now = int(time.time())
    fact = fact_for(conn, "payment", payment_id, now)
    if not fact:
        return None
        
    data = fact.to_agent()
    # Add timeline events
    events = for_entity(conn, "payment", payment_id)
    data["timeline"] = [{
        "seq": e.seq,
        "event_type": e.event_type,
        "occurred_at": e.occurred_at,
        "source": e.source,
        "sig_verified": e.sig_verified
    } for e in events]
    
    return data


def get_refund_detail(conn: sqlite3.Connection, refund_id: str, now: int | None = None) -> dict[str, Any] | None:
    if now is None:
        now = int(time.time())
    fact = fact_for(conn, "refund", refund_id, now)
    if not fact:
        return None
        
    data = fact.to_agent()
    # Add timeline events
    events = for_entity(conn, "refund", refund_id)
    data["timeline"] = [{
        "seq": e.seq,
        "event_type": e.event_type,
        "occurred_at": e.occurred_at,
        "source": e.source,
        "sig_verified": e.sig_verified
    } for e in events]
    
    return data
