"""The governor. Its one job is that the model can only ever widen caution (ADR-006)."""

from __future__ import annotations

from kavach import ledger
from kavach.governor import Action, Decision, Policy, decide, execute, new_intent
from kavach.razorpay.client import Razorpay

T = 1_700_000_000
POLICY = Policy()


def intent(amount, reason="customer complained", session="s1"):
    return new_intent("agent_1", session, "pay_X", amount, reason, T + 200)


def judge(conn, amount, *, captured=True, payment=500_00, risk=None, now=T + 200,
          explain=None):
    return decide(conn, intent=intent(amount), payment_amount_minor=payment,
                  payment_captured=captured, now=now, policy=POLICY, risk_score=risk,
                  risk_explain=explain)


def test_clean_intent_is_allowed(conn):
    d = judge(conn, 50_00, risk=0.02)
    assert d.action is Action.ALLOW, d.reasons


def test_uncaptured_payment_is_denied_not_escalated(conn):
    """No human can approve refunding money that was never taken, so this must not reach
    the approval queue at all."""
    assert judge(conn, 50_00, captured=False).action is Action.DENY


def test_over_refund_invariant_beats_a_confident_model(conn, refund_event):
    """The accounting invariant sits above the model in the authority order. A risk score of
    0.0 does not buy permission to refund more than was captured."""
    refund_event("rfnd_1", "processed", T + 100, amount=400_00)
    d = judge(conn, 200_00, risk=0.0)

    assert d.action is Action.DENY
    assert "may not exceed" in d.reasons[0]


def test_high_duplicate_risk_escalates_but_never_denies(conn):
    """The model can be wrong, so a legitimate refund must stay reachable through a human."""
    d = judge(conn, 50_00, risk=0.97, explain=["dup_evidence=+3.1"])

    assert d.action is Action.ESCALATE
    assert any("duplicate-risk" in r for r in d.reasons)


def test_a_confident_model_cannot_unlock_a_cap_breach(conn):
    d = decide(conn, intent=intent(2_000_00), payment_amount_minor=5_000_00,
               payment_captured=True, now=T + 200, policy=POLICY, risk_score=0.0)

    assert d.action is Action.ESCALATE
    assert any("autonomous limit" in r for r in d.reasons)


def test_ambiguous_open_obligation_escalates_despite_low_risk(conn, refund_event):
    """If we cannot say what is already in flight, we cannot say what a new refund would
    duplicate. Unknown state raises the floor to human approval."""
    refund_event("rfnd_s", "processed", T, amount=100_00)
    d = judge(conn, 50_00, risk=0.01, now=T + 10 * 3600)

    assert d.action is Action.ESCALATE
    assert any("AMBIGUOUS" in r for r in d.reasons)


def test_read_only_tier_cannot_move_money(conn):
    d = decide(conn, intent=intent(50_00), payment_amount_minor=500_00, payment_captured=True,
               now=T + 200, policy=Policy(allow_write=False), risk_score=0.0)
    assert d.action is Action.DENY


def test_session_cap_escalates(conn):
    ledger.record(conn, ledger.Intent("prior", "agent_1", "s1", "create_refund", "payment",
                                      "pay_X", 4_900_00, "earlier", T, "EXECUTED"))
    d = decide(conn, intent=intent(500_00), payment_amount_minor=100_000_00,
               payment_captured=True, now=T + 200, policy=POLICY, risk_score=0.0)

    assert d.action is Action.ESCALATE
    assert any("session would reach" in r for r in d.reasons)


def test_a_blocked_intent_is_still_durable(conn):
    """Refusing to act is itself an auditable event. If blocked intents were not written we
    would have no record that an agent tried."""
    i = intent(2_000_00)
    out = execute(conn, Razorpay(mode="replay", cassette="/nonexistent"), i,
                  Decision(Action.ESCALATE, ["over limit"]))

    assert out["executed"] is False
    assert ledger.prior_intents(conn, "payment", "pay_X")[0].status == "ESCALATE"


def test_decision_serialises_with_its_evidence(conn, refund_event):
    refund_event("rfnd_1", "processed", T + 100, amount=100_00)
    d = judge(conn, 50_00, risk=0.9)
    payload = d.to_dict()

    assert payload["action"] == "ESCALATE"
    assert payload["reasons"] and payload["evidence_events"]
    assert payload["duplicate_risk"] == 0.9
