"""Dispute pack: everything needed to defend one decision, in one file.

The question a dispute actually asks is not "what does your dashboard show now" but "what
did you know at the time, and can you show that the record has not been edited since".
So the pack is assembled from the events the decision CITED, not from a fresh derivation,
and it ships with the chain verification for exactly those events.

Machine-readable JSON is the artefact. A rendered PDF would need a layout engine as a
dependency to produce something a human reads once; the JSON is what an ops team, an
acquirer or a court-appointed expert can actually re-verify, and `verification` tells them
how to do it without this codebase.
"""

from __future__ import annotations

import sqlite3
import time
from typing import Any

from ..proof import claims, scan, verify_range
from . import intents


def pack(conn: sqlite3.Connection, intent_id: str,
         now: int | None = None) -> dict[str, Any] | None:
    if now is None:
        now = int(time.time())
    d = intents.detail(conn, intent_id, now=now)
    if d is None:
        return None

    status = scan(conn)
    seqs = d["proof"]["event_seqs"]
    ok, message = verify_range(conn, seqs)
    intent = d["intent"]

    return {
        "kavach_dispute_pack": "1.0",
        "generated_at": now,
        "subject": {
            "intent_id": intent["intent_id"],
            "agent_id": intent["agent_id"],
            "session_id": intent["session_id"],
            "tool": intent["tool"],
            "target": f"{intent['target_type']}:{intent['target_id']}",
            "amount_minor": intent["amount_minor"],
            "currency": "INR",
            "requested_at": intent["created_at"],
            "stated_reason": intent["reason_text"],
        },
        "financial_truth": d["truth"],
        "risk_assessment": {
            **d["risk"],
            "nature": "advisory only. The estimator may raise a decision toward a human "
                      "and may never authorise one (ADR-004/ADR-006).",
        },
        "governor_decision": {
            **d["governor"],
            "final_status": intent["status"],
            "authority_order": [
                "1. accounting invariants (deterministic, non-overridable)",
                "2. permission tier (deterministic)",
                "3. truth-plane confidence (UNKNOWN raises the floor to human approval)",
                "4. duplicate-risk model (may only escalate)",
                "5. exposure caps (deterministic)",
            ],
        },
        "provider_outcome": d["integration"],
        "audit_events": d["audit"]["events"],
        "related_intents": d["audit"]["sibling_intents"],
        "proof": {
            "cited_event_seqs": seqs,
            "cited_events_verified": ok,
            "message": message,
            "chain_head": status["head"],
            "chain_length": status["events"],
            "chain_intact": status["ok"],
            **claims(),
        },
        "verification": {
            "how": "for each event in ascending seq, SHA-256 over "
                   "previous_event_hash || 'source:external_id:entity_type:entity_id:"
                   "event_type:payload:occurred_at:sig_verified' || parent_entity_id "
                   "(appended only when present) must equal event_hash. payload is the "
                   "exact stored JSON string, keys sorted.",
            "scope": "this pack contains the events the decision cited. Recomputing the "
                     "full chain requires the complete log.",
        },
    }
