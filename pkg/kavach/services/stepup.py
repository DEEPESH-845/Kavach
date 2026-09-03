"""Step-up: the principal re-consents to one specific cart, on their own device.

The gate returns STEP_UP when the deterministic rungs pass and the entailment model is not
sure enough to admit the cart on its own. Until now that verdict produced a payload and an
audit record and stopped -- the channel was "not connected". This module is the channel:
a single-use token, a phone-safe view of what the agent wants, and a resolution.

WHAT APPROVAL DOES, EXACTLY. It does not overrule the gate. On approve, the SAME admission
path is run again against the stored mandate and cart at the moment of the tap -- so a
mandate revoked or expired between the verdict and the approval is refused with that
reason, as envelope.py promises revocation is read at decision time. Only if the cart is
still admissible-or-step-up is the nonce claimed and the mandate charged, through
mandate.record_admission, the same function admission.admit uses. No verdict is invented
here; the principal's consent is what turns STEP_UP into an admission, and that consent is
recorded as its own event.

WHAT THE TOKEN CARRIES. 192 random bits and nothing else. The QR encodes a URL with the
token; the phone fetches the view. Mandate and cart never travel in the QR.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
from typing import Any

from ..eventlog import append
from ..gate import admission, envelope, mandate
from ..intelligence.model import Model
from . import gate as gate_service

SCHEMA = """
CREATE TABLE IF NOT EXISTS stepups (
    token          TEXT PRIMARY KEY,
    mandate_json   TEXT NOT NULL,
    cart_json      TEXT NOT NULL,       -- {cart_id, merchant_id, lines, untrusted_context}
    admission_json TEXT NOT NULL,       -- the verdict that asked for re-consent
    created_at     INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL,
    status         TEXT NOT NULL,       -- PENDING | APPROVED | DENIED | EXPIRED
    resolved_at    INTEGER,
    resolved_by    TEXT,
    result_json    TEXT NOT NULL DEFAULT '{}'
);
"""

TTL = 600
PENDING, APPROVED, DENIED, EXPIRED = "PENDING", "APPROVED", "DENIED", "EXPIRED"
APPROVE, DENY = "approve", "deny"
#: Verdicts that may be sent to the principal. HOLD is merchant review, not re-consent,
#: but a merchant can still choose to ask the principal; DENY never reaches here.
ASKABLE = {admission.Verdict.STEP_UP.value, admission.Verdict.HOLD.value}


class StepUpError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def init(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def create(conn: sqlite3.Connection, *, mandate_body: dict[str, Any], cart: dict[str, Any],
           admission_result: dict[str, Any], now: int) -> dict[str, Any]:
    """Open a re-consent request. Only a STEP_UP (or HOLD) verdict may ask for one."""
    verdict = admission_result.get("verdict")
    if verdict not in ASKABLE:
        raise StepUpError("not_step_up",
                          f"verdict {verdict} does not ask the principal for anything")
    token = secrets.token_urlsafe(24)
    conn.execute(
        "INSERT INTO stepups (token, mandate_json, cart_json, admission_json, created_at, "
        "expires_at, status) VALUES (?,?,?,?,?,?,?)",
        (token, json.dumps(mandate_body, sort_keys=True), json.dumps(cart, sort_keys=True),
         json.dumps(admission_result, sort_keys=True), now, now + TTL, PENDING))
    return {"token": token, "expires_at": now + TTL, "status": PENDING}


def _row(conn: sqlite3.Connection, token: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM stepups WHERE token=?", (token,)).fetchone()
    if row is None:
        raise StepUpError("not_found", "this approval link is not one Kavach issued")
    return row


def _expire_if_due(conn: sqlite3.Connection, row: sqlite3.Row, now: int) -> str:
    if row["status"] == PENDING and now > row["expires_at"]:
        conn.execute("UPDATE stepups SET status=? WHERE token=?", (EXPIRED, row["token"]))
        return EXPIRED
    return row["status"]


def view(conn: sqlite3.Connection, token: str, now: int) -> dict[str, Any]:
    """What the principal's phone shows. Deliberately narrow: amount, items, who is asking,
    why it stopped. The envelope stays on the server."""
    row = _row(conn, token)
    status = _expire_if_due(conn, row, now)
    m = json.loads(row["mandate_json"])
    cart = json.loads(row["cart_json"])
    a = json.loads(row["admission_json"])
    total = sum(int(ln["unit_amount_minor"]) * int(ln["quantity"]) for ln in cart["lines"])
    return {
        "token": token,
        "status": status,
        "expires_at": row["expires_at"],
        "seconds_left": max(0, row["expires_at"] - now) if status == PENDING else 0,
        "agent_id": m["agent_id"],
        "mandate_id": m["mandate_id"],
        "purpose": m["purpose"],
        "merchant_id": cart["merchant_id"],
        "amount_minor": total,
        "per_txn_cap_minor": m["per_txn_cap_minor"],
        "items": [{"name": ln.get("name") or ln["description"],
                   "description": ln["description"], "quantity": ln["quantity"],
                   "total_minor": ln["unit_amount_minor"] * ln["quantity"]}
                  for ln in cart["lines"]],
        "verdict": a.get("verdict"),
        "reasons": a.get("reasons", []),
        "purpose_risk": a.get("purpose_risk"),
        "resolved_at": row["resolved_at"],
        "resolved_by": row["resolved_by"],
        "result": json.loads(row["result_json"]),
    }


def resolve(conn: sqlite3.Connection, token: str, *, action: str, now: int,
            resolver: str = "principal", model: Model | None = None) -> dict[str, Any]:
    """Approve or deny. Idempotent on (token, action); the opposite action is a conflict."""
    if action not in (APPROVE, DENY):
        raise StepUpError("invalid_action", f"action must be {APPROVE!r} or {DENY!r}")
    row = _row(conn, token)
    status = _expire_if_due(conn, row, now)
    if status == EXPIRED:
        raise StepUpError("expired", "this approval request has expired; the agent must "
                                     "ask again")
    if status != PENDING:
        same = ((status == APPROVED and action == APPROVE)
                or (status == DENIED and action == DENY))
        if same:
            return {"token": token, "status": status, "applied": False,
                    **json.loads(row["result_json"])}
        raise StepUpError("already_resolved",
                          f"this request was already {status.lower()}; it cannot be "
                          f"{action}d now")

    m = json.loads(row["mandate_json"])
    cart = json.loads(row["cart_json"])
    result: dict[str, Any]

    conn.execute("SAVEPOINT stepup_resolve")
    try:
        if action == DENY:
            seq, _ = append(conn, source="stepup", external_id=f"stepup:{token}:deny",
                            entity_type="mandate", entity_id=m["mandate_id"],
                            event_type="stepup.denied",
                            payload={"token": token, "cart_id": cart["cart_id"],
                                     "resolver": resolver, "amount_minor":
                                     sum(int(x["unit_amount_minor"]) * int(x["quantity"])
                                         for x in cart["lines"])},
                            occurred_at=now, received_at=now, sig_verified=False)
            result = {"outcome": "DENIED", "charged": False, "audit_event_seq": seq,
                      "what_happens_next": "the cart is refused; nothing was charged "
                                           "against the mandate"}
            new_status = DENIED
        else:
            # Re-run the real admission at THIS moment. Nothing is trusted from the moment
            # the token was minted: revocation, expiry and the cap are all re-read.
            gate_service.register_demo_issuer(conn)
            rerun = gate_service.admit(
                conn, envelope_body=m, cart_id=cart["cart_id"],
                merchant_id=cart["merchant_id"], lines=cart["lines"], now=now,
                expected_principal=m["principal_id"],
                untrusted_context=cart.get("untrusted_context", ""), model=model,
                charge=False)
            if rerun["verdict"] == admission.Verdict.DENY.value:
                conn.execute("RELEASE SAVEPOINT stepup_resolve")
                raise StepUpError("re_admission_refused",
                                  "approval cannot reach past the gate: " +
                                  "; ".join(rerun["reasons"]))
            env = _envelope(m)
            if not envelope.claim_nonce_for_env(conn, env, now):
                conn.execute("RELEASE SAVEPOINT stepup_resolve")
                raise StepUpError("re_admission_refused",
                                  "this mandate's nonce was already spent")
            built = gate_service.build_cart(cart["cart_id"], cart["merchant_id"],
                                            cart["lines"])
            adm_seq, _ = mandate.record_admission(conn, env, built, now=now)
            seq, _ = append(conn, source="stepup", external_id=f"stepup:{token}:approve",
                            entity_type="mandate", entity_id=m["mandate_id"],
                            event_type="stepup.approved",
                            payload={"token": token, "cart_id": cart["cart_id"],
                                     "resolver": resolver, "amount_minor": built.total_minor,
                                     "admission_event_seq": adm_seq,
                                     "rerun_verdict": rerun["verdict"]},
                            occurred_at=now, received_at=now, sig_verified=False)
            result = {"outcome": "APPROVED", "charged": True, "audit_event_seq": seq,
                      "admission_event_seq": adm_seq, "rerun_verdict": rerun["verdict"],
                      "spent_minor": mandate.spent(conn, m["mandate_id"]),
                      "what_happens_next": "the principal re-consented; the cart is "
                                           "admitted and charged against the mandate, and "
                                           "payment may proceed"}
            new_status = APPROVED
        conn.execute("UPDATE stepups SET status=?, resolved_at=?, resolved_by=?, result_json=? "
                     "WHERE token=?", (new_status, now, resolver,
                                       json.dumps(result, sort_keys=True), token))
        conn.execute("RELEASE SAVEPOINT stepup_resolve")
    except StepUpError:
        raise
    except Exception:
        conn.execute("ROLLBACK TO SAVEPOINT stepup_resolve")
        raise
    return {"token": token, "status": new_status, "applied": True, **result}


def _envelope(m: dict[str, Any]) -> envelope.Envelope:
    return envelope.Envelope(
        mandate_id=str(m["mandate_id"]), principal_id=str(m["principal_id"]),
        agent_id=str(m["agent_id"]), purpose=str(m["purpose"]),
        merchant_allowlist=tuple(m["merchant_allowlist"]),
        categories=tuple(m["categories"]),
        per_txn_cap_minor=int(m["per_txn_cap_minor"]),
        cumulative_cap_minor=int(m["cumulative_cap_minor"]),
        not_before=int(m["not_before"]), not_after=int(m["not_after"]),
        nonce=str(m["nonce"]), issued_at=int(m["issued_at"]))


def pending(conn: sqlite3.Connection, now: int, limit: int = 20) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT token FROM stepups WHERE status=? ORDER BY created_at DESC "
                        "LIMIT ?", (PENDING, limit)).fetchall()
    return [view(conn, r["token"], now) for r in rows]
