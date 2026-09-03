"""Step-up is a real cross-device state machine, and approval cannot reach past the gate."""

from __future__ import annotations

import pytest
from kavach.gate import envelope, mandate
from kavach.services import gate as gate_service
from kavach.services import stepup, storefront

T = 1_700_000_000


class StubModel:
    def __init__(self, risk: float):
        self.risk = risk

    def score(self, row) -> float:
        return self.risk

    def explain(self, row, k: int = 4) -> list[str]:
        return [f"stub={self.risk:+.2f}"]


@pytest.fixture
def db(conn):
    stepup.init(conn)
    gate_service.register_demo_issuer(conn)
    return conn


def _stepup(conn, *, risk: float = 0.10, nonce: str = "n1"):
    """A real STEP_UP admission: the lamp cart under a stub model in the re-consent band."""
    m = {**storefront.default_mandate(T), "nonce": nonce}
    p = storefront.plan(m, "stepup")
    cart = {"cart_id": f"cart_{nonce}", "merchant_id": p["merchant_id"], "lines": p["lines"],
            "untrusted_context": ""}
    adm = gate_service.admit(conn, envelope_body=m, cart_id=cart["cart_id"],
                             merchant_id=cart["merchant_id"], lines=cart["lines"], now=T,
                             expected_principal=m["principal_id"], model=StubModel(risk),
                             charge=False)
    assert adm["verdict"] == "STEP_UP", adm["reasons"]
    return m, cart, adm


def test_only_a_step_up_verdict_may_ask_the_principal(db):
    m, cart, adm = _stepup(db)
    with pytest.raises(stepup.StepUpError) as e:
        stepup.create(db, mandate_body=m, cart=cart,
                      admission_result={**adm, "verdict": "ALLOW"}, now=T)
    assert e.value.code == "not_step_up"


def test_the_phone_view_is_narrow_and_never_carries_the_envelope(db):
    m, cart, adm = _stepup(db)
    tok = stepup.create(db, mandate_body=m, cart=cart, admission_result=adm, now=T)["token"]
    assert len(tok) >= 32
    v = stepup.view(db, tok, T + 5)
    assert v["status"] == "PENDING"
    assert v["amount_minor"] == 250_000
    assert v["items"][0]["quantity"] == 1
    assert v["seconds_left"] == stepup.TTL - 5
    for forbidden in ("nonce", "not_after", "merchant_allowlist", "signature"):
        assert forbidden not in v


def test_approve_reruns_admission_then_charges_the_mandate(db):
    m, cart, adm = _stepup(db)
    tok = stepup.create(db, mandate_body=m, cart=cart, admission_result=adm, now=T)["token"]
    assert mandate.spent(db, m["mandate_id"]) == 0
    out = stepup.resolve(db, tok, action="approve", now=T + 30, resolver="priya-phone",
                         model=StubModel(0.10))
    assert out["applied"] is True and out["status"] == "APPROVED"
    assert out["charged"] is True
    assert mandate.spent(db, m["mandate_id"]) == 250_000
    kinds = [r["event_type"] for r in db.execute("SELECT event_type FROM events")]
    assert "stepup.approved" in kinds and "gate.admitted" in kinds
    # the nonce is now spent, exactly as a direct ALLOW would have spent it
    assert not envelope.claim_nonce_for_env(db, stepup._envelope(m), T + 31)


def test_deny_records_the_refusal_and_charges_nothing(db):
    m, cart, adm = _stepup(db)
    tok = stepup.create(db, mandate_body=m, cart=cart, admission_result=adm, now=T)["token"]
    out = stepup.resolve(db, tok, action="deny", now=T + 30)
    assert out["status"] == "DENIED" and out["charged"] is False
    assert mandate.spent(db, m["mandate_id"]) == 0
    assert stepup.view(db, tok, T + 40)["status"] == "DENIED"


def test_repeating_the_same_action_is_idempotent_and_the_opposite_conflicts(db):
    m, cart, adm = _stepup(db)
    tok = stepup.create(db, mandate_body=m, cart=cart, admission_result=adm, now=T)["token"]
    first = stepup.resolve(db, tok, action="approve", now=T + 1, model=StubModel(0.1))
    again = stepup.resolve(db, tok, action="approve", now=T + 2, model=StubModel(0.1))
    assert first["applied"] and not again["applied"]
    assert mandate.spent(db, m["mandate_id"]) == 250_000     # charged once
    with pytest.raises(stepup.StepUpError) as e:
        stepup.resolve(db, tok, action="deny", now=T + 3)
    assert e.value.code == "already_resolved"


def test_an_expired_request_cannot_be_approved(db):
    m, cart, adm = _stepup(db)
    tok = stepup.create(db, mandate_body=m, cart=cart, admission_result=adm, now=T)["token"]
    with pytest.raises(stepup.StepUpError) as e:
        stepup.resolve(db, tok, action="approve", now=T + stepup.TTL + 1, model=StubModel(0.1))
    assert e.value.code == "expired"
    assert stepup.view(db, tok, T + stepup.TTL + 2)["status"] == "EXPIRED"


def test_unknown_token_and_bad_action_are_typed_failures(db):
    with pytest.raises(stepup.StepUpError) as e:
        stepup.view(db, "nope", T)
    assert e.value.code == "not_found"
    m, cart, adm = _stepup(db)
    tok = stepup.create(db, mandate_body=m, cart=cart, admission_result=adm, now=T)["token"]
    with pytest.raises(stepup.StepUpError) as e:
        stepup.resolve(db, tok, action="maybe", now=T)
    assert e.value.code == "invalid_action"


def test_approval_cannot_reach_past_a_mandate_revoked_in_between(db):
    """The tap arrives after the principal revoked. Revocation is read at decision time, so
    the approval is refused with the gate's reason and nothing is charged."""
    m, cart, adm = _stepup(db)
    tok = stepup.create(db, mandate_body=m, cart=cart, admission_result=adm, now=T)["token"]
    envelope.revoke(db, m["mandate_id"], at=T + 10, reason="phone reported stolen")
    with pytest.raises(stepup.StepUpError) as e:
        stepup.resolve(db, tok, action="approve", now=T + 20, model=StubModel(0.1))
    assert e.value.code == "re_admission_refused"
    assert "REVOKED" in e.value.message
    assert mandate.spent(db, m["mandate_id"]) == 0
    assert stepup.view(db, tok, T + 21)["status"] == "PENDING"


def test_pending_lists_only_open_requests(db):
    m, cart, adm = _stepup(db, nonce="a")
    stepup.create(db, mandate_body=m, cart=cart, admission_result=adm, now=T)
    m2, cart2, adm2 = _stepup(db, nonce="b")
    tok2 = stepup.create(db, mandate_body=m2, cart=cart2, admission_result=adm2, now=T)["token"]
    stepup.resolve(db, tok2, action="deny", now=T + 1)
    assert len(stepup.pending(db, T + 2)) == 1
