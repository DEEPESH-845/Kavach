"""Kavach MCP server. Same tool names as Razorpay's MCP, different return type.

ADR-005: this is both the deployment vector and the reason the A/B comparison is fair.
Swapping Razorpay's MCP for this one is a single line in an agent's config -- same tools,
same arguments, same model, same prompt. The only variable is what the tools hand back.

    razorpay-mcp   create_refund -> {"id":"rfnd_...","status":"processing"}
    kavach      create_refund -> a decision, its reasons, and the events behind them

An agent reading `status: processing` has to guess what it means. Nothing in that payload
tells it a refund for the same obligation went out nine minutes ago.

PARITY WITH razorpay-mcp-server IS MORE THAN NAMES. Razorpay's server groups tools into
toolsets selected with `--toolsets`, and hides every write tool under `--read-only`. This
one honours both flags with the same semantics, and read-only additionally compiles a
Policy whose permission tier refuses money movement -- so a stale client that still calls
`create_refund` is refused by the governor, not merely by a missing tool.

ONE SET OF FUNCTIONS, TWO TRANSPORTS. `@mcp.tool` returns the function unchanged, and each
one is also recorded in TOOLS. The HTTP API's `/api/mcp/{tool}` dispatches to these exact
objects under LOCK, so the console's "MCP" screen and an agent over stdio cannot disagree.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import os
import threading
import time
from collections.abc import Callable
from typing import Any

from mcp.server import MCPServer
from mcp.types import ToolAnnotations

from .. import governor, ledger, proof
from ..eventlog import append, connect, for_entity
from ..gate import admission, envelope, mandate
from ..intelligence import entailment
from ..intelligence import model as risk
from ..money import parse_inr
from ..razorpay.client import Razorpay
from ..services import decisions
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
# same_thread=False because the HTTP dispatcher below calls these functions from a thread
# pool. Every call is serialised under LOCK, so the connection is never used concurrently.
_conn = connect(_DB, same_thread=False)
ledger.init(_conn)
envelope.init(_conn)
_client = Razorpay()
_policy = governor.Policy()
LOCK = threading.RLock()

_model = None
if risk.MODEL_PATH.exists():
    _model = risk.load()
    _policy = governor.Policy(risk_threshold=_model.threshold)

# Absent, admission floors every cart at STEP_UP rather than admitting it (ADR-006).
_entailment = entailment.load() if entailment.MODEL_PATH.exists() else None

#: name -> the function object @mcp.tool registered. The HTTP surface dispatches to these.
TOOLS: dict[str, Callable[..., dict]] = {}
#: name -> toolset, in razorpay-mcp-server's vocabulary where a toolset exists there.
TOOLSET_OF: dict[str, str] = {}
WRITE_TOOLS: set[str] = set()


def _in(toolset: str, *, write: bool = False):
    """Record a tool's toolset. Stacks above @mcp.tool, which hands back the function."""
    def wrap(fn):
        TOOLS[fn.__name__] = fn
        TOOLSET_OF[fn.__name__] = toolset
        if write:
            WRITE_TOOLS.add(fn.__name__)
        return fn
    return wrap


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


@_in("payments")
@mcp.tool(annotations=_READ)
def fetch_payment(payment_id: str) -> dict:
    """Fetch a payment as a financial fact: rail state, obligation state, and evidence."""
    entity = _client.fetch_payment(payment_id)
    _ingest("payment", entity)
    fact = derive(for_entity(_conn, "payment", payment_id), now=_now())
    return {**fact.to_agent(),
            "open_refund_exposure": ledger.exposure(_conn, payment_id, _now()) / 100}


@_in("refunds")
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


@_in("refunds")
@mcp.tool(annotations=_READ)
def list_open_obligations(payment_id: str) -> dict:
    """Money already in flight against this payment that has not reached the customer."""
    facts = ledger.open_against_payment(_conn, payment_id, _now())
    return {"payment_id": payment_id, "open_count": len(facts),
            "total_open": sum(f.amount_minor for f in facts) / 100,
            "obligations": [f.to_agent() for f in facts]}


