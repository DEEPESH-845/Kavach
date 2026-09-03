"""Checkout: an admitted cart becomes a real Razorpay TEST-mode payment, and what the rail
says about it is graded by the truth plane rather than believed.

THREE PIECES OF EVIDENCE, THREE GRADES. This module is deliberately explicit about them,
because the whole product turns on not confusing "we saw something" with "we can prove it":

  checkout.order.created        our own record that we asked the rail for an order
                                source=api_response, sig_verified=0
  checkout.signature.verified   Standard Checkout's handler signature, HMAC-SHA256 over
                                order_id|payment_id with the key secret. Razorpay produced
                                it, we verified it, and it covers exactly those two ids.
                                sig_verified=1 -- for THAT claim and nothing more
  api.payment.<status>          the payment entity we then FETCHED. Authenticated transport,
                                but not a signed message from the rail, so the truth plane
                                grades the fact DERIVED_PROBABLE. A signed webhook is what
                                upgrades it to DERIVED_CERTAIN, and the API server mounts a
                                receiver for one.

PROOF INSIDE RAZORPAY'S OWN ENTITY. The order carries `notes.kavach_*` -- the cart id, the
mandate, the agent and the hash of the admission event -- so the decision's fingerprint is
visible from the Razorpay dashboard, outside this database.

Nothing here is faked. Without live credentials every call answers `unavailable` with the
variables to set; there is no replay stand-in for a payment a judge is meant to make.
"""

from __future__ import annotations

import os
import sqlite3
import time
from typing import Any

from ..eventlog import Event, append, for_entity
from ..razorpay.client import (
    CassetteMismatch,
    Razorpay,
    RazorpayError,
    verify_checkout_signature,
)
from ..truth import derive

SCHEMA = """
CREATE TABLE IF NOT EXISTS checkouts (
    order_id     TEXT PRIMARY KEY,
    cart_id      TEXT NOT NULL,
    mandate_id   TEXT NOT NULL,
    agent_id     TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    link_id      TEXT,
    link_url     TEXT,
    payment_id   TEXT,
    created_at   INTEGER NOT NULL
);
"""

TEST_PREFIX = "rzp_test_"


