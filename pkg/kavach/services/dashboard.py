"""Dashboard Service for Kavach API.

Provides aggregated summaries for the merchant dashboard.
"""

import sqlite3
import time
from typing import Any

from kavach.ledger import open_obligations
from kavach.eventlog import connect


def get_overview_metrics(conn: sqlite3.Connection, now: int | None = None) -> dict[str, Any]:
    if now is None:
        now = int(time.time())
        
    # 1. Open Financial Exposure
    obligations = open_obligations(conn, now)
    exposure_amount = sum(f.amount_minor for f in obligations)
    
    # 2. Escalated Actions (intents with status ESCALATED)
    escalated_count = conn.execute(
        "SELECT COUNT(*) FROM intents WHERE status = 'ESCALATED'"
    ).fetchone()[0]
    
    # 3. Unknown Outcomes (intents with status UNKNOWN_OUTCOME)
    unknown_count = conn.execute(
        "SELECT COUNT(*) FROM intents WHERE status = 'UNKNOWN_OUTCOME'"
    ).fetchone()[0]
    
    # 4. Blocked Duplicate Risk (intents blocked due to risk)
    blocked_count = conn.execute(
        "SELECT COUNT(*) FROM intents WHERE status = 'BLOCKED' OR status = 'DENY'"
    ).fetchone()[0]
    
    # 5. Protected Amount (sum of amounts in blocked or escalated intents)
    protected_amount_row = conn.execute(
        "SELECT SUM(amount_minor) FROM intents WHERE status IN ('BLOCKED', 'DENY', 'ESCALATED')"
    ).fetchone()[0]
    protected_amount = protected_amount_row if protected_amount_row else 0
    
    return {
        "open_exposure": exposure_amount,
        "escalated_actions": escalated_count,
        "unknown_outcomes": unknown_count,
        "blocked_actions": blocked_count,
        "protected_amount": protected_amount,
        "active_agents": get_active_agents_count(conn),
    }

def get_active_agents_count(conn: sqlite3.Connection) -> int:
    # Approximate based on unique agents with recent intents, or just all unique agents
    row = conn.execute("SELECT COUNT(DISTINCT agent_id) FROM intents").fetchone()[0]
    return row

def get_recent_activity(conn: sqlite3.Connection, limit: int = 10) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM intents ORDER BY created_at DESC LIMIT ?", (limit,)
    ).fetchall()
    
    out = []
    for r in rows:
        out.append({
            "intent_id": r["intent_id"],
            "agent_id": r["agent_id"],
            "tool": r["tool"],
            "amount_minor": r["amount_minor"],
            "target_id": r["target_id"],
            "status": r["status"],
            "created_at": r["created_at"],
            "reason": r["reason_text"]
        })
    return out
