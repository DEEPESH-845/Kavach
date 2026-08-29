"""GOVERNOR: may this agent move this money, right now?

Demoted from headline to plumbing by ADR-009 -- spend caps and allowlists are being
commoditised by AP2, Agent Passport and Stripe Issuing, and claiming them as novel would be
wrong. What is not commoditised is what this governor reads BEFORE it decides: the canonical
truth plane and the open-object ledger. A cap knows the amount. This knows the obligation.

Order of authority, strongest first:
  1. Accounting invariants   -- deterministic, model can never override. DENY.
  2. Permission tier         -- deterministic. DENY.
  3. Truth-plane confidence  -- UNKNOWN raises the floor to human approval (ADR-006).
  4. Duplicate-risk model    -- may only ESCALATE, never authorise (ADR-004/006).
  5. Exposure caps           -- deterministic.
Anything the model says can make the outcome MORE cautious and nothing else.
"""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass, field
from enum import StrEnum

from . import ledger
from .razorpay.client import Razorpay, RazorpayError
from .truth import Confidence


class Action(StrEnum):
    ALLOW = "ALLOW"
    ESCALATE = "ESCALATE"   # queued for a human; not a refusal
    DENY = "DENY"           # never executable, no human can wave it through here


@dataclass(frozen=True)
class Policy:
    allow_write: bool = True
    max_auto_refund_minor: int = 1_000_00      # above this a human approves
    session_cap_minor: int = 5_000_00
    daily_cap_minor: int = 25_000_00
    risk_threshold: float = 0.5                 # from the model's frozen train threshold


@dataclass
class Decision:
    action: Action
    reasons: list[str] = field(default_factory=list)
    evidence: list[int] = field(default_factory=list)   # event seqs from the truth plane
    risk_score: float | None = None
    risk_explain: list[str] = field(default_factory=list)
    exposure_minor: int = 0

    def to_dict(self) -> dict:
        return {"action": self.action.value, "reasons": self.reasons,
                "evidence_events": self.evidence, "duplicate_risk": self.risk_score,
                "risk_factors": self.risk_explain, "open_exposure": self.exposure_minor / 100}


def decide(conn: sqlite3.Connection, *, intent: ledger.Intent, payment_amount_minor: int,
           payment_captured: bool, now: int, policy: Policy,
           risk_score: float | None = None, risk_explain: list[str] | None = None) -> Decision:
    d = Decision(Action.ALLOW, risk_score=risk_score, risk_explain=risk_explain or [])

    open_facts = ledger.open_against_payment(conn, intent.target_id, now)
    d.evidence = [s for f in open_facts for s in f.evidence]
    exposure = ledger.exposure(conn, intent.target_id, now)
    d.exposure_minor = exposure

    # 1. Accounting invariants. Not negotiable, not model-influenced, not approvable.
    if not payment_captured:
        return _deny(d, "payment is not captured; there are no funds to refund")
    if exposure + intent.amount_minor > payment_amount_minor:
        return _deny(d, f"would refund {(exposure + intent.amount_minor)/100:,.2f} against a "
                        f"payment of {payment_amount_minor/100:,.2f}; refunds may not exceed "
                        f"the captured amount")

    # 2. Permission tier.
    if not policy.allow_write:
        return _deny(d, "agent holds a read-only tier for money-moving tools")

    # 3. Truth-plane confidence. Unknown state is not a reason to proceed carefully, it is a
    #    reason to stop: we cannot assert what we would be duplicating.
    unknown = [f for f in open_facts if f.confidence is Confidence.UNKNOWN]
    if unknown:
        _escalate(d, f"{len(unknown)} open obligation(s) on this payment are in an "
                     f"AMBIGUOUS state, so the effect of this refund cannot be predicted")

    # 4. Duplicate risk. ESCALATE only -- a low score never unlocks anything.
    if risk_score is not None and risk_score >= policy.risk_threshold:
        _escalate(d, f"duplicate-risk {risk_score:.2f} >= {policy.risk_threshold:.2f}: this "
                     f"intent resembles an obligation already in flight")

    # 5. Caps.
    if intent.amount_minor > policy.max_auto_refund_minor:
        _escalate(d, f"amount {intent.amount_minor/100:,.2f} exceeds the autonomous limit "
                     f"of {policy.max_auto_refund_minor/100:,.2f}")
    spent = _session_spend(conn, intent.session_id)
    if spent + intent.amount_minor > policy.session_cap_minor:
        _escalate(d, f"session would reach {(spent + intent.amount_minor)/100:,.2f} against "
                     f"a cap of {policy.session_cap_minor/100:,.2f}")
    today = _day_spend(conn, now)
    if today + intent.amount_minor > policy.daily_cap_minor:
        _escalate(d, f"daily spend would reach {(today + intent.amount_minor)/100:,.2f} "
                     f"against a cap of {policy.daily_cap_minor/100:,.2f}")

    if d.action is Action.ALLOW and not d.reasons:
        d.reasons.append("no open obligation matches this intent and all caps are satisfied")
    return d


