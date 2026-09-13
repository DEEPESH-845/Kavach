"""Background Reconciliation Engine.

Polls the `intents` ledger for APPROVED intents that have not been settled to 
EXECUTED or FAILED. Queries the Razorpay API to determine if the intent was 
successfully processed or dropped, and settles the ledger accordingly.
"""

from __future__ import annotations

import logging
import time

from kavach import governor, ledger, observability
from kavach.razorpay.client import Razorpay, RazorpayError

from . import db

logger = logging.getLogger(__name__)


def reconcile_pending_intents(
    conn: db.Connection,
    client: Razorpay,
    tolerance_seconds: int = 60,
    now: int | None = None
) -> int:
    """Finds APPROVED intents older than tolerance and settles them.

    An intent is APPROVED in two situations: the governor allowed it and the provider call
    did not complete (a crash, a timeout, a retriable 5xx), or a human released it from the
    review queue and nothing has executed it yet. Both are the same question -- did the
    provider get it? -- and the same answer: look for a refund carrying this intent id; if
    it is there, EXECUTED; if not, EXECUTE IT NOW under the idempotency key derived from
    the intent id, which Razorpay uses to refuse a second copy. Marking an unfound intent
    FAILED, as this used to, silently dropped every human approval on the floor.

    Returns the number of intents settled either way.
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
            observability.reconciler_settled.labels(status="EXECUTED").inc()
            settled_count += 1
            continue

        # Not on the provider: this approval was never carried out. Carry it out.
        try:
            out = governor.execute_provider(conn, client, intent, governor.Decision(
                governor.Action.ALLOW, reasons=["released by review or left unexecuted; "
                                                "executed by the reconciler"]))
        except RazorpayError as e:
            status = "APPROVED" if e.retriable else "FAILED"
            logger.warning("intent %s: provider %s on execution (%s); now %s",
                           intent.intent_id, e.status, e.description or e.path, status)
            observability.reconciler_settled.labels(status=status).inc()
            settled_count += status == "FAILED"
            continue
        except Exception as e:  # noqa: BLE001 - execute_provider settled it FAILED already
            logger.error("intent %s: execution failed: %s", intent.intent_id, e)
            observability.reconciler_settled.labels(status="FAILED").inc()
            settled_count += 1
            continue
        logger.info("Executed intent %s (refund: %s)", intent.intent_id, out.get("refund_id"))
        observability.reconciler_settled.labels(status="EXECUTED").inc()
        settled_count += 1

    return settled_count


def start_background(open_conn, *, interval: int, tolerance: int = 60):
    """Run reconcile_pending_intents every `interval` seconds on a daemon thread. Returns
    a status dict the health endpoint reads; nothing here blocks a request."""
    import threading

    status = {"enabled": True, "interval": interval, "tolerance": tolerance,
              "last_run": None, "last_settled": 0, "last_error": None, "runs": 0}

    def loop() -> None:
        client = Razorpay()
        while True:
            time.sleep(interval)
            conn = open_conn()
            try:
                n = reconcile_pending_intents(conn, client, tolerance)
                status.update(last_run=int(time.time()), last_settled=n, last_error=None,
                              runs=status["runs"] + 1)
                observability.reconciler_runs.labels(outcome="ok").inc()
            except Exception as e:  # noqa: BLE001 - the loop must survive one bad cycle
                logger.exception("reconciler cycle failed")
                status.update(last_run=int(time.time()), last_error=str(e)[:200],
                              runs=status["runs"] + 1)
                observability.reconciler_runs.labels(outcome="error").inc()
            finally:
                conn.close()

    threading.Thread(target=loop, name="kavach-reconciler", daemon=True).start()
    return status
