"""Kavach MCP server. Same tool names as Razorpay's MCP, different return type.

ADR-005: this is both the deployment vector and the reason the A/B comparison is fair.
Swapping Razorpay's MCP for this one is a single line in an agent's config -- same tools,
same arguments, same model, same prompt. The only variable is what the tools hand back.

    razorpay-mcp   create_refund -> {"id":"rfnd_...","status":"processing"}
    kavach      create_refund -> a decision, its reasons, and the events behind them

An agent reading `status: processing` has to guess what it means. Nothing in that payload
tells it a refund for the same obligation went out nine minutes ago.
"""

from __future__ import annotations

import base64
import binascii
import os
import time

from mcp.server import MCPServer
from mcp.types import ToolAnnotations

from .. import governor, ledger, proof
from ..eventlog import append, connect, for_entity
from ..gate import admission, envelope, mandate
from ..intelligence import entailment
from ..intelligence import model as risk
from ..money import parse_inr
from ..razorpay.client import Razorpay
from ..truth import derive

mcp = MCPServer(
    "kavach",
    instructions=(
        "Financial facts, not API entities. A refund whose rail_state is PROCESSING with "
        "obligation OPEN has NOT reached the customer and may take days to. Never report "
        "such a refund as complete. Before creating a refund, call list_open_obligations "
        "or check_refund: money may already be in flight for the same obligation from an "
        "earlier session, and creating a second one moves real money twice."))

# Read-only tools are annotated so a client can offer them freely; create_refund is marked
# destructive and non-idempotent because a second call with a new intent is a second refund.
_READ = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True)
_WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=False)

_DB = os.environ.get("KAVACH_DB", "kavach.db")
_conn = connect(_DB)
ledger.init(_conn)
envelope.init(_conn)
_client = Razorpay()
_policy = governor.Policy()

_model = None
if risk.MODEL_PATH.exists():
    _model = risk.load()
    _policy = governor.Policy(risk_threshold=_model.threshold)

# Absent, admission floors every cart at STEP_UP rather than admitting it (ADR-006).
_entailment = entailment.load() if entailment.MODEL_PATH.exists() else None


def _now() -> int:
    return int(time.time())


def _ingest(entity_type: str, entity: dict, source: str = "api_response") -> None:
    """Every API response becomes an event. The truth plane derives from the log only, so a
    response that is never ingested is a response that never happened as far as we know."""
    eid = entity.get("id")
    if not eid:
        return
    parent_id = entity.get("payment_id") if entity_type == "refund" else None
    append(_conn, source=source, external_id=f"{source}:{eid}:{entity.get('status')}",
           entity_type=entity_type, entity_id=eid, parent_entity_id=parent_id,
           event_type=f"api.{entity_type}.{entity.get('status')}", payload=entity,
           occurred_at=int(entity.get("created_at") or _now()), received_at=_now(),
           sig_verified=False)


def _risk(intent: ledger.Intent) -> tuple[float | None, list[str]]:
    if _model is None:
        return None, []
    priors = ledger.prior_intents(_conn, "payment", intent.target_id)
    row = {
        "payment_id": intent.target_id,
        "payment_amount": max(1, _payment_amount(intent.target_id)),
        "t": intent.created_at, "amount": intent.amount_minor, "reason": intent.reason_text,
        "session_id": intent.session_id, "agent_id": intent.agent_id,
        "prior": [{"amount": p.amount_minor, "reason": p.reason_text, "t": p.created_at,
                   "session_id": p.session_id, "agent_id": p.agent_id, "status": p.status,
                   "result_known": p.result_id is not None} for p in priors],
        "open_amount": ledger.exposure(_conn, intent.target_id, _now()),
        "open_count": len(ledger.open_against_payment(_conn, intent.target_id, _now())),
    }
    if not row["prior"]:
        return 0.0, ["no prior intent on this payment"]
    return _model.score(row), _model.explain(row)


def _payment_amount(payment_id: str) -> int:
    f = ledger.fact_for(_conn, "payment", payment_id, _now())
    return f.amount_minor if f else 0


@mcp.tool(annotations=_READ)
def fetch_payment(payment_id: str) -> dict:
    """Fetch a payment as a financial fact: rail state, obligation state, and evidence."""
    entity = _client.fetch_payment(payment_id)
    _ingest("payment", entity)
    fact = derive(for_entity(_conn, "payment", payment_id), now=_now())
    return {**fact.to_agent(),
            "open_refund_exposure": ledger.exposure(_conn, payment_id, _now()) / 100}


