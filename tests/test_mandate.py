"""Scope and cap arithmetic, tested at the edges where money decisions actually break.

Boundaries get their own tests because off-by-one on a cap is the difference between a
mandate that works and one that silently permits one rupee more forever, and the mutation
report for this module is only meaningful if the exact-limit cases are pinned.
"""

from __future__ import annotations

import pytest
from kavach.gate.envelope import Envelope
from kavach.gate.mandate import (
    Cart,
    CartLine,
    Violation,
    admissible,
    prior_admissions,
    record_admission,
    spent,
)

T = 1_700_000_000
PER_TXN = 200000        # Rs 2,000
CUMULATIVE = 500000     # Rs 5,000


def mandate(**overrides) -> Envelope:
    d = {"mandate_id": "mnd_1", "principal_id": "usr_priya", "agent_id": "agt_shopper",
         "purpose": "weekly groceries under Rs 2,000",
         "merchant_allowlist": ("mrc_bigbasket",), "categories": ("grocery", "household"),
         "per_txn_cap_minor": PER_TXN, "cumulative_cap_minor": CUMULATIVE,
         "not_before": T - 60, "not_after": T + 3600, "nonce": "n1", "issued_at": T - 60}
    d.update(overrides)
    return Envelope(**d)


def cart(*lines: CartLine, cart_id: str = "cart_1", merchant: str = "mrc_bigbasket") -> Cart:
    return Cart(cart_id=cart_id, merchant_id=merchant, lines=lines)


def line(amount: int, *, category: str = "grocery", qty: int = 1, liquid: bool = False):
    return CartLine(sku="sku_1", description="Amul Gold 1L", category=category,
                    unit_amount_minor=amount, quantity=qty, liquid=liquid)


def admit(conn, env, c, *, now=T):
    record_admission(conn, env, c, now=now)


# ─────────────────────────────────────────────────────────── the fitting cart

def test_a_cart_inside_every_bound_is_admissible(conn):
    assert admissible(conn, mandate(), cart(line(150000)), now=T) == []


def test_quantity_multiplies_into_the_line_total(conn):
    """3 x Rs 600 is Rs 1,800, not Rs 600. The classic silent factor-of-quantity bug."""
    c = cart(line(60000, qty=3))
    assert c.total_minor == 180000
    assert admissible(conn, mandate(), c, now=T) == []


def test_the_cart_total_is_derived_from_its_lines(conn):
    assert cart(line(1000, qty=2), line(500, qty=3)).total_minor == 3500


# ─────────────────────────────────────────────────────────── cap boundaries

def test_a_cart_exactly_at_the_per_transaction_cap_is_admitted(conn):
    assert admissible(conn, mandate(), cart(line(PER_TXN)), now=T) == []


def test_one_minor_unit_over_the_per_transaction_cap_is_refused(conn):
    assert admissible(conn, mandate(), cart(line(PER_TXN + 1)), now=T) == [
        Violation.PER_TXN_CAP_EXCEEDED]


def test_cumulative_spend_exactly_at_the_cap_is_admitted(conn):
    env = mandate()
    admit(conn, env, cart(line(300000), cart_id="c1"))
    assert admissible(conn, env, cart(line(200000), cart_id="c2"), now=T) == []


def test_one_minor_unit_over_the_cumulative_cap_is_refused(conn):
    """Kept under the per-transaction cap so the cumulative rule is the only thing tested."""
    env = mandate()
    admit(conn, env, cart(line(200000), cart_id="c1"))
    admit(conn, env, cart(line(200000), cart_id="c2"))
    assert admissible(conn, env, cart(line(100001), cart_id="c3"), now=T) == [
        Violation.CUMULATIVE_CAP_EXCEEDED]


# ─────────────────────────────────────────────────────────── scope

def test_a_merchant_outside_the_allowlist_is_refused(conn):
    c = cart(line(1000), merchant="mrc_somewhere_else")
    assert admissible(conn, mandate(), c, now=T) == [Violation.MERCHANT_NOT_ALLOWED]


def test_a_line_outside_the_delegated_categories_is_refused(conn):
    c = cart(line(1000), line(1000, category="electronics"))
    assert admissible(conn, mandate(), c, now=T) == [Violation.CATEGORY_OUT_OF_SCOPE]


def test_an_empty_category_scope_permits_nothing(conn):
    """Fail closed. A mandate naming no category delegated no category."""
    assert Violation.CATEGORY_OUT_OF_SCOPE in admissible(
        conn, mandate(categories=()), cart(line(1000)), now=T)


