"""Human review of escalated intents.

WHAT AN OPERATOR ACTION DOES, AND DOES NOT DO
---------------------------------------------
Approving here releases the intent for execution: it moves ESCALATE -> APPROVED and writes
an audit event naming the reviewer. It does NOT call Razorpay. Rejecting moves it to DENY
and writes the matching event.

That split is deliberate rather than a shortcut. `governor.execute_provider` is the only
thing in this system that moves money, it must run with the ledger lock held, and reaching
it from an HTTP handler on an operator's click would put a provider call behind a button
whose failure mode is a duplicate refund. An APPROVED intent with no result is precisely
the state `reconciliation.reconcile_pending_intents` exists to resolve, and it is the
component that owns talking to the provider.

Every response says which of the two happened, so the UI can never imply money moved.

Approval cannot reach past the governor. An intent the governor DENIED is not reviewable:
DENY is an accounting invariant or a permission-tier refusal, and the module docstring in
governor.py is explicit that no human waves those through here.
"""

from __future__ import annotations

import sqlite3
import time
from typing import Any

from .. import ledger
from ..eventlog import append
from .decisions import APPROVED, DENIED, ESCALATED

APPROVE = "approve"
REJECT = "reject"


class ReviewError(Exception):
    """A review action that must not be applied. Carries an HTTP-ish reason code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def act(conn: sqlite3.Connection, intent_id: str, *, action: str, reviewer: str,
        note: str = "", now: int | None = None) -> dict[str, Any]:
    """Approve or reject one escalated intent. Idempotent on (intent, action).

    Idempotency matters more here than it looks: a double-clicked Approve on a financial
    queue is the most ordinary way to create a duplicate, and eventlog's
    (source, external_id) uniqueness gives it to us for free if the external id is derived
    from the intent rather than from the click.
    """
    if action not in (APPROVE, REJECT):
        raise ReviewError("invalid_action", f"action must be {APPROVE!r} or {REJECT!r}")
    if now is None:
        now = int(time.time())

    row = conn.execute("SELECT * FROM intents WHERE intent_id = ?", (intent_id,)).fetchone()
    if row is None:
        raise ReviewError("not_found", f"no intent {intent_id}")

    status = row["status"]
    if status == DENIED:
        raise ReviewError(
            "not_reviewable",
            "this intent was DENIED by an accounting invariant or a permission tier. "
            "Those are not escalations and no reviewer can release them here.")
    if status != ESCALATED:
        raise ReviewError(
            "not_pending",
            f"intent is {status}, not {ESCALATED}; only escalated intents await review")

    target = APPROVED if action == APPROVE else DENIED
    conn.execute("SAVEPOINT review")
    try:
        seq, is_new = append(
            conn, source="review", external_id=f"review:{intent_id}:{action}",
            entity_type="intent", entity_id=intent_id,
            parent_entity_id=row["target_id"],
            event_type=f"review.{action}d",
            payload={"intent_id": intent_id, "action": action, "reviewer": reviewer,
                     "note": note, "from_status": status, "to_status": target,
                     "amount_minor": row["amount_minor"]},
            occurred_at=now, received_at=now, sig_verified=False)
        if is_new:
            ledger.settle(conn, intent_id, target)
        conn.execute("RELEASE SAVEPOINT review")
    except Exception:
        conn.execute("ROLLBACK TO SAVEPOINT review")
        raise

    return {
        "intent_id": intent_id,
        "action": action,
        "applied": is_new,
        "status": target,
        "audit_event_seq": seq,
        "provider_call": "not attempted",
        "what_happens_next": (
            "the intent is released for execution and will be settled against the provider "
            "by the reconciler; no money has moved yet"
            if action == APPROVE else
            "the intent is closed as refused; no money will move against it"),
    }
