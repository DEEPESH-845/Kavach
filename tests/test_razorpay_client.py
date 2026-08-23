"""The Razorpay transport. Its one job is that an unverified webhook never becomes evidence."""

from __future__ import annotations

import hashlib
import hmac
import json

import pytest
from kavach.razorpay.client import (
    CassetteMismatch,
    Razorpay,
    RazorpayError,
    _shape,
    verify_webhook,
)

SECRET = "whsec_test_kavach"
BODY = json.dumps({"event": "refund.processed",
                   "payload": {"refund": {"entity": {"id": "rfnd_A"}}}}).encode()
GOOD = hmac.new(SECRET.encode(), BODY, hashlib.sha256).hexdigest()


def test_valid_signature_verifies():
    assert verify_webhook(BODY, GOOD, SECRET) is True


def test_wrong_signature_fails():
    flipped = GOOD[:-1] + ("0" if GOOD[-1] != "0" else "1")
    assert verify_webhook(BODY, flipped, SECRET) is False


def test_tampered_body_fails():
    assert verify_webhook(BODY + b" ", GOOD, SECRET) is False


@pytest.mark.parametrize("signature,secret", [(GOOD, ""), ("", SECRET), ("", "")])
def test_missing_credentials_fail_closed(signature, secret):
    """A missing webhook secret must reject, never wave through. The opposite default is how
    an unauthenticated caller gets to write into the event log."""
    assert verify_webhook(BODY, signature, secret) is False


def test_replay_without_a_tape_fails_loudly(tmp_path):
    """A mock that invents a plausible response is worse than no mock: the evaluation would
    silently measure fiction."""
    client = Razorpay(mode="replay", cassette=str(tmp_path / "missing.jsonl"))
    with pytest.raises(CassetteMismatch):
        client.fetch_payment("pay_X")


def test_short_idempotency_key_is_rejected_before_the_network_call():
    """Razorpay requires >=10 characters. Catching it locally turns a 400 into a clear error
    at the call site."""
    client = Razorpay(key="k", secret="s", mode="live")
    with pytest.raises(ValueError, match="at least 10"):
        client.create_refund("pay_X", 100, "short")


def test_live_mode_requires_credentials():
    with pytest.raises(RuntimeError, match="live mode needs"):
        Razorpay(key="", secret="", mode="live")


@pytest.mark.parametrize("status,retriable", [(500, True), (503, True), (429, True),
                                              (400, False), (404, False), (409, False)])
def test_only_transport_failures_are_retriable(status, retriable):
    """Retrying a 4xx is how duplicates are created: the request was understood and refused."""
    assert RazorpayError(status, "", "/x").retriable is retriable


def test_paths_compare_structurally_so_re_recorded_tapes_replay():
    assert _shape("/payments/pay_ABC/refunds") == "/payments/<id>/refunds"
    assert _shape("/refunds/rfnd_9?x=1") == "/refunds/<id>"


def test_blank_credentials_do_not_fall_back_to_the_environment(monkeypatch):
    """Passing key="" means no key. If it silently picked up RAZORPAY_KEY_ID, a harness that
    deliberately supplied no credentials would authenticate against a real account."""
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_ambient")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "ambient_secret")

    with pytest.raises(RuntimeError, match="live mode needs"):
        Razorpay(key="", secret="", mode="live")


def test_omitted_credentials_do_read_the_environment(monkeypatch):
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_ambient")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "ambient_secret")

    assert Razorpay(mode="live").key == "rzp_test_ambient"
