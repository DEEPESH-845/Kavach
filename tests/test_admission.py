"""The authority ladder, tested by trying to break each rung with the rung below it.

The claims worth pinning are ordering claims, so every test here is of the form "X says one
thing, Y says another, and Y must not win". A stub model stands in for the estimator: this
file is about the policy, and a policy that only behaves when the model behaves is not a
policy. The real model meets the real corpus in commit 7.
"""

from __future__ import annotations

import json

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from kavach.gate.admission import (
    DEFAULT_COSTS,
    Costs,
    Verdict,
    decide,
    expected_losses,
)
from kavach.gate.envelope import Failure, register_issuer, revoke, verify
from kavach.gate.mandate import Cart, CartLine, Violation, record_admission, spent

T = 1_700_000_000
KEY_ID = "principal-key-1"
PRINCIPAL = "usr_priya"
CAP = 200000


class StubModel:
    """Returns whatever risk the test asks for. The ladder must not care where it came from."""

    def __init__(self, risk: float):
        self.risk = risk

    def score(self, row) -> float:
        return self.risk

    def explain(self, row, k: int = 4) -> list[str]:
        return [f"stub={self.risk:+.2f}"]


@pytest.fixture
def issuer(conn):
    key = Ed25519PrivateKey.generate()
    register_issuer(conn, KEY_ID, key.public_key().public_bytes_raw())
    return key


def signed(key, **overrides) -> tuple[bytes, bytes]:
    d = {"mandate_id": "mnd_1", "principal_id": PRINCIPAL, "agent_id": "agt_shopper",
         "purpose": "weekly groceries for the family", "merchant_allowlist": ["mrc_store"],
         "categories": ["grocery"], "per_txn_cap_minor": CAP,
         "cumulative_cap_minor": CAP * 4, "not_before": T - 60, "not_after": T + 3600,
         "nonce": "nonce-1", "issued_at": T - 60}
    d.update(overrides)
    raw = json.dumps(d).encode()
    return raw, key.sign(raw)


def cart(amount: int = 100000, *, category: str = "grocery",
         merchant: str = "mrc_store", cart_id: str = "cart_1") -> Cart:
    return Cart(cart_id=cart_id, merchant_id=merchant,
                lines=(CartLine(sku="milk", description="Amul Gold 1L", category=category,
                                unit_amount_minor=amount, quantity=1),))


def call(conn, key, *, risk=None, costs=DEFAULT_COSTS, now=T, c=None, **env_overrides):
    raw, sig = signed(key, **env_overrides)
    return decide(conn, raw, sig, c or cart(), key_id=KEY_ID, now=now,
                  expected_principal=PRINCIPAL, costs=costs,
                  model=None if risk is None else StubModel(risk))


# ──────────────────────────────── rung 1: envelope failures outrank everything below

def test_a_forged_envelope_is_denied_even_when_the_model_is_certain_it_is_fine(conn, issuer):
    raw, _ = signed(issuer)
    result = decide(conn, raw, b"x" * 64, cart(), key_id=KEY_ID, now=T, model=StubModel(0.0))
    assert result.verdict is Verdict.DENY
    assert result.failures == [Failure.BAD_SIGNATURE]
    assert result.risk is None, "the model was consulted on an envelope that failed to verify"


def test_a_revoked_mandate_is_denied_regardless_of_risk(conn, issuer):
    revoke(conn, "mnd_1", at=T - 1)
    assert call(conn, issuer, risk=0.0).verdict is Verdict.DENY


def test_an_expired_mandate_is_denied_regardless_of_risk(conn, issuer):
    assert call(conn, issuer, risk=0.0, now=T + 99999).verdict is Verdict.DENY


# ──────────────────────────────── rung 2: scope and caps outrank the model

def test_a_cap_breach_is_denied_even_at_zero_risk(conn, issuer):
    result = call(conn, issuer, risk=0.0, c=cart(CAP + 1))
    assert result.verdict is Verdict.DENY
    assert result.violations == [Violation.PER_TXN_CAP_EXCEEDED]


def test_an_out_of_scope_category_is_denied_even_at_zero_risk(conn, issuer):
    result = call(conn, issuer, risk=0.0, c=cart(category="electronics"))
    assert result.verdict is Verdict.DENY
    assert result.violations == [Violation.CATEGORY_OUT_OF_SCOPE]


def test_a_deterministic_denial_explains_itself_in_rupees(conn, issuer):
    result = call(conn, issuer, risk=0.0, c=cart(CAP + 50000))
    assert "2,500.00" in result.reasons[0] and "2,000.00" in result.reasons[0]


def test_a_cap_breach_outranks_the_missing_model_floor(conn, issuer):
    """DENY, not STEP_UP: no re-consent can make an over-cap cart admissible."""
    assert call(conn, issuer, risk=None, c=cart(CAP + 1)).verdict is Verdict.DENY