@_in("refunds")
@mcp.tool(annotations=_READ)
def check_refund(payment_id: str, amount: float | str, reason: str,
                 session_id: str = "default", agent_id: str = "mcp_client") -> dict:
    """Dry run. Returns the decision this refund WOULD get, without moving any money.

    Free to call and safe to call. An agent that is unsure should call this rather than
    guess -- which is the behaviour the raw API cannot offer, because there is no way to ask
    Razorpay "would this be a duplicate?".

    Runs decisions.evaluate, which is what create_refund runs. A dry run built out of its own
    calls to governor.decide is a dry run that can disagree with the thing it predicts, and
    this one did: it read `captured` as "the payment's obligation is closed", which is also
    true of a REVERSED or terminally FAILED payment. Only CONFIRMED means the money is ours
    to return.
    """
    intent = governor.new_intent(agent_id, session_id, payment_id, parse_inr(amount),
                                 reason, _now())
    d, truth = decisions.evaluate(_conn, intent, now=_now(), policy=_policy, model=_model)
    return {"would": d.action.value, **d.to_dict(), "truth": truth, "dry_run": True}


@_in("refunds", write=True)
@mcp.tool(annotations=_WRITE)
def create_refund(payment_id: str, amount: float | str, reason: str,
                  session_id: str = "default", agent_id: str = "mcp_client") -> dict:
    """Create a refund, subject to governance.

    Same name and arguments as Razorpay's MCP tool. The difference is that this one can
    refuse, and when it refuses it says why and cites the events it relied on.

    The decision comes from services/decisions -- the same path the HTTP API and the demo
    seed run -- so this tool cannot develop its own opinion about what "captured" means or
    how a duplicate is scored. It also means the decision is written into the hash-chained
    log as an event, not only into the mutable `intents.decision` column.
    """
    if ledger.fact_for(_conn, "payment", payment_id, _now()) is None:
        entity = _client.fetch_payment(payment_id)
        _ingest("payment", entity)

    _conn.execute("BEGIN EXCLUSIVE")
    try:
        intent = governor.new_intent(agent_id, session_id, payment_id, parse_inr(amount),
                                     reason, _now())
        d, _truth = decisions.evaluate(_conn, intent, now=_now(), policy=_policy,
                                       model=_model)
        out = decisions.record(_conn, intent, d, now=_now())
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


@_in("governance")
@mcp.tool(annotations=_READ)
def approval_queue() -> dict:
    """Intents held for a human, with the reason each was held."""
    rows = _conn.execute(
        "SELECT intent_id, agent_id, target_id, amount_minor, reason_text, decision"
        " FROM intents WHERE status='ESCALATE' ORDER BY created_at DESC LIMIT 50").fetchall()
    return {"pending": [dict(r) for r in rows], "count": len(rows)}


@_in("governance")
@mcp.tool(annotations=_READ)
def audit_trail(payment_id: str) -> dict:
    """Every intent against this payment and what happened to it. The record a dispute needs."""
    return {"payment_id": payment_id,
            "intents": [{"intent_id": i.intent_id, "agent": i.agent_id, "session": i.session_id,
                         "amount": i.amount_minor / 100, "reason": i.reason_text,
                         "status": i.status, "refund_id": i.result_id, "at": i.created_at}
                        for i in ledger.prior_intents(_conn, "payment", payment_id)]}


@_in("governance")
@mcp.tool(annotations=_READ)
def verify_audit_trail() -> dict:
    """Cryptographically verify the integrity of the event log.

    Returns the verification result of the hash chain, proving whether
    financial events have been tampered with or deleted.
    """
    valid, msg = proof.verify_event_chain(_conn)
    return {"valid": valid, "message": msg}


@_in("gate")
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


@_in("gate")
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


# --------------------------------------------------------------------------- pass-through
# Razorpay's `payment_links` and `orders` toolsets. These create a REQUEST for money rather
# than moving any, so the governor is not consulted; they are write tools all the same and
# disappear under --read-only exactly as they do in razorpay-mcp-server. Every response is
# ingested as an event so what an agent asked for is on the record.

def _ingest_checkout(kind: str, entity: dict) -> None:
    eid = entity.get("id")
    if not eid:
        return
    status_ = entity.get("status")
    append(_conn, source="api_response", external_id=f"{kind}:{eid}:{status_}",
           entity_type="checkout", entity_id=eid, event_type=f"api.{kind}.{status_}",
           payload={kind: {k: entity.get(k) for k in
                           ("id", "amount", "currency", "status", "receipt", "reference_id",
                            "short_url", "notes", "created_at")}},
           occurred_at=int(entity.get("created_at") or _now()), received_at=_now(),
           sig_verified=False)


@_in("payment_links", write=True)
@mcp.tool(annotations=_WRITE)
def create_payment_link(amount: float | str, description: str,
                        reference_id: str = "") -> dict:
    """Create a Razorpay Payment Link (a request for money; nothing moves until it is paid).
    `amount` in rupees. Same name and arguments as Razorpay's tool."""
    pl = _client.create_payment_link(parse_inr(amount), description,
                                     reference_id=reference_id or None)
    _ingest_checkout("payment_link", pl)
    return {"id": pl.get("id"), "short_url": pl.get("short_url"), "status": pl.get("status"),
            "amount": pl.get("amount", 0) / 100, "recorded": True}


