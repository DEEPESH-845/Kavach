"""Population signal: how fast is this agent acting?

MECHANISM, stated exactly: a count of intents this agent recorded inside a one-hour window.
That is all. There is no identity graph, no community detection and no gradient boosting
here, and describing it as any of those would be the exact overclaim this project spends its
README refusing -- the score below is a velocity heuristic and is reported as one.

Ring detection is the upgrade path and it needs data this system does not yet hold. The
`intents` ledger records an agent and a session; it records no principal, device, address or
token, so there are no shared attributes to build a graph over. Landing rings means adding
those columns first, then a graph over them, evaluated on principal- and ring-disjoint
splits. Until that is measured, this ships as what it is.

Safe to ship a weak signal here for the same reason provenance.py is: the score is advisory,
it may only raise the admission floor, and it can never authorise a cart (ADR-004/006).
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
    now: int | None = None,
    window_seconds: int = 3600
) -> VelocityRisk:
    """Velocity risk for one agent. Takes no principal: the ledger holds none.

    An earlier signature accepted `principal_id` and never used it, which reads as a
    per-principal check that is silently not happening. The parameter is gone rather than
    documented, because a caller passing an argument that changes nothing is a caller being
    told something untrue.
    """
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
