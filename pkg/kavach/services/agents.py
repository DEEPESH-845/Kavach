"""Agents Service for Kavach API."""

import sqlite3
import time
from typing import Any


def get_all_agents(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    # In a real system this would query a dedicated agents table
    # For now, we aggregate from intents
    rows = conn.execute("""
        SELECT 
            agent_id, 
            COUNT(*) as intent_count,
            SUM(CASE WHEN status = 'EXECUTED' THEN amount_minor ELSE 0 END) as lifetime_volume,
            SUM(CASE WHEN status = 'BLOCKED' OR status = 'ESCALATED' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as block_rate,
            MAX(created_at) as last_seen
        FROM intents
        GROUP BY agent_id
        ORDER BY last_seen DESC
    """).fetchall()
    
    out = []
    for r in rows:
        out.append({
            "agent_id": r["agent_id"],
            "intent_count": r["intent_count"],
            "lifetime_volume": r["lifetime_volume"],
            "block_rate": r["block_rate"],
            "last_seen": r["last_seen"]
        })
    return out


def get_agent_detail(conn: sqlite3.Connection, agent_id: str) -> dict[str, Any] | None:
    row = conn.execute("""
        SELECT 
            agent_id, 
            COUNT(*) as intent_count,
            SUM(CASE WHEN status = 'EXECUTED' THEN amount_minor ELSE 0 END) as lifetime_volume,
            SUM(CASE WHEN status = 'BLOCKED' OR status = 'ESCALATED' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as block_rate,
            MAX(created_at) as last_seen
        FROM intents
        WHERE agent_id = ?
        GROUP BY agent_id
    """, (agent_id,)).fetchone()
    
    if not row:
        return None
        
    recent_intents = conn.execute("""
        SELECT intent_id, tool, target_id, amount_minor, status, created_at
        FROM intents
        WHERE agent_id = ?
        ORDER BY created_at DESC
        LIMIT 20
    """, (agent_id,)).fetchall()
    
    return {
        "agent_id": row["agent_id"],
        "intent_count": row["intent_count"],
        "lifetime_volume": row["lifetime_volume"],
        "block_rate": row["block_rate"],
        "last_seen": row["last_seen"],
        "recent_intents": [{
            "intent_id": i["intent_id"],
            "tool": i["tool"],
            "target_id": i["target_id"],
            "amount_minor": i["amount_minor"],
            "status": i["status"],
            "created_at": i["created_at"]
        } for i in recent_intents]
    }
