from __future__ import annotations

import sqlite3

import pytest
from kavach import eventlog, governor, ledger
from kavach.governor import Action, Decision


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ledger.init(c)
    eventlog.SCHEMA = eventlog.SCHEMA
    c.executescript(eventlog.SCHEMA)
    yield c
    c.close()


def test_failure_injection_rolls_back_or_fails_intent(conn):
    """If the provider API throws a TimeoutError, the intent should be marked FAILED
    rather than remaining APPROVED (which would leak obligation exposure)."""
    
    intent = governor.new_intent("agent_1", "s1", "pay_1", 5000, "test", 1000)
    decision = Decision(Action.ALLOW, ["looks good"])
    
    # Reserve the intent
    governor.reserve(conn, intent, decision)
    
    # Verify it is APPROVED
    i = ledger.prior_intents(conn, "payment", "pay_1")[0]
    assert i.status == "APPROVED"
    
    # Mock a failing Razorpay client
    class FailingClient:
        def create_refund(self, target_id, amount_minor, **kwargs):
            raise TimeoutError("Razorpay is down")
            
    client = FailingClient()
    
    with pytest.raises(TimeoutError):
        governor.execute_provider(conn, client, intent, decision)
        
    # The intent should now be marked FAILED so the money isn't stuck as an open obligation
    # Wait, execute_provider catches the exception and marks it FAILED!
    i = ledger.prior_intents(conn, "payment", "pay_1")[0]
    assert i.status == "FAILED"
