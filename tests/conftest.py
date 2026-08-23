"""Shared fixtures.

T is a fixed epoch and every test passes `now` explicitly. Nothing in Kavach reads the
clock during a derivation, so the same events always produce the same fact -- which is what
makes a payment decision replayable months later during a dispute.
"""

from __future__ import annotations

import pytest
from kavach import ledger
from kavach.eventlog import append, connect

T = 1_700_000_000


@pytest.fixture(autouse=True)
def _no_ambient_credentials(monkeypatch):
    """No test may depend on what happens to be in the shell.

    Without this the suite passes bare and fails under `make check` with .env sourced, or
    worse, passes for the wrong reason.
    """
    for var in ("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET",
                "KAVACH_MODE", "KAVACH_DB"):
        monkeypatch.delenv(var, raising=False)


@pytest.fixture
def conn():
    c = connect(":memory:")
    ledger.init(c)
    yield c
    c.close()


@pytest.fixture
def refund_event(conn):
    def _add(refund_id: str, status: str, at: int, *, amount: int = 500000,
             payment_id: str = "pay_X", arn: str | None = None, verified: bool = True):
        body = {"id": refund_id, "payment_id": payment_id, "status": status,
                "amount": amount, "currency": "INR"}
        if arn:
            body["acquirer_data"] = {"arn": arn}
        return append(conn, source="webhook", external_id=f"{refund_id}:{status}:{at}",
                      entity_type="refund", entity_id=refund_id,
                      event_type=f"refund.{status}",
                      payload={"payload": {"refund": {"entity": body}}},
                      occurred_at=at, received_at=at, sig_verified=verified)
    return _add
