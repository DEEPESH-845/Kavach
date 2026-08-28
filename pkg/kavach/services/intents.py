"""Intents Service for Kavach API.

Provides intent data and intent detail capabilities.
"""
import sqlite3
import json
from typing import Any
from kavach.eventlog import connect


def get_all_intents(conn: sqlite3.Connection, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM intents ORDER BY created_at DESC LIMIT ? OFFSET ?", (limit, offset)
    ).fetchall()
    
    out = []
    for r in rows:
        out.append({
            "intent_id": r["intent_id"],
            "agent_id": r["agent_id"],
            "session_id": r["session_id"],
            "tool": r["tool"],
            "target_type": r["target_type"],
            "target_id": r["target_id"],
            "amount_minor": r["amount_minor"],
            "reason_text": r["reason_text"],
            "created_at": r["created_at"],
            "status": r["status"],
            "decision": json.loads(r["decision"]) if r["decision"] else {},
            "result_id": r["result_id"]
        })
    return out


def get_intent_detail(conn: sqlite3.Connection, intent_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM intents WHERE intent_id = ?", (intent_id,)
    ).fetchone()
    
    if not row:
        return None
        
    return {
        "intent_id": row["intent_id"],
        "agent_id": row["agent_id"],
        "session_id": row["session_id"],
        "tool": row["tool"],
        "target_type": row["target_type"],
        "target_id": row["target_id"],
        "amount_minor": row["amount_minor"],
        "reason_text": row["reason_text"],
        "created_at": row["created_at"],
        "status": row["status"],
        "decision": json.loads(row["decision"]) if row["decision"] else {},
        "result_id": row["result_id"]
    }


def get_approvals(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM intents WHERE status = 'ESCALATED' ORDER BY created_at DESC"
    ).fetchall()
    
    out = []
    for r in rows:
        out.append({
            "intent_id": r["intent_id"],
            "agent_id": r["agent_id"],
            "tool": r["tool"],
            "amount_minor": r["amount_minor"],
            "reason_text": r["reason_text"],
            "created_at": r["created_at"],
            "status": r["status"],
            "decision": json.loads(r["decision"]) if r["decision"] else {},
        })
    return out


def get_reconciliations(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM intents WHERE status IN ('UNKNOWN_OUTCOME', 'RECONCILING', 'FAILED') ORDER BY created_at DESC"
    ).fetchall()
    
    out = []
    for r in rows:
        out.append({
            "intent_id": r["intent_id"],
            "agent_id": r["agent_id"],
            "tool": r["tool"],
            "target_type": r["target_type"],
            "target_id": r["target_id"],
            "amount_minor": r["amount_minor"],
            "created_at": r["created_at"],
            "status": r["status"],
            "result_id": r["result_id"]
        })
    return out


def get_proofs(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM intents WHERE decision IS NOT NULL ORDER BY created_at DESC"
    ).fetchall()
    
    out = []
    for r in rows:
        decision = json.loads(r["decision"]) if r["decision"] else {}
        if not decision.get("signature"):
            continue
            
        out.append({
            "intent_id": r["intent_id"],
            "agent_id": r["agent_id"],
            "tool": r["tool"],
            "amount_minor": r["amount_minor"],
            "status": r["status"],
            "created_at": r["created_at"],
            "signature": decision.get("signature"),
            "signed_by": decision.get("signed_by")
        })
    return out
