from __future__ import annotations

import pytest
from kavach import ledger
from kavach.eventlog import connect
from kavach.razorpay.client import RazorpayError
from kavach.reconciliation import reconcile_pending_intents


class MockRazorpayClient:
    """Refund listing plus a scripted create_refund: the reconciler EXECUTES an approved
    intent it cannot find on the provider, so the mock must answer that call too."""

    def __init__(self, create=None):
        self.refunds_resp = {"items": []}
        self.create = create
        self.created: list[dict] = []

    def payment_refunds(self, payment_id: str) -> dict:
        return self.refunds_resp

    def create_refund(self, payment_id, amount_minor, *, idempotency_key, notes):
        self.created.append({"payment_id": payment_id, "amount": amount_minor,
                             "idempotency_key": idempotency_key, "notes": notes})
        if isinstance(self.create, Exception):
            raise self.create
        return self.create or {"id": "rfnd_new", "status": "processing"}


@pytest.fixture
def conn():
    c = connect(":memory:")
    ledger.init(c)
    yield c
    c.close()


def test_reconcile_to_executed(conn):
    client = MockRazorpayClient()
    client.refunds_resp = {
        "items": [
            {"id": "rfnd_123", "notes": {"intent_id": "int_abc"}}
        ]
    }
    
    intent = ledger.Intent("int_abc", "agent1", "s1", "create_refund", "payment",
                           "pay_x", 10000, "test", 100, "APPROVED")
    ledger.record(conn, intent)
    
    now = 200 # > 100 + 60 tolerance
    settled = reconcile_pending_intents(conn, client, tolerance_seconds=60, now=now)
    assert settled == 1
    
    r = conn.execute(
        "SELECT status, result_id FROM intents WHERE intent_id='int_abc'"
    ).fetchone()
    assert r["status"] == "EXECUTED"
    assert r["result_id"] == "rfnd_123"


def test_an_unexecuted_approval_is_executed_under_its_idempotency_key(conn):
    """A human released it from review and nothing ran it: the reconciler runs it."""
    client = MockRazorpayClient()
    intent = ledger.Intent("int_abc", "agent1", "s1", "create_refund", "payment",
                           "pay_x", 10000, "test", 100, "APPROVED")
    ledger.record(conn, intent)

    settled = reconcile_pending_intents(conn, client, tolerance_seconds=60, now=200)
    assert settled == 1
    assert client.created == [{"payment_id": "pay_x", "amount": 10000,
                               "idempotency_key": "kavach-int_abc",
                               "notes": {"intent_id": "int_abc"}}]
    r = conn.execute("SELECT status, result_id FROM intents WHERE intent_id='int_abc'"
                     ).fetchone()
    assert r["status"] == "EXECUTED" and r["result_id"] == "rfnd_new"


def test_a_provider_refusal_is_failed_and_a_retriable_error_stays_approved(conn):
    for iid, err, want in (("int_400", RazorpayError(400, "{}", "/refunds"), "FAILED"),
                           ("int_503", RazorpayError(503, "", "/refunds"), "APPROVED")):
        client = MockRazorpayClient(create=err)
        ledger.record(conn, ledger.Intent(iid, "a", "s", "create_refund", "payment",
                                          "pay_x", 100, "t", 100, "APPROVED"))
        reconcile_pending_intents(conn, client, tolerance_seconds=60, now=200)
        r = conn.execute("SELECT status FROM intents WHERE intent_id=?", (iid,)).fetchone()
        assert r["status"] == want, iid


def test_reconcile_respects_tolerance(conn):
    client = MockRazorpayClient()
    
    intent = ledger.Intent("int_abc", "agent1", "s1", "create_refund", "payment",
                           "pay_x", 10000, "test", 100, "APPROVED")
    ledger.record(conn, intent)
    
    now = 120 # age 20 < 60 tolerance
    settled = reconcile_pending_intents(conn, client, tolerance_seconds=60, now=now)
    assert settled == 0
    
    r = conn.execute("SELECT status FROM intents WHERE intent_id='int_abc'").fetchone()
    assert r["status"] == "APPROVED"