@_in("payment_links")
@mcp.tool(annotations=_READ)
def fetch_payment_link(link_id: str) -> dict:
    """Fetch a Payment Link and the payments made against it."""
    pl = _client.fetch_payment_link(link_id)
    _ingest_checkout("payment_link", pl)
    return {"id": pl.get("id"), "status": pl.get("status"), "amount": pl.get("amount", 0) / 100,
            "amount_paid": pl.get("amount_paid", 0) / 100, "short_url": pl.get("short_url"),
            "payments": [p.get("payment_id") for p in pl.get("payments", [])]}


@_in("orders", write=True)
@mcp.tool(annotations=_WRITE)
def create_order(amount: float | str, receipt: str) -> dict:
    """Create a Razorpay Order for Checkout. `amount` in rupees."""
    order = _client.create_order(parse_inr(amount), receipt=receipt)
    _ingest_checkout("order", order)
    return {"id": order.get("id"), "status": order.get("status"),
            "amount": order.get("amount", 0) / 100, "receipt": order.get("receipt"),
            "recorded": True}


@_in("orders")
@mcp.tool(annotations=_READ)
def fetch_order(order_id: str) -> dict:
    """Fetch an Order."""
    order = _client.fetch_order(order_id)
    _ingest_checkout("order", order)
    return {"id": order.get("id"), "status": order.get("status"),
            "amount": order.get("amount", 0) / 100,
            "amount_paid": order.get("amount_paid", 0) / 100,
            "receipt": order.get("receipt")}


# --------------------------------------------------------------------------- configuration

TOOLSETS: tuple[str, ...] = tuple(dict.fromkeys(TOOLSET_OF.values()))
_enabled: set[str] = set(TOOLS)
_read_only = False


def configure(*, toolsets: set[str] | None = None, read_only: bool = False) -> dict[str, Any]:
    """Apply razorpay-mcp-server's flags. Removing a tool from the server hides it from
    clients; read-only ALSO compiles a Policy the governor refuses writes under."""
    global _enabled, _policy, _read_only
    unknown = set(toolsets or ()) - set(TOOLSETS)
    if unknown:
        raise ValueError(f"unknown toolsets {sorted(unknown)}; known: {list(TOOLSETS)}")
    keep = {n for n, ts in TOOLSET_OF.items() if toolsets is None or ts in toolsets}
    if read_only:
        keep -= WRITE_TOOLS
        _policy = governor.Policy(risk_threshold=_policy.risk_threshold, allow_write=False)
    _read_only = read_only
    for name in set(TOOLS) - keep:
        if name in _enabled:
            mcp.remove_tool(name)
    _enabled = keep
    return {"enabled": sorted(keep), "read_only": read_only}


def catalogue() -> list[dict[str, Any]]:
    """Every tool, whether it is currently enabled, and which toolset it belongs to."""
    return [{"name": n, "toolset": TOOLSET_OF[n], "write": n in WRITE_TOOLS,
             "enabled": n in _enabled,
             "summary": (fn.__doc__ or "").strip().splitlines()[0]}
            for n, fn in TOOLS.items()]


def dispatch(name: str, args: dict[str, Any]) -> dict:
    """Call a tool exactly as the stdio transport would, serialised on the shared connection.
    Raises KeyError for a tool that is unknown or disabled; the caller maps that."""
    if name not in _enabled:
        raise KeyError(name)
    with LOCK:
        return TOOLS[name](**args)


def status() -> dict[str, Any]:
    return {"tools": len(_enabled), "read_only": _read_only, "toolsets": list(TOOLSETS),
            "mode": _client.mode}


def main() -> None:
    """stdio entrypoint. Registered as the `kavach-mcp-server` console script."""
    parser = argparse.ArgumentParser(description="Kavach MCP server (stdio)")
    parser.add_argument("--toolsets", "-t", default=os.environ.get("KAVACH_TOOLSETS", ""),
                        help="comma-separated toolsets to enable; default all: "
                             + ",".join(TOOLSETS))
    parser.add_argument("--read-only", action="store_true",
                        default=os.environ.get("KAVACH_READ_ONLY", "").lower()
                        in {"1", "true", "on"},
                        help="hide write tools and refuse money movement at the governor")
    args = parser.parse_args()
    toolsets = {t.strip() for t in args.toolsets.split(",") if t.strip()} or None
    configure(toolsets=toolsets, read_only=args.read_only)
    mcp.run()


if __name__ == "__main__":
    main()