@mcp.tool(annotations=_READ)
def fetch_refund(refund_id: str) -> dict:
    """Fetch a refund as a financial fact.

    Note the difference from a raw status: a refund can be `processed` on the rail and still
    have an OPEN obligation, because Razorpay moves a refund to processed before the ARN
    arrives from the gateway and the customer is credited days later.
    """
    entity = _client.fetch_refund(refund_id)
    _ingest("refund", entity)
    return derive(for_entity(_conn, "refund", refund_id), now=_now()).to_agent()


@mcp.tool(annotations=_READ)
def list_open_obligations(payment_id: str) -> dict:
    """Money already in flight against this payment that has not reached the customer."""
    facts = ledger.open_against_payment(_conn, payment_id, _now())
    return {"payment_id": payment_id, "open_count": len(facts),
            "total_open": sum(f.amount_minor for f in facts) / 100,
            "obligations": [f.to_agent() for f in facts]}


@mcp.tool(annotations=_READ)
def check_refund(payment_id: str, amount: float | str, reason: str,
                 session_id: str = "default", agent_id: str = "mcp_client") -> dict:
    """Dry run. Returns the decision this refund WOULD get, without moving any money.

    Free to call and safe to call. An agent that is unsure should call this rather than
    guess -- which is the behaviour the raw API cannot offer, because there is no way to ask
    Razorpay "would this be a duplicate?".
    """
    intent = governor.new_intent(agent_id, session_id, payment_id, parse_inr(amount),
                               reason, _now())
    score, expl = _risk(intent)
    fact = ledger.fact_for(_conn, "payment", payment_id, _now())
    d = governor.decide(_conn, intent=intent,
                      payment_amount_minor=fact.amount_minor if fact else 0,
                      payment_captured=bool(fact and not fact.obligation_open),
                      now=_now(), policy=_policy, risk_score=score, risk_explain=expl)
    return {"would": d.action.value, **d.to_dict(), "dry_run": True}


@mcp.tool(annotations=_WRITE)
def create_refund(payment_id: str, amount: float | str, reason: str,
                  session_id: str = "default", agent_id: str = "mcp_client") -> dict:
    """Create a refund, subject to governance.

    Same name and arguments as Razorpay's MCP tool. The difference is that this one can
    refuse, and when it refuses it says why and cites the events it relied on.
    """
    fact = ledger.fact_for(_conn, "payment", payment_id, _now())
    if fact is None:
        entity = _client.fetch_payment(payment_id)
        _ingest("payment", entity)

    _conn.execute("BEGIN EXCLUSIVE")
    try:
        fact = ledger.fact_for(_conn, "payment", payment_id, _now())
        intent = governor.new_intent(agent_id, session_id, payment_id, parse_inr(amount),
                                   reason, _now())
        score, expl = _risk(intent)
        d = governor.decide(_conn, intent=intent,
                          payment_amount_minor=fact.amount_minor if fact else 0,
                          payment_captured=bool(fact and fact.rail_state.value == "CONFIRMED"),
                          now=_now(), policy=_policy, risk_score=score, risk_explain=expl)
        out = governor.reserve(_conn, intent, d)
        _conn.commit()
    except Exception:
        _conn.rollback()
        raise

    if d.action == governor.Action.ALLOW:
        out = governor.execute_provider(_conn, _client, intent, d)
        if out.get("refund_id"):
            _ingest("refund", _client.fetch_refund(out["refund_id"]))

    out["intent_id"] = intent.intent_id
    return out


@mcp.tool(annotations=_READ)
def approval_queue() -> dict:
    """Intents held for a human, with the reason each was held."""
    rows = _conn.execute(
        "SELECT intent_id, agent_id, target_id, amount_minor, reason_text, decision"
        " FROM intents WHERE status='ESCALATE' ORDER BY created_at DESC LIMIT 50").fetchall()
    return {"pending": [dict(r) for r in rows], "count": len(rows)}


