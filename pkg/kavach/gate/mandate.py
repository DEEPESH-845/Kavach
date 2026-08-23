"""Mandate scope and cap arithmetic: does this cart fit what the principal delegated?

This is the deterministic half of admission, and it is deliberately unremarkable. Caps and
allowlists are what AP2, UPI Reserve Pay and Stripe Issuing already ship; claiming them as
novel would be wrong (ADR-009). They are here because the interesting question -- does the
cart entail the mandate's stated PURPOSE -- is only worth asking about a cart that already
passes the boring checks.

Two things are load-bearing.

Cumulative spend is recomputed from the event log on every call. A counter column would be a
second copy of a derived number, and a second copy drifts silently: the moment it disagrees
with the log, the cap is enforcing a number nobody can reconstruct. ledger.py already takes
this position for open obligations, for the same reason. The cost is a scan; at demo scale
that is nothing, and the ceiling is stated in ADR-016 rather than hidden.

All arithmetic is in integer minor units. No float touches money anywhere in this module.
Phase 1 is INR only: the Envelope carries no currency field and none is checked, because
comparing against a field that does not exist is theatre.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from enum import StrEnum

from ..eventlog import Event, append, for_entity
from .envelope import Envelope

ADMITTED = "gate.admitted"


class Violation(StrEnum):
    """Why a cart does not fit its mandate. Typed for the same reason envelope failures are:
    a bare False cannot be audited, explained to a merchant, or counted in an eval."""

    EMPTY_CART = "EMPTY_CART"
    MERCHANT_NOT_ALLOWED = "MERCHANT_NOT_ALLOWED"
    CATEGORY_OUT_OF_SCOPE = "CATEGORY_OUT_OF_SCOPE"
    PER_TXN_CAP_EXCEEDED = "PER_TXN_CAP_EXCEEDED"
    CUMULATIVE_CAP_EXCEEDED = "CUMULATIVE_CAP_EXCEEDED"


@dataclass(frozen=True)
class CartLine:
    """One line of a cart, priced per unit.

    The price field is named `unit_amount_minor` rather than `amount_minor` because the
    difference between a unit price and a line total is one silent factor-of-quantity bug,
    and this is the money path.
    """

    sku: str
    description: str
    category: str
    unit_amount_minor: int
    quantity: int = 1
    liquid: bool = False        # gift card, stored value, trivially resaleable

    @property
    def total_minor(self) -> int:
        return self.unit_amount_minor * self.quantity


@dataclass(frozen=True)
class Cart:
    """A cart as the merchant's own storefront built it.

    NOT a trust boundary: category and `liquid` are the merchant's catalogue facts, not
    claims by the arriving agent. That is exactly why they can be relied on here, and it is
    why this module does no input validation on them. If a cart ever arrives from the agent
    side instead, that assumption dies and this comment is the thing that should stop it.
    """

    cart_id: str
    merchant_id: str
    lines: tuple[CartLine, ...]

    @property
    def total_minor(self) -> int:
        """Derived, never stored. A stored total is a total that can disagree with its
        lines, and the disagreement is what an attacker would aim at."""
        return sum(line.total_minor for line in self.lines)


def admissible(conn: sqlite3.Connection, env: Envelope, cart: Cart, *,
               now: int) -> list[Violation]:
    """Every way this cart fails its mandate. Empty list means it fits.

    All violations are returned, not the first: a merchant debugging an integration should
    learn everything wrong in one round-trip. Pure -- this decides nothing and records
    nothing; record_admission() is the separate, deliberate act of spending the mandate.
    """
    violations: list[Violation] = []

    # An empty cart satisfies every cap arithmetically. Admitting one is admitting nothing,
    # which is not a pass -- it is a malformed request wearing a pass.
    if not cart.lines:
        violations.append(Violation.EMPTY_CART)

    if cart.merchant_id not in env.merchant_allowlist:
        violations.append(Violation.MERCHANT_NOT_ALLOWED)

    # An empty scope permits nothing, rather than everything. Fail closed: a mandate that
    # named no categories delegated no category, and the opposite reading is how a scope
    # check becomes a no-op the first time someone ships an envelope with a missing field.
    if any(line.category not in env.categories for line in cart.lines):
        violations.append(Violation.CATEGORY_OUT_OF_SCOPE)

    total = cart.total_minor
    if total > env.per_txn_cap_minor:
        violations.append(Violation.PER_TXN_CAP_EXCEEDED)

    if spent(conn, env.mandate_id) + total > env.cumulative_cap_minor:
        violations.append(Violation.CUMULATIVE_CAP_EXCEEDED)

    return violations


def prior_admissions(conn: sqlite3.Connection, mandate_id: str) -> list[Event]:
    """Admissions already charged against this mandate, in causal order.

    This is the evidence chain behind every cumulative-cap decision: the exact events whose
    amounts were counted, citable by seq the same way a FinancialFact cites its own.
    """
    return [e for e in for_entity(conn, "mandate", mandate_id) if e.event_type == ADMITTED]


def spent(conn: sqlite3.Connection, mandate_id: str) -> int:
    """Cumulative minor units admitted against this mandate, recomputed from the log.

    Deliberately takes no `now`: a mandate's own validity window already bounds when
    admissions could have happened, so a time filter here would be a second, weaker copy of
    a rule envelope.verify() already enforces.
    """
    return sum(int(e.payload["total_minor"]) for e in prior_admissions(conn, mandate_id))


def record_admission(conn: sqlite3.Connection, env: Envelope, cart: Cart, *,
                     now: int) -> tuple[int, bool]:
    """Charge this cart against the mandate. Returns (event seq, is_new).

    Idempotent on the cart id, inheriting eventlog's (source, external_id) guard for free:
    re-admitting the same cart counts once, so a retried admission cannot inflate cumulative
    spend. A genuinely new cart is a new id and is charged, which is the correct asymmetry --
    the same one ADR-008 draws between a replayed request and a re-decided one.
    """
    return append(
        conn, source="gate", external_id=f"admission:{cart.cart_id}",
        entity_type="mandate", entity_id=env.mandate_id, event_type=ADMITTED,
        payload={"cart_id": cart.cart_id, "merchant_id": cart.merchant_id,
                 "total_minor": cart.total_minor, "agent_id": env.agent_id,
                 "lines": [{"sku": line.sku, "category": line.category,
                            "total_minor": line.total_minor, "liquid": line.liquid}
                           for line in cart.lines]},
        occurred_at=now, received_at=now,
        # This record exists only because envelope.verify() checked an Ed25519 signature
        # over the mandate it is charged against, so the provenance claim is true here.
        sig_verified=True)