# ──────────────────────────────── rung 3: no model means no ALLOW

def test_a_missing_model_floors_at_step_up_and_never_allows(conn, issuer):
    result = call(conn, issuer, risk=None)
    assert result.verdict is Verdict.STEP_UP
    assert result.risk is None
    assert "cannot be assessed" in result.reasons[0]


def test_allow_is_unreachable_without_a_model(conn, issuer):
    """The strong claim: a cart is admitted only when something actually read it.

    Deterministic checks cannot tell whether an in-scope, in-budget cart is what the
    principal asked for -- that is the entire reason this plane exists.
    """
    for amount in (1, 1000, CAP // 2, CAP):
        result = call(conn, issuer, risk=None, c=cart(amount, cart_id=f"c{amount}"),
                      nonce=f"n{amount}")
        assert result.verdict is not Verdict.ALLOW


# ──────────────────────────────── rung 3: expected loss chooses among the rest

def test_a_confident_low_risk_cart_is_allowed(conn, issuer):
    result = call(conn, issuer, risk=0.0)
    assert result.verdict is Verdict.ALLOW
    assert result.expected_loss["ALLOW"] == 0.0


def test_a_confident_high_risk_cart_is_not_allowed(conn, issuer):
    assert call(conn, issuer, risk=0.99).verdict is not Verdict.ALLOW


@pytest.mark.parametrize("verdict", list(Verdict))
def test_every_verdict_is_reachable(conn, issuer, verdict):
    """A verdict that no input produces is dead code wearing a name."""
    cases = {
        Verdict.DENY: dict(risk=0.0, c=cart(CAP + 1)),
        Verdict.STEP_UP: dict(risk=None),
        Verdict.ALLOW: dict(risk=0.0),
        # a reviewer who is cheap and near-perfect, against a merchant whose margin makes
        # refusing a good cart expensive -- the case where looking at it wins
        Verdict.HOLD: dict(risk=0.9, costs=Costs(hold_minor=1, margin_share=1.0)),
    }
    assert call(conn, issuer, **cases[verdict]).verdict is verdict


def test_denial_is_not_free_so_it_cannot_be_the_safe_default(conn, issuer):
    """EL(DENY) rises as risk falls. A system that denies everything pays for every good
    cart it turned away, which is why margin_share exists at all."""
    losses = [expected_losses(p, 100000, DEFAULT_COSTS)[Verdict.DENY] for p in (0.0, 0.5, 1.0)]
    assert losses[0] > losses[1] > losses[2] == 0.0


def test_a_tie_breaks_toward_the_more_cautious_verdict(conn, issuer):
    """Costs that make ALLOW and STEP_UP exactly equal must not resolve toward the loss."""
    losses = expected_losses(0.5, 100000, DEFAULT_COSTS)
    tuned = Costs(step_up_minor=int(losses[Verdict.ALLOW] - 0.5 * 0.30 * 100000),
                  hold_minor=10**9, margin_share=10.0)
    result = call(conn, issuer, risk=0.5, costs=tuned)
    assert result.expected_loss["ALLOW"] == pytest.approx(result.expected_loss["STEP_UP"])
    assert result.verdict is Verdict.STEP_UP


# ──────────────────────────────── side effects and evidence

def test_deciding_does_not_charge_the_mandate(conn, issuer):
    """An ALLOW is a verdict, not a purchase. The caller records it deliberately."""
    assert call(conn, issuer, risk=0.0).verdict is Verdict.ALLOW
    assert spent(conn, "mnd_1") == 0


def test_an_envelope_is_single_use(conn, issuer):
    raw, sig = signed(issuer)
    first = decide(conn, raw, sig, cart(), key_id=KEY_ID, now=T, model=StubModel(0.0))
    second = decide(conn, raw, sig, cart(), key_id=KEY_ID, now=T, model=StubModel(0.0))
    assert first.verdict is Verdict.ALLOW
    assert second.verdict is Verdict.DENY
    assert second.failures == [Failure.REPLAYED_NONCE]


def test_the_verdict_cites_the_admissions_it_counted(conn, issuer):
    raw, sig = signed(issuer)
    env, _ = verify(conn, raw, sig, key_id=KEY_ID, now=T)
    record_admission(conn, env, cart(50000, cart_id="earlier"), now=T - 100)
    result = call(conn, issuer, risk=0.0, nonce="nonce-2")
    assert result.evidence, "a cap decision cited none of the spend it counted"
    assert result.mandate_id == "mnd_1"


def test_the_serialised_form_carries_every_reason_and_no_raw_minor_units(conn, issuer):
    out = call(conn, issuer, risk=0.2).to_dict()
    assert out["verdict"] in {v.value for v in Verdict}
    assert out["reasons"] and out["risk_factors"]
    assert all(isinstance(v, float) for v in out["expected_loss_rupees"].values())
