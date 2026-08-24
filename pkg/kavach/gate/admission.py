"""The verdict: ALLOW, STEP_UP, HOLD or DENY, chosen by expected loss.

Authority runs strongest-first, exactly as governor.decide does on the outbound side:

  1. Envelope failures      -- forged, expired, replayed, revoked.        DENY.
  2. Scope and cap breaches -- deterministic arithmetic.                  DENY.
  3. Entailment risk        -- expected loss over the remaining three.

The ordering is the point. A deterministic refusal is not a strong opinion the model can
argue with; it is arithmetic, and nothing below it in this file can reach past it. The model
never turns a DENY into anything else.

The converse also holds and is worth stating plainly: ALLOW is reachable ONLY through a
model that actually read the cart. With no model there is no ALLOW, because the deterministic
layer cannot tell whether a perfectly in-scope, perfectly in-budget cart is what the
principal asked for -- that is the entire reason this plane exists. A missing model
therefore raises the floor to STEP_UP rather than opening the gate (ADR-006).

NOT SIDE-EFFECT FREE. envelope.verify() claims the envelope's nonce, so a mandate is
single-use: calling decide() twice with the same envelope returns REPLAYED_NONCE the second
time. That is the intended semantics -- an envelope is presented once, at one checkout, for
one cart -- but it means this cannot be used as a speculative dry run.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from enum import StrEnum

from ..intelligence.model import Model
from . import mandate
from .envelope import Envelope, Failure, verify
from .mandate import Cart, Violation


class Verdict(StrEnum):
    ALLOW = "ALLOW"
    STEP_UP = "STEP_UP"   # re-consent from the principal; the buyer's side
    HOLD = "HOLD"         # merchant review; the merchant's side
    DENY = "DENY"         # never admissible, and no human waves it through here


# Caution order, weakest first. Used only to break expected-loss ties toward the safer
# option, because a tie resolved toward ALLOW is a tie resolved toward the loss.
_CAUTION = {Verdict.ALLOW: 0, Verdict.STEP_UP: 1, Verdict.HOLD: 2, Verdict.DENY: 3}


@dataclass(frozen=True)
class Costs:
    """Merchant-supplied economics. Every rate here is a STATED ASSUMPTION, not a measurement.

    No public figure exists for how often a re-consent prompt or a manual review actually
    stops a bad cart, so these defaults are declared, reported alongside every result, and
    swept for sensitivity -- the same discipline ADR-014 forced on the 12% duplicate base
    rate. A number invented here and then quoted as a finding would be the exact failure
    this project spends its README warning about.
    """

    fraud_loss_share: float = 1.0      # of a bad cart's value, how much is actually lost
    margin_share: float = 0.15         # of a good cart's value, the margin forgone if refused
    step_up_minor: int = 4_000         # friction cost of asking the principal again
    hold_minor: int = 15_000           # cost of a human looking at it
    step_up_catch_rate: float = 0.70   # ASSUMPTION: share of bad carts a re-consent stops
    hold_catch_rate: float = 0.95      # ASSUMPTION: share of bad carts a reviewer stops


DEFAULT_COSTS = Costs()


@dataclass
class Admission:
    verdict: Verdict
    reasons: list[str] = field(default_factory=list)
    failures: list[Failure] = field(default_factory=list)
    violations: list[Violation] = field(default_factory=list)
    risk: float | None = None
    risk_factors: list[str] = field(default_factory=list)
    evidence: list[int] = field(default_factory=list)
    expected_loss: dict[str, float] = field(default_factory=dict)
    mandate_id: str | None = None
    # Present whenever the ENVELOPE verified, even if the cart was then refused. Carried so
    # a caller can charge the mandate without verifying twice -- the nonce is already spent
    # by then, so a second verify() would fail.
    envelope: Envelope | None = None

    def to_dict(self) -> dict:
        return {"verdict": self.verdict.value, "reasons": self.reasons,
                "envelope_failures": [f.value for f in self.failures],
                "scope_violations": [v.value for v in self.violations],
                "purpose_risk": self.risk, "risk_factors": self.risk_factors,
                "evidence_events": self.evidence,
                "expected_loss_rupees": {k: round(v / 100, 2)
                                         for k, v in self.expected_loss.items()},
                "mandate_id": self.mandate_id}


def expected_losses(risk: float, cart_total_minor: int, costs: Costs) -> dict[Verdict, float]:
    """Expected loss in minor units for each verdict, given the probability the cart is bad.

    Allowing a bad cart loses its value. Intervening costs something whether or not the cart
    was bad, and only catches some share of the bad ones. Refusing loses the margin on the
    good carts refused -- which is why DENY is not free and cannot be the safe default.
    """
    at_risk = cart_total_minor * costs.fraud_loss_share
    return {
        Verdict.ALLOW: risk * at_risk,
        Verdict.STEP_UP: costs.step_up_minor + risk * (1 - costs.step_up_catch_rate) * at_risk,
        Verdict.HOLD: costs.hold_minor + risk * (1 - costs.hold_catch_rate) * at_risk,
        Verdict.DENY: (1 - risk) * cart_total_minor * costs.margin_share,
    }


def decide(conn: sqlite3.Connection, raw: bytes, signature: bytes, cart: Cart, *,
           key_id: str, now: int, expected_principal: str | None = None,
           costs: Costs = DEFAULT_COSTS, model: Model | None = None) -> Admission:
    """Admit, step up, hold or refuse this cart. See the module docstring on single use.

    Pure with respect to the ledger: an ALLOW here does not charge the mandate. The caller
    records that with mandate.record_admission(), and until it does this cart is not counted
    against the cumulative cap.
    """
    env, failures = verify(conn, raw, signature, key_id=key_id, now=now,
                           expected_principal=expected_principal)
    if env is None:
        return Admission(Verdict.DENY, failures=failures,
                         reasons=[f"delegation envelope rejected: "
                                  f"{', '.join(f.value for f in failures)}"])

    result = Admission(Verdict.ALLOW, mandate_id=env.mandate_id, envelope=env)
    result.evidence = [e.seq for e in mandate.prior_admissions(conn, env.mandate_id)]

    violations = mandate.admissible(conn, env, cart, now=now)
    if violations:
        result.verdict = Verdict.DENY
        result.violations = violations
        result.reasons = [_violation_reason(v, env, cart, conn) for v in violations]
        return result

    if model is None:
        result.verdict = Verdict.STEP_UP
        result.reasons = [
            "no entailment model is available, so whether this cart matches the mandate's "
            "stated purpose cannot be assessed; re-consent is required rather than assumed"]
        return result

    row = {"env": env, "cart": cart}
    result.risk = model.score(row)
    result.risk_factors = model.explain(row)
    losses = expected_losses(result.risk, cart.total_minor, costs)
    result.expected_loss = {v.value: loss for v, loss in losses.items()}
    result.verdict = min(losses, key=lambda v: (losses[v], -_CAUTION[v]))
    result.reasons = [
        f"purpose-mismatch risk {result.risk:.2f} on a cart of "
        f"{cart.total_minor / 100:,.2f}; {result.verdict.value} carries the lowest expected "
        f"loss at {losses[result.verdict] / 100:,.2f}",
        f"purpose: {env.purpose!r}"]
    return result


def admit(conn: sqlite3.Connection, raw: bytes, signature: bytes, cart: Cart, *,
          key_id: str, now: int, expected_principal: str | None = None,
          costs: Costs = DEFAULT_COSTS, model: Model | None = None) -> Admission:
    """decide(), and on ALLOW charge the mandate. The call a tool surface should make.

    decide() stays free of ledger side effects so the ladder can be tested without one, the
    same split governor.decide and governor.execute already use. This wrapper exists so the
    charging step lives where tests can reach it rather than inside the MCP module, which
    opens its database at import and is therefore transport, not logic.
    """
    result = decide(conn, raw, signature, cart, key_id=key_id, now=now,
                    expected_principal=expected_principal, costs=costs, model=model)
    if result.verdict is Verdict.ALLOW and result.envelope is not None:
        mandate.record_admission(conn, result.envelope, cart, now=now)
    return result


def _violation_reason(v: Violation, env: Envelope, cart: Cart,
                      conn: sqlite3.Connection) -> str:
    if v is Violation.PER_TXN_CAP_EXCEEDED:
        return (f"cart of {cart.total_minor / 100:,.2f} exceeds the per-transaction cap of "
                f"{env.per_txn_cap_minor / 100:,.2f}")
    if v is Violation.CUMULATIVE_CAP_EXCEEDED:
        already = mandate.spent(conn, env.mandate_id)
        return (f"mandate has already spent {already / 100:,.2f}; this cart would take it "
                f"past its cumulative cap of {env.cumulative_cap_minor / 100:,.2f}")
    if v is Violation.CATEGORY_OUT_OF_SCOPE:
        out = sorted({line.category for line in cart.lines
                      if line.category not in env.categories})
        return f"cart contains {', '.join(out)}, outside the delegated scope {env.categories}"
    if v is Violation.MERCHANT_NOT_ALLOWED:
        return f"{cart.merchant_id} is not on this mandate's merchant allowlist"
    return "cart is empty, so there is nothing to admit"