@mcp.tool(annotations=_READ)
def audit_trail(payment_id: str) -> dict:
    """Every intent against this payment and what happened to it. The record a dispute needs."""
    return {"payment_id": payment_id,
            "intents": [{"intent_id": i.intent_id, "agent": i.agent_id, "session": i.session_id,
                         "amount": i.amount_minor / 100, "reason": i.reason_text,
                         "status": i.status, "refund_id": i.result_id, "at": i.created_at}
                        for i in ledger.prior_intents(_conn, "payment", payment_id)]}


@mcp.tool(annotations=_READ)
def verify_audit_trail() -> dict:
    """Cryptographically verify the integrity of the event log.
    
    Returns the verification result of the hash chain, proving whether 
    financial events have been tampered with or deleted.
    """
    valid, msg = proof.verify_event_chain(_conn)
    return {"valid": valid, "message": msg}


@mcp.tool(annotations=_READ)
def verify_agent(envelope_b64: str, signature_b64: str, key_id: str,
                 expected_principal: str = "") -> dict:
    """Inspect a delegated mandate without spending it: is it real, and what does it permit?

    Signature, validity window, principal binding and revocation are all checked. The nonce
    is deliberately NOT claimed, so asking the question does not consume the mandate and
    admit_cart can still be called with it. That also means this answer carries no replay
    protection and must never be used to gate money on its own.
    """
    try:
        raw, sig = base64.b64decode(envelope_b64), base64.b64decode(signature_b64)
    except (binascii.Error, ValueError):
        return {"valid": False, "failures": ["MALFORMED"],
                "because": "envelope and signature must be base64"}

    env, failures = envelope.verify(_conn, raw, sig, key_id=key_id, now=_now(),
                                    expected_principal=expected_principal or None,
                                    claim_nonce=False)
    if env is None:
        return {"valid": False, "failures": [f.value for f in failures],
                "because": "this mandate cannot be relied on; every reason is listed"}

    already = mandate.spent(_conn, env.mandate_id)
    return {"valid": True, "mandate_id": env.mandate_id, "principal": env.principal_id,
            "agent": env.agent_id, "purpose": env.purpose,
            "merchants": list(env.merchant_allowlist), "categories": list(env.categories),
            "per_transaction_cap": env.per_txn_cap_minor / 100,
            "cumulative_cap": env.cumulative_cap_minor / 100,
            "already_spent": already / 100,
            "remaining": max(0, env.cumulative_cap_minor - already) / 100,
            "valid_until": env.not_after,
            "note": ("purpose is enforced by an entailment model, not by the category list; "
                     "a cart can sit inside every cap and still be refused")}


@mcp.tool(annotations=_READ)
def admit_cart(envelope_b64: str, signature_b64: str, key_id: str, merchant_id: str,
               cart_id: str, lines: list[dict], expected_principal: str = "",
               untrusted_context: str = "") -> dict:
    """Decide whether this cart may be admitted under this mandate, and why.

    Each line is {sku, description, category, amount, quantity, liquid}, with amount in
    rupees per unit. `category` and `liquid` come from the MERCHANT'S catalogue, not from
    the agent -- they are relied on precisely because the agent does not set them.

    Consumes the mandate's nonce, so it may be called once per envelope. On ALLOW the cart
    is charged against the cumulative cap; on any other verdict nothing is charged.
    """
    try:
        raw, sig = base64.b64decode(envelope_b64), base64.b64decode(signature_b64)
    except (binascii.Error, ValueError):
        return {"verdict": "DENY", "envelope_failures": ["MALFORMED"],
                "reasons": ["envelope and signature must be base64"]}

    cart = mandate.Cart(
        cart_id=cart_id, merchant_id=merchant_id,
        lines=tuple(mandate.CartLine(
            sku=str(line.get("sku", "")), description=str(line.get("description", "")),
            category=str(line.get("category", "")),
            unit_amount_minor=parse_inr(line.get("amount", 0)),
            quantity=int(line.get("quantity", 1)), liquid=bool(line.get("liquid", False)))
            for line in lines))

    result = admission.admit(_conn, raw, sig, cart, key_id=key_id, now=_now(),
                             expected_principal=expected_principal or None,
                             untrusted_context=untrusted_context,
                             model=_entailment)
    return {**result.to_dict(), "cart_total": cart.total_minor / 100,
            "charged_to_mandate": result.verdict is admission.Verdict.ALLOW}


def main() -> None:
    """stdio entrypoint. Registered as the `kavach-mcp-server` console script."""
    mcp.run()


if __name__ == "__main__":
    main()
