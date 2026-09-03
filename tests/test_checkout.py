"""Checkout grades what it hears. The signature proves a binding; the entity is an
observation; only a signed webhook would make it certain."""

from __future__ import annotations

import hashlib
import hmac

import pytest
from kavach.razorpay.client import verify_checkout_signature
from kavach.services import checkout

T = 1_700_000_000
SECRET = "test_secret_kavach"


def _sig(order_id: str, payment_id: str, secret: str = SECRET) -> str:
    return hmac.new(secret.encode(), f"{order_id}|{payment_id}".encode(),
                    hashlib.sha256).hexdigest()


class StubClient:
    """What the Razorpay test API answers, minus the network."""

    key = "rzp_test_stub"

    def __init__(self):
        self.orders: dict[str, dict] = {}
        self.payments: dict[str, dict] = {}
        self.links: dict[str, dict] = {}

    def create_order(self, amount_minor, receipt, notes=None):
        oid = f"order_{len(self.orders) + 1:04d}"
        self.orders[oid] = {"id": oid, "amount": amount_minor, "currency": "INR",
                            "receipt": receipt, "status": "created", "notes": notes or {},
                            "created_at": T}
        return self.orders[oid]

    def create_payment_link(self, amount_minor, description, *, reference_id=None, notes=None):
        lid = f"plink_{len(self.links) + 1:04d}"
        self.links[lid] = {"id": lid, "short_url": f"https://rzp.io/l/{lid}",
                           "status": "created", "amount": amount_minor,
                           "reference_id": reference_id, "payments": [], "created_at": T}
        return self.links[lid]

    def fetch_payment_link(self, lid):
        return self.links[lid]

    def pay(self, order_id: str, status: str = "captured") -> str:
        pid = f"pay_{len(self.payments) + 1:04d}"
        self.payments[pid] = {"id": pid, "order_id": order_id, "status": status,
                              "amount": self.orders[order_id]["amount"], "currency": "INR",
                              "method": "upi", "created_at": T + 30}
        return pid

    def fetch_payment(self, pid):
        return self.payments[pid]

    def order_payments(self, order_id):
        return {"items": [p for p in self.payments.values() if p["order_id"] == order_id]}


@pytest.fixture
def db(conn):
    checkout.init(conn)
    return conn


CART = {"cart_id": "cart_1", "merchant_id": "merchant_bazaar_direct",
        "lines": [{"sku": "PPR", "description": "paper", "category": "stationery",
                   "unit_amount_minor": 32_900, "quantity": 1, "liquid": False},
                  {"sku": "PEN", "description": "pens", "category": "stationery",
                   "unit_amount_minor": 9_000, "quantity": 2, "liquid": False}]}


def test_the_checkout_signature_is_hmac_over_order_and_payment_ids():
    assert verify_checkout_signature("order_1", "pay_1", _sig("order_1", "pay_1"), SECRET)
    assert not verify_checkout_signature("order_1", "pay_2", _sig("order_1", "pay_1"), SECRET)
    assert not verify_checkout_signature("order_1", "pay_1", _sig("order_1", "pay_1"), "other")
    assert not verify_checkout_signature("order_1", "pay_1", "", SECRET)
    assert not verify_checkout_signature("order_1", "pay_1", _sig("order_1", "pay_1"), "")


def test_replay_mode_never_pretends_to_take_a_payment(db, monkeypatch):
    monkeypatch.setenv("KAVACH_MODE", "replay")
    ok, why = checkout.available()
    assert not ok and "KAVACH_MODE" in why
    with pytest.raises(checkout.CheckoutError) as e:
        checkout.start(db, cart=CART, mandate_id="m", agent_id="a", admission_seq=1,
                       admission_hash="h", now=T)
    assert e.value.code == "checkout_unavailable" and e.value.status == 503


def test_a_live_key_that_is_not_a_test_key_is_refused(monkeypatch):
    monkeypatch.setenv("KAVACH_MODE", "live")
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_live_abc")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "s")
    ok, why = checkout.available()
    assert not ok and "TEST" in why


