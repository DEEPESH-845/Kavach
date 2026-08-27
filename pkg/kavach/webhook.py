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
        if not signature:
            logger.warning("Missing X-Razorpay-Signature header")
            return self._send_response(401, "Missing signature")

        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length)

        secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
        if not verify_webhook(raw_body, signature, secret):
            logger.warning("Invalid webhook signature")
            return self._send_response(401, "Invalid signature")

        try:
            payload = json.loads(raw_body.decode())
        except json.JSONDecodeError:
            logger.error("Malformed JSON payload")
            return self._send_response(400, "Malformed JSON")

        event = payload.get("event")
        if not event:
            logger.warning("Missing event field in payload")
            return self._send_response(400, "Missing event field")

        entity_type = event.split(".")[0]
        
        try:
            entity = payload["payload"][entity_type]["entity"]
            eid = entity["id"]
        except (KeyError, TypeError):
            logger.error("Missing entity payload or id")
            return self._send_response(400, "Malformed entity payload")

        parent_id = entity.get("payment_id") if entity_type == "refund" else None
        external_id = self.headers.get("X-Razorpay-Event-Id", f"webhook:{eid}:{event}")

        try:
            conn = eventlog.connect(os.environ.get("KAVACH_DB", "kavach.db"))
            _, is_new = eventlog.append(
                conn,
                source="webhook",
                external_id=external_id,
                entity_type=entity_type,
                entity_id=eid,
                parent_entity_id=parent_id,
                event_type=event,
                payload=payload,
                occurred_at=int(payload.get("created_at") or time.time()),
                received_at=int(time.time()),
                sig_verified=True,
            )
            
            if is_new:
                logger.info("Ingested new event: %s (%s)", external_id, event)
            else:
                logger.info("Ignored duplicate event: %s", external_id)
                
            return self._send_response(200, "OK")
        except Exception as e:
            logger.exception("Failed to ingest webhook: %s", e)
            return self._send_response(500, "Internal error")