def test_an_empty_allowlist_permits_no_merchant(conn):
    assert Violation.MERCHANT_NOT_ALLOWED in admissible(
        conn, mandate(merchant_allowlist=()), cart(line(1000)), now=T)


def test_an_empty_cart_is_a_violation_not_a_free_pass(conn):
    """It satisfies every cap arithmetically while admitting nothing at all."""
    assert admissible(conn, mandate(), cart(), now=T) == [Violation.EMPTY_CART]


# ─────────────────────────────────────────────────────────── cumulative spend

def test_spend_is_recomputed_from_the_log_not_a_counter(conn):
    env = mandate()
    assert spent(conn, "mnd_1") == 0
    admit(conn, env, cart(line(120000), cart_id="c1"))
    assert spent(conn, "mnd_1") == 120000
    admit(conn, env, cart(line(80000), cart_id="c2"))
    assert spent(conn, "mnd_1") == 200000


def test_re_admitting_the_same_cart_does_not_inflate_spend(conn):
    """Idempotent on the cart id, inherited from eventlog's (source, external_id) guard.

    The retry lands LATER, because that is what a retry is. Re-admitting at the same
    instant would pass even if the admission key were time-scoped, which is a guard that
    only looks like one.
    """
    env = mandate()
    admit(conn, env, cart(line(120000), cart_id="c1"), now=T)
    admit(conn, env, cart(line(120000), cart_id="c1"), now=T + 300)
    assert spent(conn, "mnd_1") == 120000
    assert len(prior_admissions(conn, "mnd_1")) == 1


def test_a_different_cart_of_the_same_value_is_charged_separately(conn):
    env = mandate()
    admit(conn, env, cart(line(120000), cart_id="c1"))
    admit(conn, env, cart(line(120000), cart_id="c2"))
    assert spent(conn, "mnd_1") == 240000


def test_spend_on_one_mandate_does_not_leak_into_another(conn):
    env = mandate()
    admit(conn, env, cart(line(200000), cart_id="c1"))
    admit(conn, env, cart(line(200000), cart_id="c2"))
    assert spent(conn, "mnd_1") == 400000
    assert spent(conn, "mnd_2") == 0
    assert admissible(conn, mandate(mandate_id="mnd_2"), cart(line(200000), cart_id="c3"),
                      now=T) == []


def test_every_counted_admission_is_citable_as_evidence(conn):
    env = mandate()
    admit(conn, env, cart(line(100000), cart_id="c1"))
    admit(conn, env, cart(line(100000), cart_id="c2"))
    events = prior_admissions(conn, "mnd_1")
    assert [e.payload["cart_id"] for e in events] == ["c1", "c2"]
    assert all(isinstance(e.seq, int) for e in events)
    assert sum(e.payload["total_minor"] for e in events) == spent(conn, "mnd_1")


# ─────────────────────────────────────────────────────────── arithmetic hygiene

def test_no_float_ever_reaches_the_arithmetic(conn):
    env = mandate()
    c = cart(line(33333, qty=3))
    admit(conn, env, c)
    for value in (c.total_minor, c.lines[0].total_minor, spent(conn, "mnd_1")):
        assert isinstance(value, int) and not isinstance(value, bool)


def test_independent_violations_are_reported_together(conn):
    env = mandate()
    admit(conn, env, cart(line(450000), cart_id="c1"))
    found = admissible(conn, env, cart(line(300000, category="electronics"), cart_id="c2",
                                       merchant="mrc_elsewhere"), now=T)
    assert set(found) == {Violation.MERCHANT_NOT_ALLOWED, Violation.CATEGORY_OUT_OF_SCOPE,
                          Violation.PER_TXN_CAP_EXCEEDED, Violation.CUMULATIVE_CAP_EXCEEDED}


@pytest.mark.parametrize("cap", [0, 1, 2])
def test_a_degenerate_cap_is_still_enforced_exactly(conn, cap):
    """A zero cap permits a zero-value line and nothing more. No special-casing."""
    env = mandate(per_txn_cap_minor=cap, cumulative_cap_minor=cap)
    assert admissible(conn, env, cart(line(cap)), now=T) == []
    assert admissible(conn, env, cart(line(cap + 1)), now=T) == [
        Violation.PER_TXN_CAP_EXCEEDED, Violation.CUMULATIVE_CAP_EXCEEDED]


def test_admissible_records_nothing(conn):
    """A dry check must not spend the mandate it is checking."""
    env = mandate()
    admissible(conn, env, cart(line(100000)), now=T)
    assert spent(conn, "mnd_1") == 0
    assert prior_admissions(conn, "mnd_1") == []
