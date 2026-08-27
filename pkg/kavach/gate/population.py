"""Identity graph and population detection.

Detects rings, velocity spikes, and inhuman regularity across agents and principals.
"""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass


@dataclass
class VelocityRisk:
    score: float
    reasons: list[str]


def check_velocity(
    conn: sqlite3.Connection,
    agent_id: str,
    principal_id: str,
    now: int | None = None,
    window_seconds: int = 3600
) -> VelocityRisk:
    """Calculates velocity risk for an agent-principal pair."""
    if now is None:
        now = int(time.time())

    cutoff = now - window_seconds
    
    # Count how many intents this agent has launched in the window
    row = conn.execute(
        "SELECT COUNT(*) as c FROM intents WHERE agent_id = ? AND created_at > ?",
        (agent_id, cutoff)
    ).fetchone()
    
    count = row["c"]
    
    if count > 50:
        return VelocityRisk(1.0, [f"extreme velocity: {count} actions in 1 hour"])
    elif count > 20:
        return VelocityRisk(0.6, [f"high velocity: {count} actions in 1 hour"])
    
    return VelocityRisk(0.0, [])
