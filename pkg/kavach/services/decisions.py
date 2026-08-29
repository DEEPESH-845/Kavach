"""The outbound decision pipeline, in one place.

    intent -> truth -> exposure -> duplicate risk -> governor -> record -> event

Every caller that governs an outbound money movement -- the MCP tool surface, the HTTP API,
the demo seed, the adversary scenarios -- runs THIS. There is deliberately no second,
simpler path: a "just for the dashboard" evaluator is how a demo ends up showing a verdict
the real system would never produce, and this module exists because that is exactly what
was here before.

Two things this module owns and nothing else does:

  * the duplicate-risk feature row. It was built inline in mcp/server.py, so an API that
    wanted a score had to either import a private helper or invent its own -- and an
    invented one scores a different question with the same name.

  * writing the decision into the event log. A decision that lives only in the `intents`
    table is a decision nobody can prove: `intents.decision` is a mutable column, while
    eventlog rows are hash-chained to their predecessor. Recording the decision as an event
    is what makes "here is why we refused, and here is proof we are not telling you this
    after the fact" a true sentence.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from .. import governor, ledger
from ..eventlog import append
from ..intelligence.model import Model
from ..truth import Confidence

DECIDED = "governor.decided"

# The statuses governor.reserve() actually writes. Everything that reads intent state must
# agree with the writer, so the vocabulary is defined once, here, rather than re-spelled
# ('ESCALATED', 'BLOCKED') at each query site the way it was.
PROPOSED = "PROPOSED"
APPROVED = "APPROVED"
EXECUTED = "EXECUTED"
FAILED = "FAILED"
ESCALATED = "ESCALATE"
DENIED = "DENY"

REVIEW_STATUSES = (ESCALATED,)
REFUSED_STATUSES = (DENIED,)
#: An intent we committed to but hold no provider result for. The reconciler's queue.
UNRESOLVED_STATUSES = (APPROVED, FAILED)


def risk_row(conn: sqlite3.Connection, intent: ledger.Intent, now: int) -> dict[str, Any]:
    """The feature row the duplicate-risk estimator expects.

    Nothing here reaches forward in time: `prior` is only intents already recorded against
    the same target, which is exactly what would exist at the moment of a real decision.
    """
    priors = ledger.prior_intents(conn, intent.target_type, intent.target_id)
    fact = ledger.fact_for(conn, "payment", intent.target_id, now)
    return {
        "payment_id": intent.target_id,
        "payment_amount": max(1, fact.amount_minor if fact else 0),
        "t": intent.created_at,
        "amount": intent.amount_minor,
        "reason": intent.reason_text,
        "session_id": intent.session_id,
        "agent_id": intent.agent_id,
        "prior": [{"amount": p.amount_minor, "reason": p.reason_text, "t": p.created_at,
                   "session_id": p.session_id, "agent_id": p.agent_id, "status": p.status,
                   "result_known": p.result_id is not None} for p in priors],
        "open_amount": ledger.exposure(conn, intent.target_id, now),
        "open_count": len(ledger.open_against_payment(conn, intent.target_id, now)),
    }


def score_risk(conn: sqlite3.Connection, intent: ledger.Intent, model: Model | None,
               now: int) -> tuple[float | None, list[str]]:
    """(score, attribution). None means "not assessed", which the governor treats as a
    reason for caution -- never as a reason to proceed."""
    if model is None:
        return None, []
    row = risk_row(conn, intent, now)
    if not row["prior"]:
        # The estimator is only defined where a duplicate is possible. A first-ever intent
        # on a target has nothing to duplicate, and scoring it would be inventing a number.
        return 0.0, ["no prior intent on this target, so there is nothing to duplicate"]
    return model.score(row), model.explain(row)


def evaluate(conn: sqlite3.Connection, intent: ledger.Intent, *, now: int,
             policy: governor.Policy,
             model: Model | None = None) -> tuple[governor.Decision, dict[str, Any]]:
    """Decide, without writing anything. Returns the decision and the truth it read.

    Pure with respect to the database, so the API can offer a genuine dry run and the
    adversary lab can show a verdict without moving the ledger underneath it.
    """
    fact = ledger.fact_for(conn, "payment", intent.target_id, now)
    score, explain = score_risk(conn, intent, model, now)
    decision = governor.decide(
        conn, intent=intent,
        payment_amount_minor=fact.amount_minor if fact else 0,
        # CONFIRMED is the only rail state that means the money is actually ours to return.
        payment_captured=bool(fact and fact.rail_state.value == "CONFIRMED"),
        now=now, policy=policy, risk_score=score, risk_explain=explain)

    truth = {
        "found": fact is not None,
        "fact": fact.to_agent() if fact else None,
        "captured": bool(fact and fact.rail_state.value == "CONFIRMED"),
        "confidence": fact.confidence.value if fact else Confidence.UNKNOWN.value,
        "open_obligations": [f.to_agent()
                             for f in ledger.open_against_payment(conn, intent.target_id, now)],
    }
    return decision, truth


def record(conn: sqlite3.Connection, intent: ledger.Intent, decision: governor.Decision,
           *, now: int) -> dict[str, Any]:
    """Persist the intent, its decision, and an event proving both.

    Wrapped in a savepoint rather than a bare sequence: a decision recorded without its
    event, or an event recorded without its decision, is a hole in the audit trail, and a
    hole is worse than a failure because nothing reports it.
    """
    payload = decision.to_dict()
    conn.execute("SAVEPOINT record_decision")
    try:
        out = governor.reserve(conn, intent, decision)
        seq, _ = append(
            conn, source="governor", external_id=f"decision:{intent.intent_id}",
            entity_type="intent", entity_id=intent.intent_id,
            parent_entity_id=intent.target_id,
            event_type=f"{DECIDED}.{decision.action.value.lower()}",
            payload={"intent_id": intent.intent_id, "agent_id": intent.agent_id,
                     "session_id": intent.session_id, "tool": intent.tool,
                     "target": f"{intent.target_type}:{intent.target_id}",
                     "amount_minor": intent.amount_minor,
                     "reason_text": intent.reason_text, "decision": payload},
            occurred_at=now, received_at=now,
            # Our own assertion, not a signature-verified message from the rail. Marking it
            # verified would make the truth plane trust us the way it trusts Razorpay.
            sig_verified=False)
        conn.execute("RELEASE SAVEPOINT record_decision")
    except Exception:
        conn.execute("ROLLBACK TO SAVEPOINT record_decision")
        raise
    return {**out, "intent_id": intent.intent_id, "decision_event_seq": seq}


def evaluate_and_record(conn: sqlite3.Connection, intent: ledger.Intent, *, now: int,
                        policy: governor.Policy,
                        model: Model | None = None) -> dict[str, Any]:
    """The whole outbound pipeline: decide, then durably record why.

    Does NOT call Razorpay. Execution is a separate, deliberate step
    (governor.execute_provider) so that a decision can be recorded even when the provider
    call cannot be made -- which is the state the reconciler exists to resolve.
    """
    decision, truth = evaluate(conn, intent, now=now, policy=policy, model=model)
    out = record(conn, intent, decision, now=now)
    return {**out, "truth": truth}