def test_start_records_the_order_with_the_admission_hash_in_razorpays_notes(db):
    c = StubClient()
    out = checkout.start(db, cart=CART, mandate_id="mnd_x", agent_id="agent_y",
                         admission_seq=7, admission_hash="abc123", now=T, client=c)
    assert out["amount_minor"] == 32_900 + 18_000
    assert out["key_id"] == "rzp_test_stub"
    assert "secret" not in str(out).lower()
    assert c.orders[out["order_id"]]["notes"]["kavach_admission_hash"] == "abc123"
    ev = db.execute("SELECT * FROM events").fetchall()
    assert len(ev) == 1 and ev[0]["event_type"] == "checkout.order.created"
    assert ev[0]["sig_verified"] == 0
    assert ev[0]["entity_type"] == "checkout"          # never an obligation


def test_a_bad_signature_records_nothing(db):
    c = StubClient()
    o = checkout.start(db, cart=CART, mandate_id="m", agent_id="a", admission_seq=1,
                       admission_hash="h", now=T, client=c)
    pid = c.pay(o["order_id"])
    with pytest.raises(checkout.CheckoutError) as e:
        checkout.confirm(db, order_id=o["order_id"], payment_id=pid, signature="nope",
                         now=T + 40, client=c, secret=SECRET)
    assert e.value.code == "bad_signature" and e.value.status == 401
    n = db.execute("SELECT COUNT(*) FROM events WHERE entity_type='payment'").fetchone()[0]
    assert n == 0


def test_a_good_signature_yields_a_probable_fact_and_a_certain_preview(db):
    c = StubClient()
    o = checkout.start(db, cart=CART, mandate_id="m", agent_id="a", admission_seq=1,
                       admission_hash="h", now=T, client=c)
    pid = c.pay(o["order_id"])
    out = checkout.confirm(db, order_id=o["order_id"], payment_id=pid,
                           signature=_sig(o["order_id"], pid), now=T + 40, client=c,
                           secret=SECRET)
    assert out["paid"] is True
    assert out["signature_verified"] is True
    assert out["fact"]["rail_state"] == "CONFIRMED"
    # the entity was FETCHED, not signed by the rail: probable, never certain
    assert out["fact"]["confidence"] == "DERIVED_PROBABLE"
    assert out["observed"] == {"source": "API response", "signature": "unverified",
                               "confidence": "DERIVED_PROBABLE"}
    kinds = {r["event_type"]: r["sig_verified"] for r in db.execute("SELECT * FROM events")}
    assert kinds["checkout.signature.verified"] == 1
    assert kinds["api.payment.captured"] == 0
    # what a configured webhook would do to the same events -- simulated and labelled
    pv = out["preview_with_webhook"]
    assert pv["simulated"] is True and pv["confidence"] == "DERIVED_CERTAIN"
    assert db.execute("SELECT COUNT(*) FROM events WHERE source='webhook'").fetchone()[0] == 0


def test_status_polls_the_order_until_a_payment_is_observed(db):
    c = StubClient()
    o = checkout.start(db, cart=CART, mandate_id="m", agent_id="a", admission_seq=1,
                       admission_hash="h", now=T, client=c)
    s0 = checkout.status(db, order_id=o["order_id"], now=T + 5, client=c)
    assert s0["paid"] is False and s0["payment_id"] is None
    c.pay(o["order_id"])
    s1 = checkout.status(db, order_id=o["order_id"], now=T + 60, client=c)
    assert s1["paid"] is True and s1["fact"]["confidence"] == "DERIVED_PROBABLE"
    assert checkout.latest_real_payment(db)["payment_id"] == s1["payment_id"]


def test_the_phone_link_is_created_once_and_reused(db):
    c = StubClient()
    o = checkout.start(db, cart=CART, mandate_id="m", agent_id="a", admission_seq=1,
                       admission_hash="h", now=T, client=c)
    a = checkout.link(db, order_id=o["order_id"], now=T, client=c)
    b = checkout.link(db, order_id=o["order_id"], now=T + 1, client=c)
    assert a["link_id"] == b["link_id"] and not a["reused"] and b["reused"]
    with pytest.raises(checkout.CheckoutError) as e:
        checkout.link(db, order_id="order_nope", now=T, client=c)
    assert e.value.status == 404
