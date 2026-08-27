"""Background Reconciliation Engine.

Polls the `intents` ledger for APPROVED intents that have not been settled to 
EXECUTED or FAILED. Queries the Razorpay API to determine if the intent was 
successfully processed or dropped, and settles the ledger accordingly.
"""

from __future__ import annotations

import logging
import sqlite3
import time

from kavach import ledger
from kavach.razorpay.client import Razorpay

logger = logging.getLogger(__name__)


def reconcile_pending_intents(
    conn: sqlite3.Connection,
    client: Razorpay,
    tolerance_seconds: int = 60,
    now: int | None = None
) -> int:
    """Finds APPROVED intents older than tolerance and settles them.
    
    Returns the number of intents successfully settled.
    """
    if now is None:
        now = int(time.time())

    cutoff = now - tolerance_seconds
    rows = conn.execute(
        "SELECT * FROM intents WHERE status = 'APPROVED' AND created_at < ?",
        (cutoff,)
    ).fetchall()

    settled_count = 0
    for r in rows:
        intent = ledger._to_intent(r)
        
        if intent.tool != "create_refund" or intent.target_type != "payment":
            logger.warning("Unsupported intent tool %s in APPROVED state", intent.tool)
            continue

        try:
            response = client.payment_refunds(intent.target_id)
        except Exception as e:
            logger.error("Failed to fetch refunds for payment %s: %s", intent.target_id, e)
            continue

        items = response.get("items", [])
        matched_refund_id = None

        for ref in items:
            notes = ref.get("notes") or {}
            if notes.get("intent_id") == intent.intent_id:
                matched_refund_id = ref.get("id")
                break

        if matched_refund_id:
            logger.info("Reconciled intent %s as EXECUTED (refund: %s)",
                        intent.intent_id, matched_refund_id)
            ledger.settle(conn, intent.intent_id, "EXECUTED", matched_refund_id)
            settled_count += 1
        else:
            logger.info("Reconciled intent %s as FAILED (not found on provider)",
                        intent.intent_id)
            ledger.settle(conn, intent.intent_id, "FAILED")
            settled_count += 1
            
    return settled_count
