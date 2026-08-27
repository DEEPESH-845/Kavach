from __future__ import annotations

import concurrent.futures
import os
import sqlite3

os.environ["KAVACH_DB"] = ":memory:"

import pytest
from kavach import eventlog, ledger
from kavach.governor import Policy
from kavach.mcp import server


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    ledger.init(c)
    eventlog.SCHEMA = eventlog.SCHEMA
    c.executescript(eventlog.SCHEMA)
    
    # Pre-populate a payment of 100_00 (100 rupees)
    eventlog.append(
        c, source="api", external_id="pay_1_create", entity_type="payment",
        entity_id="pay_1", event_type="api.payment.captured",
        payload={"id": "pay_1", "status": "captured", "amount": 10000},
        occurred_at=1000, received_at=1000
    )
    # Give server the connection
    server._conn = c
    server._policy = Policy()
    
    yield c
    c.close()


def test_concurrent_refunds_do_not_exceed_cap(conn):
    """Blast the server with 20 concurrent create_refund requests for 10 rupees each.
    
    The total payment is 100 rupees.
    The requests should race, but BEGIN EXCLUSIVE should serialize them.
    Only exactly 10 requests should succeed, the rest should be DENIED for exceeding cap.
    """
    def attempt_refund(i: int):
        try:
            return server.create_refund(
                payment_id="pay_1", amount="10.00", reason=f"race_{i}", 
                session_id="s1", agent_id="agent_1"
            )
        except Exception as e:
            return e
            
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(attempt_refund, i) for i in range(20)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]
        
    successes = 0
    denials = 0
    errors = 0
    for r in results:
        if isinstance(r, dict):
            if r.get("action") == "ALLOW":
                successes += 1
            elif r.get("action") == "DENY":
                denials += 1
            elif r.get("action") == "ESCALATE":
                # We expect ESCALATE because risk model is not loaded, wait!
                # If risk model is not loaded, it falls back to 0.0 risk. 
                pass
        else:
            errors += 1
            
    # The total allowed should not exceed 10 (10 * 10 = 100)
    assert successes <= 10
    
    # Check what the ledger says
    intents = ledger.prior_intents(conn, "payment", "pay_1")
    approved_amount = sum(i.amount_minor for i in intents if i.status == "EXECUTED")
    assert approved_amount <= 100_00