class CheckoutError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def init(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def available() -> tuple[bool, str]:
    """Can a real payment be created here? Never guessed: the environment is read now."""
    mode = os.environ.get("KAVACH_MODE", "replay")
    key = os.environ.get("RAZORPAY_KEY_ID", "")
    secret = os.environ.get("RAZORPAY_KEY_SECRET", "")
    if mode != "live":
        return False, ("KAVACH_MODE is not 'live', so no payment can be created. Set "
                       "KAVACH_MODE=live with Razorpay TEST credentials to enable checkout.")
    if not (key and secret):
        return False, ("live mode without RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET; set both "
                       "TEST-mode credentials to enable checkout.")
    if not key.startswith(TEST_PREFIX):
        # A live key would move real money through a demo. Refuse rather than warn.
        return False, ("RAZORPAY_KEY_ID is not a TEST-mode key (rzp_test_...). Kavach's "
                       "checkout demo only runs against Razorpay test mode.")
    return True, "Razorpay TEST mode"


def _require() -> Razorpay:
    ok, why = available()
    if not ok:
        raise CheckoutError("checkout_unavailable", why, 503)
    return Razorpay()


def _provider(e: Exception) -> CheckoutError:
    if isinstance(e, RazorpayError):
        return CheckoutError("provider_error",
                             f"Razorpay answered {e.status} on {e.path}", 502)
    if isinstance(e, CassetteMismatch):
        return CheckoutError("checkout_unavailable",
                             "replay mode has no recording for this call", 503)
    return CheckoutError("provider_error", "the provider call failed", 502)


def start(conn: sqlite3.Connection, *, cart: dict[str, Any], mandate_id: str, agent_id: str,
          admission_seq: int | None, admission_hash: str | None, now: int,
          client: Razorpay | None = None) -> dict[str, Any]:
    """Create the order. Returns what Standard Checkout needs and nothing it must not have:
    the key ID is public by design; the secret never leaves the server."""
    client = client or _require()
    total = sum(int(ln["unit_amount_minor"]) * int(ln["quantity"]) for ln in cart["lines"])
    if total <= 0:
        raise CheckoutError("empty_cart", "there is nothing to pay for")
    notes = {"kavach_cart": cart["cart_id"], "kavach_mandate": mandate_id,
             "kavach_agent": agent_id,
             "kavach_admission_seq": str(admission_seq or ""),
             "kavach_admission_hash": (admission_hash or "")[:64]}
    try:
        order = client.create_order(total, receipt=cart["cart_id"][:40], notes=notes)
    except Exception as e:  # noqa: BLE001 - classified below
        raise _provider(e) from None
    order_id = order["id"]
    conn.execute("INSERT OR IGNORE INTO checkouts (order_id, cart_id, mandate_id, agent_id, "
                 "amount_minor, created_at) VALUES (?,?,?,?,?,?)",
                 (order_id, cart["cart_id"], mandate_id, agent_id, total, now))
    seq, _ = append(conn, source="api_response", external_id=f"order:{order_id}:created",
                    entity_type="checkout", entity_id=order_id,
                    event_type="checkout.order.created",
                    payload={"order": {k: order.get(k) for k in
                                       ("id", "amount", "currency", "receipt", "status",
                                        "notes", "created_at")}},
                    occurred_at=int(order.get("created_at") or now), received_at=now,
                    sig_verified=False)
    return {
        "order_id": order_id, "amount_minor": total, "currency": "INR",
        "key_id": client.key, "test_mode": True,
        "notes": notes, "event_seq": seq,
        "note": "Razorpay TEST mode. No real money moves. The order carries the admission "
                "hash in its notes, so the decision is visible from the Razorpay dashboard.",
    }


def link(conn: sqlite3.Connection, *, order_id: str, now: int,
         client: Razorpay | None = None) -> dict[str, Any]:
    """A Payment Link for the same cart, for paying on a phone. Created on demand."""
    row = conn.execute("SELECT * FROM checkouts WHERE order_id=?", (order_id,)).fetchone()
    if row is None:
        raise CheckoutError("order_not_found", "no checkout for that order id", 404)
    if row["link_id"]:
        return {"link_id": row["link_id"], "short_url": row["link_url"], "reused": True}
    client = client or _require()
    try:
        pl = client.create_payment_link(
            int(row["amount_minor"]), f"Kavach Bazaar · {row['cart_id']}",
            reference_id=f"{row['cart_id']}-{now}"[:40],
            notes={"kavach_cart": row["cart_id"], "kavach_mandate": row["mandate_id"],
                   "kavach_order": order_id})
    except Exception as e:  # noqa: BLE001
        raise _provider(e) from None
    conn.execute("UPDATE checkouts SET link_id=?, link_url=? WHERE order_id=?",
                 (pl["id"], pl.get("short_url"), order_id))
    append(conn, source="api_response", external_id=f"plink:{pl['id']}:created",
           entity_type="checkout", entity_id=order_id, event_type="checkout.link.created",
           payload={"payment_link": {k: pl.get(k) for k in
                                     ("id", "short_url", "status", "amount", "reference_id")}},
           occurred_at=int(pl.get("created_at") or now), received_at=now, sig_verified=False)
    return {"link_id": pl["id"], "short_url": pl.get("short_url"), "reused": False}


def _ingest_payment(conn: sqlite3.Connection, entity: dict[str, Any], now: int) -> int:
    """The payment entity as an UNSIGNED observation. Same shape mcp/server._ingest writes."""
    seq, _ = append(conn, source="api_response",
                    external_id=f"api_response:{entity['id']}:{entity.get('status')}",
                    entity_type="payment", entity_id=entity["id"],
                    event_type=f"api.payment.{entity.get('status')}", payload=entity,
                    occurred_at=int(entity.get("created_at") or now), received_at=now,
                    sig_verified=False)
    return seq


def confirm(conn: sqlite3.Connection, *, order_id: str, payment_id: str, signature: str,
            now: int, client: Razorpay | None = None,
            secret: str | None = None) -> dict[str, Any]:
    """Verify the Checkout handler signature; only then fetch and ingest the payment."""
    row = conn.execute("SELECT * FROM checkouts WHERE order_id=?", (order_id,)).fetchone()
    if row is None:
        raise CheckoutError("order_not_found", "no checkout for that order id", 404)
    secret = os.environ.get("RAZORPAY_KEY_SECRET", "") if secret is None else secret
    if not verify_checkout_signature(order_id, payment_id, signature, secret):
        raise CheckoutError("bad_signature",
                            "the checkout signature does not verify; nothing was recorded",
                            401)
    sig_seq, _ = append(
        conn, source="checkout", external_id=f"checkout:{order_id}:{payment_id}",
        entity_type="checkout", entity_id=order_id, event_type="checkout.signature.verified",
        payload={"order_id": order_id, "payment_id": payment_id,
                 "claim": "HMAC-SHA256 over order_id|payment_id verified with the key "
                          "secret; covers the binding of these two ids and nothing else"},
        occurred_at=now, received_at=now, sig_verified=True)
    client = client or _require()
    try:
        entity = client.fetch_payment(payment_id)
    except Exception as e:  # noqa: BLE001
        raise _provider(e) from None
    pay_seq = _ingest_payment(conn, entity, now)
    conn.execute("UPDATE checkouts SET payment_id=? WHERE order_id=?", (payment_id, order_id))
    return {"order_id": order_id, "payment_id": payment_id,
            "signature_event_seq": sig_seq, "payment_event_seq": pay_seq,
            **status(conn, order_id=order_id, now=now, client=client, poll=False)}


def _events_out(events: list[Event]) -> list[dict[str, Any]]:
    return [{"seq": e.seq, "source": e.source, "event_type": e.event_type,
             "sig_verified": e.sig_verified, "occurred_at": e.occurred_at,
             "event_hash": e.event_hash} for e in events]


def preview_verified(events: list[Event], now: int) -> dict[str, Any] | None:
    """What a signed webhook would make of the same payment. SIMULATED, in memory, never
    written: it exists so the screen can show the upgrade a configured webhook secret buys
    without pretending one arrived."""
    if not events:
        return None
    last = events[-1]
    body = last.payload if "payload" not in last.payload else last.payload
    status_ = body.get("status")
    if status_ not in ("captured", "authorized"):
        return None
    ghost = Event(seq=last.seq + 1, source="webhook", external_id="simulated",
                  entity_type="payment", entity_id=last.entity_id, parent_entity_id=None,
                  event_type=f"payment.{status_}",
                  payload={"payload": {"payment": {"entity": body}}},
                  occurred_at=now, received_at=now, sig_verified=True,
                  previous_event_hash=last.event_hash, event_hash="simulated")
    fact = derive([*events, ghost], now=now)
    return {"simulated": True, "confidence": fact.confidence.value,
            "rail_state": fact.rail_state.value, "because": fact.reason,
            "note": "a preview computed in memory from the same events plus one "
                    "signature-verified webhook; it is not evidence and was not recorded"}


def status(conn: sqlite3.Connection, *, order_id: str, now: int,
           client: Razorpay | None = None, poll: bool = True) -> dict[str, Any]:
    """The financial fact for this checkout's payment, its evidence, and how it was heard."""
    row = conn.execute("SELECT * FROM checkouts WHERE order_id=?", (order_id,)).fetchone()
    if row is None:
        raise CheckoutError("order_not_found", "no checkout for that order id", 404)
    payment_id = row["payment_id"]

    if payment_id is None and poll:
        client = client or _require()
        try:
            found = client.order_payments(order_id).get("items", [])
            if not found and row["link_id"]:
                pl = client.fetch_payment_link(row["link_id"])
                found = [{"id": p["payment_id"], "status": p.get("status")}
                         for p in pl.get("payments", []) if p.get("payment_id")]
                if found:
                    found = [client.fetch_payment(found[0]["id"])]
        except Exception as e:  # noqa: BLE001
            raise _provider(e) from None
        if found:
            entity = found[0]
            _ingest_payment(conn, entity, now)
            payment_id = entity["id"]
            conn.execute("UPDATE checkouts SET payment_id=? WHERE order_id=?",
                         (payment_id, order_id))

    checkout_events = for_entity(conn, "checkout", order_id)
    out: dict[str, Any] = {
        "order_id": order_id, "cart_id": row["cart_id"], "amount_minor": row["amount_minor"],
        "payment_id": payment_id, "paid": False, "test_mode": True,
        "link": ({"link_id": row["link_id"], "short_url": row["link_url"]}
                 if row["link_id"] else None),
        "checkout_events": _events_out(checkout_events),
        "signature_verified": any(e.event_type == "checkout.signature.verified"
                                  for e in checkout_events),
        "fact": None, "payment_events": [], "preview_with_webhook": None,
        "webhook_configured": bool(os.environ.get("RAZORPAY_WEBHOOK_SECRET")),
    }
    if payment_id:
        events = for_entity(conn, "payment", payment_id)
        if events:
            fact = derive(events, now=now)
            out["fact"] = fact.to_agent()
            out["paid"] = fact.rail_state.value == "CONFIRMED"
            out["payment_events"] = _events_out(events)
            out["observed"] = {
                "source": "verified webhook" if any(e.sig_verified for e in events)
                          else "API response",
                "signature": "verified" if any(e.sig_verified for e in events)
                             else "unverified",
                "confidence": fact.confidence.value,
            }
            out["preview_with_webhook"] = preview_verified(events, now)
    return out


def latest_real_payment(conn: sqlite3.Connection,
                        now: int | None = None) -> dict[str, Any] | None:
    """The most recent payment that came from an actual checkout, for the MCP console to
    refund. None when the ledger holds only seeded payments."""
    now = now or int(time.time())
    row = conn.execute("SELECT payment_id, amount_minor, order_id FROM checkouts WHERE "
                       "payment_id IS NOT NULL ORDER BY created_at DESC LIMIT 1").fetchone()
    if row is None:
        return None
    return {"payment_id": row["payment_id"], "amount_minor": row["amount_minor"],
            "order_id": row["order_id"]}
