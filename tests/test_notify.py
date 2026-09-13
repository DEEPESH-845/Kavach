"""Step-up delivery: validated, recorded, sent through a transport, outcome written back."""

from __future__ import annotations

import json

import pytest
from kavach import migrations
from kavach.eventlog import connect
from kavach.services import notify

VIEW = {"agent_id": "shopbot", "principal_id": "priya", "merchant_id": "bazaar",
        "amount_minor": 250_000, "purpose": "weekly groceries", "seconds_left": 540,
        "expires_at": 1_700_000_600,
        "items": [{"name": "Desk lamp", "description": "Desk lamp", "quantity": 1,
                   "total_minor": 250_000}]}


@pytest.fixture
def conn(tmp_path):
    c = connect(str(tmp_path / "n.db"))
    migrations.apply(c)
    notify.init(c)
    yield c
    c.close()


def test_compose_is_small_and_names_the_essentials():
    m = notify.compose(VIEW, "https://k.example/approve/?t=abc")
    assert "₹2,500.00" in m["body"] and "shopbot" in m["body"] and "bazaar" in m["body"]
    assert "https://k.example/approve/?t=abc" in m["body"] and "9 min" in m["body"]
    assert "nonce" not in m["body"] and "envelope" not in m["body"]


@pytest.mark.parametrize("channel, to, code", [
    ("pigeon", "x", "unknown_channel"),
    ("email", "not-an-address", "invalid_recipient"),
    ("sms", "98765", "invalid_recipient"),
    ("whatsapp", "+91 98765 43210 ext", "invalid_recipient"),
    ("email", "", "invalid_recipient"),
])
def test_validation_names_the_problem(channel, to, code):
    with pytest.raises(notify.NotifyError) as e:
        notify.validate(channel, to)
    assert e.value.code == code


def test_masking():
    assert notify.mask("email", "priya.s@example.com") == "p…@example.com"
    assert notify.mask("sms", "+919876543210") == "+91…10"
    assert notify.mask("webhook", "merchant") == "merchant"


def test_dispatch_records_sent_with_a_fake_transport(conn, monkeypatch, tmp_path):
    monkeypatch.setenv("KAVACH_PUBLIC_URL", "https://k.example/")
    seen = {}

    def fake(to, msg, payload):
        seen.update(to=to, msg=msg, payload=payload)
        return "SM123"
    monkeypatch.setitem(notify.TRANSPORTS, "sms", fake)
    out = notify.dispatch(conn, token="tok1", channel="sms", to="+919876543210", view=VIEW,
                          approve_path="/approve/?t=tok1", now=1,
                          open_conn=lambda: connect(str(tmp_path / "n.db")),
                          background=False)
    assert out["status"] == "queued" and out["to"] == "+91…10"
    d = notify.deliveries(conn, "tok1")
    assert len(d) == 1 and d[0]["status"] == "sent" and d[0]["provider_id"] == "SM123"
    assert seen["payload"]["approve_url"] == "https://k.example/approve/?t=tok1"
    assert seen["payload"]["amount_minor"] == 250_000


def test_dispatch_records_failure_and_unconfigured_channels(conn, monkeypatch, tmp_path):
    monkeypatch.setenv("KAVACH_PUBLIC_URL", "https://k.example")
    for var in ("KAVACH_SMTP_URL", "TWILIO_ACCOUNT_SID", "KAVACH_STEPUP_WEBHOOK_URL"):
        monkeypatch.delenv(var, raising=False)
    opener = lambda: connect(str(tmp_path / "n.db"))  # noqa: E731
    for channel, to in (("email", "p@example.com"), ("whatsapp", "+919876543210"),
                        ("webhook", "merchant")):
        notify.dispatch(conn, token="tok2", channel=channel, to=to, view=VIEW,
                        approve_path="/approve/?t=tok2", now=1, open_conn=opener,
                        background=False)
    d = notify.deliveries(conn, "tok2")
    assert [x["status"] for x in d] == ["failed"] * 3
    assert all(x["error"].startswith("channel_unconfigured") for x in d)


def test_public_url_is_required(monkeypatch, conn, tmp_path):
    monkeypatch.delenv("KAVACH_PUBLIC_URL", raising=False)
    with pytest.raises(notify.NotifyError) as e:
        notify.dispatch(conn, token="t", channel="email", to="a@b.co", view=VIEW,
                        approve_path="/approve/?t=t", now=1,
                        open_conn=lambda: connect(str(tmp_path / "n.db")), background=False)
    assert e.value.code == "public_url_unset"
    assert notify.deliveries(conn, "t") == []


def test_webhook_transport_signs_the_body(monkeypatch):
    import hashlib
    import hmac
    import urllib.request
    monkeypatch.setenv("KAVACH_STEPUP_WEBHOOK_URL", "https://merchant.example/hook")
    monkeypatch.setenv("KAVACH_STEPUP_WEBHOOK_SECRET", "s3cret")
    captured = {}

    class R:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b'{"ok": true}'

    def fake_open(req, timeout):
        captured["req"] = req
        return R()
    monkeypatch.setattr(urllib.request, "urlopen", fake_open)
    notify.TRANSPORTS["webhook"]("merchant", {"subject": "s", "body": "b"}, {"token": "t"})
    req = captured["req"]
    body = req.data
    want = hmac.new(b"s3cret", body, hashlib.sha256).hexdigest()
    assert req.get_header("X-kavach-signature") == f"sha256={want}"
    assert json.loads(body)["to"] == "merchant" and json.loads(body)["token"] == "t"
