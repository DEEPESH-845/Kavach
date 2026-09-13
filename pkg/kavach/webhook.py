"""Webhook Receiver logic for Razorpay Events."""

from __future__ import annotations

import json
import logging
import os
import time
from http.server import BaseHTTPRequestHandler

from kavach import eventlog, observability
from kavach.razorpay.client import verify_webhook

logger = logging.getLogger(__name__)

#: Deliveries that were refused, kept so an operator can see a misconfigured secret or a
#: sender that is not Razorpay. The body is never stored -- only its hash, so a repeat can
#: be recognised without keeping what an unverified sender chose to post.
SCHEMA = """
CREATE TABLE IF NOT EXISTS webhook_rejections (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at        INTEGER NOT NULL,
    reason             TEXT    NOT NULL,
    signature_present  INTEGER NOT NULL,
    body_sha256        TEXT    NOT NULL,
    body_bytes         INTEGER NOT NULL,
    event_id           TEXT
);
"""


def init(conn) -> None:
    conn.executescript(SCHEMA)


def rejections(conn, limit: int = 50) -> list[dict]:
    rows = conn.execute("SELECT * FROM webhook_rejections ORDER BY id DESC LIMIT ?",
                        (limit,)).fetchall()
    return [dict(r) for r in rows]


def _reject(conn, *, reason: str, signature: str | None, raw: bytes, event_id: str | None,
            now: int) -> None:
    import hashlib
    observability.webhooks.labels(outcome="rejected").inc()
    try:
        conn.execute("INSERT INTO webhook_rejections (received_at, reason, signature_present, "
                     "body_sha256, body_bytes, event_id) VALUES (?,?,?,?,?,?)",
                     (now, reason, int(bool(signature)), hashlib.sha256(raw).hexdigest(),
                      len(raw), event_id))
    except Exception:  # noqa: BLE001 - the table may not exist on a bare connection
        logger.debug("could not record webhook rejection", exc_info=True)


def process(conn, raw_body: bytes, signature: str | None, secret: str, *,
            event_id: str | None = None, now: int | None = None) -> tuple[int, str]:
    """Verify and ingest one webhook delivery. Returns (http status, message).

    Shared by the standalone receiver below and the API server's mounted route, so the two
    cannot disagree about what counts as evidence. Fail-closed: a missing secret or a bad
    signature is a 401 and nothing is written.
    """
    now = int(time.time()) if now is None else now

    def refuse(code: int, reason: str) -> tuple[int, str]:
        logger.warning("webhook refused: %s", reason)
        _reject(conn, reason=reason, signature=signature, raw=raw_body, event_id=event_id,
                now=now)
        return code, reason

    if not signature:
        return refuse(401, "Missing signature")
    if not secret:
        return refuse(401, "No RAZORPAY_WEBHOOK_SECRET configured")
    if not verify_webhook(raw_body, signature, secret):
        return refuse(401, "Invalid signature")
    try:
        payload = json.loads(raw_body.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return refuse(400, "Malformed JSON")
    if not isinstance(payload, dict):
        return refuse(400, "Malformed JSON")
    event = payload.get("event")
    if not event or not isinstance(event, str):
        return refuse(400, "Missing event field")
    entity_type = event.split(".")[0]
    try:
        entity = payload["payload"][entity_type]["entity"]
        eid = entity["id"]
    except (KeyError, TypeError):
        return refuse(400, "Malformed entity payload")
    parent_id = entity.get("payment_id") if entity_type == "refund" else None
    external_id = event_id or f"webhook:{eid}:{event}"
    _, is_new = eventlog.append(
        conn, source="webhook", external_id=external_id, entity_type=entity_type,
        entity_id=eid, parent_entity_id=parent_id, event_type=event, payload=payload,
        occurred_at=int(payload.get("created_at") or now), received_at=now,
        sig_verified=True)
    observability.webhooks.labels(outcome="ingested" if is_new else "duplicate").inc()
    logger.info("%s event: %s (%s)", "Ingested new" if is_new else "Ignored duplicate",
                external_id, event)
    return 200, "OK"


class WebhookHandler(BaseHTTPRequestHandler):
    def _send_response(self, code: int, message: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"status": message}).encode())

    def do_POST(self) -> None:
        if self.path != "/webhooks/razorpay":
            return self._send_response(404, "Not Found")
        signature = self.headers.get("X-Razorpay-Signature")
        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length)
        secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
        try:
            conn = eventlog.connect(os.environ.get("KAVACH_DB", "kavach.db"))
            try:
                code, message = process(conn, raw_body, signature, secret,
                                        event_id=self.headers.get("X-Razorpay-Event-Id"))
            finally:
                conn.close()
            return self._send_response(code, message)
        except Exception as e:
            logger.exception("Failed to ingest webhook: %s", e)
            return self._send_response(500, "Internal error")
