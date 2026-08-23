"""Razorpay client: live or replay. Stdlib only.

Two modes because the demo has two jobs that pull in opposite directions. Live mode proves
the system talks to the real Razorpay test API and that the refund lifecycle we describe is
the one that actually happens. Replay mode makes the evaluation deterministic so a judge
gets the same numbers we did without our keys and without the network.

Live mode records every interaction to a cassette, so replay is a recording of reality
rather than a mock we wrote to agree with us.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from base64 import b64encode
from pathlib import Path

API = "https://api.razorpay.com/v1"
TIMEOUT = 15


class RazorpayError(RuntimeError):
    def __init__(self, status: int, body: str, path: str):
        super().__init__(f"{status} on {path}: {body[:300]}")
        self.status, self.body, self.path = status, body, path

    @property
    def retriable(self) -> bool:
        """5xx and 429 may be retried. 4xx means we asked for something wrong; retrying an
        idempotent-unsafe 4xx is how duplicates get created."""
        return self.status >= 500 or self.status == 429


class CassetteMismatch(RuntimeError):
    pass


class Razorpay:
    def __init__(self, key: str | None = None, secret: str | None = None,
                 mode: str | None = None, cassette: str = "data/cassette.jsonl"):
        # `is None`, not `or`: an explicitly blank credential means "no credential", and
        # must NOT fall back to the environment. The falsy-or version silently hands ambient
        # keys to a caller that deliberately passed none -- in a payments client that is how
        # a sandbox harness ends up authenticated against a real account.
        self.key = os.environ.get("RAZORPAY_KEY_ID", "") if key is None else key
        self.secret = (os.environ.get("RAZORPAY_KEY_SECRET", "")
                       if secret is None else secret)
        self.mode = os.environ.get("KAVACH_MODE", "replay") if mode is None else mode
        self.cassette = Path(cassette)
        self._tape: list[dict] = []
        self._pos = 0
        if self.mode == "replay" and self.cassette.exists():
            lines = self.cassette.read_text().splitlines()
            self._tape = [json.loads(x) for x in lines if x]
        if self.mode == "live" and not (self.key and self.secret):
            raise RuntimeError("live mode needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET")

    # ---------------------------------------------------------------- transport

    def _call(self, method: str, path: str, body: dict | None = None,
              headers: dict | None = None) -> dict:
        if self.mode == "replay":
            return self._replay(method, path)
        auth = b64encode(f"{self.key}:{self.secret}".encode()).decode()
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            f"{API}{path}", data=data, method=method,
            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json",
                     **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                out = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            raise RazorpayError(e.code, e.read().decode(), path) from None
        except urllib.error.URLError as e:
            raise RazorpayError(0, f"network: {e.reason}", path) from None
        self._record(method, path, body, out)
        return out

    def _record(self, method: str, path: str, body: dict | None, response: dict) -> None:
        self.cassette.parent.mkdir(parents=True, exist_ok=True)
        with self.cassette.open("a") as f:
            f.write(json.dumps({"method": method, "path": path, "body": body,
                                "response": response, "at": int(time.time())}) + "\n")

    def _replay(self, method: str, path: str) -> dict:
        """Sequential replay. Identical repeated calls are the point of this project -- a
        keyed cache would collapse the naive agent's two refunds into one and hide the very
        bug we are demonstrating -- so the tape is consumed in order."""
        while self._pos < len(self._tape):
            e = self._tape[self._pos]
            self._pos += 1
            if e["method"] == method and _shape(e["path"]) == _shape(path):
                return e["response"]
        raise CassetteMismatch(f"tape exhausted or drifted at {method} {path}")

    # ---------------------------------------------------------------- endpoints

    def create_order(self, amount_minor: int, receipt: str, notes: dict | None = None) -> dict:
        return self._call("POST", "/orders", {"amount": amount_minor, "currency": "INR",
                                              "receipt": receipt, "notes": notes or {}})

    def create_payment_link(self, amount_minor: int, description: str) -> dict:
        return self._call("POST", "/payment_links", {
            "amount": amount_minor, "currency": "INR", "description": description,
            "notify": {"sms": False, "email": False}, "reminder_enable": False})

    def fetch_payment(self, payment_id: str) -> dict:
        return self._call("GET", f"/payments/{payment_id}")

    def fetch_payments(self, count: int = 10) -> dict:
        return self._call("GET", f"/payments?count={count}")

    def fetch_refund(self, refund_id: str) -> dict:
        return self._call("GET", f"/refunds/{refund_id}")

    def payment_refunds(self, payment_id: str) -> dict:
        return self._call("GET", f"/payments/{payment_id}/refunds")

    def create_refund(self, payment_id: str, amount_minor: int,
                      idempotency_key: str, notes: dict | None = None) -> dict:
        """Always sends X-Refund-Idempotency.

        ADR-008: Razorpay already protects against a REPLAYED refund request and we use that
        protection rather than pretending it is missing. It does nothing about a
        semantically new intent -- a re-deciding agent mints a fresh key -- which is the gap
        ledger.py and risk.py exist to close. Both layers are real; they stop different bugs.
        """
        if len(idempotency_key) < 10:
            raise ValueError("Razorpay requires an idempotency key of at least 10 characters")
        return self._call("POST", f"/payments/{payment_id}/refund",
                          {"amount": amount_minor, "speed": "normal", "notes": notes or {}},
                          {"X-Refund-Idempotency": idempotency_key})


def _shape(path: str) -> str:
    """Compare paths structurally so a re-recorded cassette with new ids still replays."""
    parts = []
    for p in path.split("?")[0].split("/"):
        parts.append("<id>" if any(p.startswith(x) for x in
                                   ("pay_", "rfnd_", "order_", "plink_")) else p)
    return "/".join(parts)


def verify_webhook(raw_body: bytes, signature: str, secret: str) -> bool:
    """HMAC-SHA256 over the RAW body. The security boundary of the whole system.

    Constant-time compare, and the raw bytes -- not a re-serialised dict, whose key order
    would differ from what Razorpay signed and fail every time or, worse, be 'fixed' by
    someone disabling the check.
    """
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
