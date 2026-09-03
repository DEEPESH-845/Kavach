"""Webhook Receiver logic for Razorpay Events."""

from __future__ import annotations

import json
import logging
import os
import time
from http.server import BaseHTTPRequestHandler

from kavach import eventlog
from kavach.razorpay.client import verify_webhook

logger = logging.getLogger(__name__)


def process(conn, raw_body: bytes, signature: str | None, secret: str, *,
            event_id: str | None = None, now: int | None = None) -> tuple[int, str]:
    """Verify and ingest one webhook delivery. Returns (http status, message).

    Shared by the standalone receiver below and the API server's mounted route, so the two
    cannot disagree about what counts as evidence. Fail-closed: a missing secret or a bad
    signature is a 401 and nothing is written.
    """
    if not signature:
        logger.warning("Missing X-Razorpay-Signature header")
        return 401, "Missing signature"
    if not verify_webhook(raw_body, signature, secret):
        logger.warning("Invalid webhook signature")
        return 401, "Invalid signature"
    try:
        payload = json.loads(raw_body.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.error("Malformed JSON payload")
        return 400, "Malformed JSON"
    if not isinstance(payload, dict):
        return 400, "Malformed JSON"
    event = payload.get("event")
    if not event or not isinstance(event, str):
        logger.warning("Missing event field in payload")
        return 400, "Missing event field"
    entity_type = event.split(".")[0]
    try:
        entity = payload["payload"][entity_type]["entity"]
        eid = entity["id"]
    except (KeyError, TypeError):
        logger.error("Missing entity payload or id")
        return 400, "Malformed entity payload"
    parent_id = entity.get("payment_id") if entity_type == "refund" else None
    external_id = event_id or f"webhook:{eid}:{event}"
    now = int(time.time()) if now is None else now
    _, is_new = eventlog.append(
        conn, source="webhook", external_id=external_id, entity_type=entity_type,
        entity_id=eid, parent_entity_id=parent_id, event_type=event, payload=payload,
        occurred_at=int(payload.get("created_at") or now), received_at=now,
        sig_verified=True)
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
