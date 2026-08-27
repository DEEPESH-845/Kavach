"""The truth plane. Its one job is to never let a rail state be read as an obligation state."""

from __future__ import annotations

import pytest
from kavach.eventlog import Event
from kavach.truth import Confidence, Rail, derive

T = 1_700_000_000


def ev(seq, status, at, *, verified=True, arn=None, etype="refund", eid="rfnd_A"):
    body = {"id": eid, "status": status, "amount": 500000, "currency": "INR"}
    if arn:
        body["acquirer_data"] = {"arn": arn}
    return Event(seq, "webhook", f"evt_{seq}", etype, eid, None, f"{etype}.{status}",
                 {"payload": {etype: {"entity": body}}}, at, at, verified, None, "fake_hash")


def test_processed_without_arn_leaves_the_obligation_open():
    """The headline case. Razorpay's docs: a refund reaches `processed` BEFORE the ARN/RRN
    arrives from the gateway, and the customer is credited days later. An agent reading
    `status: processed` reports 'done' and is wrong."""
    fact = derive([ev(1, "created", T), ev(2, "processed", T + 60)], now=T + 120)

    assert fact.rail_state is Rail.PROCESSING
    assert fact.obligation_open is True
    assert fact.to_agent()["settled_to_customer"] is False
    assert fact.evidence == [1, 2], "a fact must cite the events that produced it"


def test_obligation_closes_only_once_a_bank_reference_exists():
    fact = derive([ev(1, "created", T), ev(2, "processed", T + 60),
                   ev(3, "processed", T + 300, arn="ARN123")], now=T + 400)

    assert fact.rail_state is Rail.CONFIRMED
    assert fact.obligation_open is False
    assert fact.to_agent()["settled_to_customer"] is True
    assert fact.arn == "ARN123"


def test_silence_past_tolerance_becomes_unknown_not_still_processing():
    """The cheap failure is assuming no news means no change. After the tolerance window we
    say we do not know, which is what forces the governor to escalate."""
    fact = derive([ev(1, "created", T), ev(2, "processed", T + 60)], now=T + 60 + 7 * 3600)

    assert fact.rail_state is Rail.AMBIGUOUS
    assert fact.confidence is Confidence.UNKNOWN
    assert fact.obligation_open is True


def test_terminal_failure_closes_the_obligation_without_crediting():
    fact = derive([ev(1, "created", T), ev(2, "failed", T + 60)], now=T + 120)

    assert fact.rail_state is Rail.FAILED_TERMINAL
    assert fact.obligation_open is False


def test_a_regressing_state_is_a_contradiction_not_an_update():
    fact = derive([ev(1, "processed", T + 60), ev(2, "created", T + 120)], now=T + 200)

    assert fact.rail_state is Rail.AMBIGUOUS
    assert "regressed" in fact.reason


def test_unverified_source_can_never_yield_certainty():
    fact = derive([ev(1, "created", T, verified=False)], now=T + 10)
    assert fact.confidence is Confidence.DERIVED_PROBABLE


def test_authorised_payment_is_not_captured_money():
    fact = derive([ev(1, "authorized", T, etype="payment", eid="pay_A")], now=T + 60)

    assert fact.rail_state is Rail.ACCEPTED
    assert fact.obligation_open is True, "funds are held, not yours"


def test_captured_payment_closes():
    fact = derive([ev(1, "captured", T, etype="payment", eid="pay_A")], now=T + 60)
    assert fact.rail_state is Rail.CONFIRMED and fact.obligation_open is False


def test_refuses_to_state_a_fact_with_no_evidence():
    with pytest.raises(ValueError, match="no events"):
        derive([], now=T)


def test_derivation_is_pure():
    """Same events and same `now` produce the same fact. Without this a payment decision
    cannot be replayed during a dispute months later."""
    events = [ev(1, "created", T), ev(2, "processed", T + 60)]
    assert derive(events, now=T + 120) == derive(events, now=T + 120)
