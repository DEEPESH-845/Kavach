from __future__ import annotations

import sqlite3

import pytest
from kavach import ledger
from kavach.reconciliation import reconcile_pending_intents


class MockRazorpayClient:
    def __init__(self):
        self.refunds_resp = {"items": []}

    def payment_refunds(self, payment_id: str) -> dict:
        return self.refunds_resp


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
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


def test_reconcile_to_failed(conn):
    client = MockRazorpayClient()
    client.refunds_resp = {
        "items": []
    }
    
    intent = ledger.Intent("int_abc", "agent1", "s1", "create_refund", "payment",
                           "pay_x", 10000, "test", 100, "APPROVED")
    ledger.record(conn, intent)
    
    now = 200
    settled = reconcile_pending_intents(conn, client, tolerance_seconds=60, now=now)
    assert settled == 1
    
    r = conn.execute(
        "SELECT status, result_id FROM intents WHERE intent_id='int_abc'"
    ).fetchone()
    assert r["status"] == "FAILED"
    assert r["result_id"] is None


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