def _deny(d: Decision, why: str) -> Decision:
    d.action, d.reasons = Action.DENY, [why]
    return d


def _escalate(d: Decision, why: str) -> None:
    if d.action is not Action.DENY:
        d.action = Action.ESCALATE
    d.reasons.append(why)


def _session_spend(conn: sqlite3.Connection, session_id: str) -> int:
    r = conn.execute("SELECT COALESCE(SUM(amount_minor),0) s FROM intents WHERE session_id=?"
                     " AND status IN ('APPROVED','EXECUTED')", (session_id,)).fetchone()
    return int(r["s"])


def _day_spend(conn: sqlite3.Connection, now: int) -> int:
    r = conn.execute("SELECT COALESCE(SUM(amount_minor),0) s FROM intents WHERE created_at>?"
                     " AND status IN ('APPROVED','EXECUTED')", (now - 86400,)).fetchone()
    return int(r["s"])


def reserve(conn: sqlite3.Connection, intent: ledger.Intent, decision: Decision) -> dict:
    """Bounded execution reservation. Must be called inside a BEGIN EXCLUSIVE transaction."""
    if decision.action is not Action.ALLOW:
        ledger.record(conn, intent, decision.to_dict())
        ledger.settle(conn, intent.intent_id, decision.action.value)
        return {"executed": False, **decision.to_dict()}

    ledger.record(conn, intent, decision.to_dict())
    ledger.settle(conn, intent.intent_id, "APPROVED")
    return {"executed": False, "reserved": True, **decision.to_dict()}


def execute_provider(conn: sqlite3.Connection, client: Razorpay, intent: ledger.Intent,
                     decision: Decision) -> dict:
    """The external provider call, separated so the DB lock can be released first."""
    try:
        out = client.create_refund(intent.target_id, intent.amount_minor,
                                   idempotency_key=f"kavach-{intent.intent_id}",
                                   notes={"intent_id": intent.intent_id})
    except RazorpayError as e:
        ledger.settle(conn, intent.intent_id, "FAILED" if not e.retriable else "APPROVED")
        raise
    except Exception:
        # A network timeout, standard Exception, or anything else should not leak an obligation.
        # Mark it FAILED so the intent isn't stuck OPEN, and raise.
        ledger.settle(conn, intent.intent_id, "FAILED")
        raise
    ledger.settle(conn, intent.intent_id, "EXECUTED", result_id=out.get("id"))
    return {"executed": True, "refund_id": out.get("id"), **decision.to_dict()}


def new_intent(agent_id: str, session_id: str, payment_id: str, amount_minor: int,
               reason: str, now: int, tool: str = "create_refund") -> ledger.Intent:
    return ledger.Intent(str(uuid.uuid4()), agent_id, session_id, tool, "payment",
                         payment_id, amount_minor, reason, now)


def new_gate_intent(agent_id: str, session_id: str, tool: str, target_type: str,
                    target_id: str, amount_minor: int, reason: str,
                    now: int) -> ledger.Intent:
    """An intent over an arbitrary target. `new_intent` is the refund-shaped special case."""
    return ledger.Intent(str(uuid.uuid4()), agent_id, session_id, tool, target_type,
                         target_id, amount_minor, reason, now)
