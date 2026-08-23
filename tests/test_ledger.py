"""The open-object ledger. Its one job is to know what money is still in flight."""

from __future__ import annotations

from kavach.ledger import (
    Intent,
    exposure,
    open_against_payment,
    open_obligations,
    prior_intents,
    record,
    settle,
)

T = 1_700_000_000


def test_an_open_refund_is_an_open_obligation(conn, refund_event):
    refund_event("rfnd_A", "created", T)
    refund_event("rfnd_A", "processed", T + 60)

    opens = open_obligations(conn, now=T + 120)
    assert [f.entity_id for f in opens] == ["rfnd_A"]
    assert open_against_payment(conn, "pay_X", now=T + 120)[0].amount_minor == 500000
    assert exposure(conn, "pay_X", now=T + 120) == 500000


def test_executed_intent_with_no_webhook_yet_still_counts_as_exposure(conn, refund_event):
    """The exact window a naive agent walks into: the API accepted the refund, no webhook has
    landed, so nothing in the event log shows it. Ignoring it under-counts exposure and lets
    the next refund through."""
    refund_event("rfnd_A", "processed", T + 60)
    record(conn, Intent("i1", "agent_1", "sess_1", "create_refund", "payment", "pay_X",
                        250000, "customer complained", T + 90, "EXECUTED"))

    assert exposure(conn, "pay_X", now=T + 120) == 750000


def test_exposure_drops_once_the_obligation_closes(conn, refund_event):
    refund_event("rfnd_A", "processed", T + 60)
    record(conn, Intent("i1", "agent_1", "sess_1", "create_refund", "payment", "pay_X",
                        250000, "customer complained", T + 90, "EXECUTED"))
    refund_event("rfnd_A", "processed", T + 300, arn="ARN1")
    settle(conn, "i1", "EXECUTED", result_id="rfnd_A")

    assert open_against_payment(conn, "pay_X", now=T + 400) == []
    assert exposure(conn, "pay_X", now=T + 400) == 0, "a settled intent must not double-count"


def test_intents_are_recoverable_across_sessions(conn):
    """A duplicate is born in a NEW session, so history has to outlive the session that made
    it. This is the lookup a per-conversation agent memory cannot do."""
    record(conn, Intent("i1", "agent_1", "sess_1", "create_refund", "payment", "pay_X",
                        250000, "charged twice", T, "EXECUTED"))
    record(conn, Intent("i2", "agent_2", "sess_2", "create_refund", "payment", "pay_X",
                        250000, "double debit", T + 500, "PROPOSED"))

    assert [i.intent_id for i in prior_intents(conn, "payment", "pay_X")] == ["i1", "i2"]


def test_unknown_payment_has_no_exposure(conn):
    assert exposure(conn, "pay_UNSEEN", now=T) == 0
    assert open_against_payment(conn, "pay_UNSEEN", now=T) == []
