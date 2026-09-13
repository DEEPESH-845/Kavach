#!/usr/bin/env python3
"""Kavach HTTP API, and the single process a judge has to start.

BOUNDARY
--------
This is the only thing the browser talks to. It is a typed shell over the same services the
MCP tool surface uses -- there is no second decision path here, and adding one would let the
dashboard show a verdict the product would not produce. Handlers validate, call one service
function, and serialise. Any handler that starts making decisions belongs in pkg/kavach.

Errors leave as {"error": {...}} with a stable machine code and a sentence a human can act
on. Stack traces, SQL, file paths and provider payloads never cross this line: the last
thing a payments dashboard should do under load is narrate its own internals to whoever is
poking it.

MONEY
-----
Every amount that crosses this boundary is an integer count of minor units, named
`*_minor`. No float touches money in either direction. Rupee strings are for display and
are produced by the client.

STATIC UI
---------
If `web/out` exists it is mounted at `/`, so `make demo` is one command and one port with no
CORS at all. When it does not exist the API still serves, and the dev server on :3000 is
allowed through CORS explicitly.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import itertools
import json
import logging
import os
import re
import secrets
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Annotated, Any, Literal

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from kavach import (
    __version__,
    auth,
    config,
    db,
    governor,
    ledger,
    migrations,
    observability,
    proof,
    reconciliation,
    webhook,
)
from kavach.eventlog import connect
from kavach.gate import envelope
from kavach.intelligence import entailment
from kavach.intelligence import model as risk_model
from kavach.money import MAX_MINOR_UNITS, MoneyError
from kavach.razorpay.client import CassetteMismatch, RazorpayError
from kavach.services import (
    checkout,
    dashboard,
    decisions,
    demo,
    dispute,
    duel,
    financials,
    intents,
    notify,
    ratelimit,
    review,
    scenarios,
    stepup,
    storefront,
    tamper,
)
from kavach.services import gate as gate_service
from pydantic import BaseModel, Field, field_validator, model_validator

log = logging.getLogger("kavach.api")

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = os.environ.get("KAVACH_DB", str(ROOT / "kavach.db"))
STATIC_DIR = ROOT / "web" / "out"
EVALS = ROOT / "evals"

#: Entity types a caller may address. Anything else is a 400, not a database query with
#: attacker-chosen text in it.
ENTITY_TYPES = ("payment", "refund")

app = FastAPI(
    title="Kavach API",
    version=__version__,
    description="Financial truth and action governance for agentic commerce.",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

# The dev server is a different origin; the built UI is same-origin and needs none of this.
# KAVACH_CORS_ORIGINS (comma-separated) adds a UI hosted elsewhere, e.g. the Vercel export
# whose NEXT_PUBLIC_KAVACH_API points here.
_SETTINGS = config.current()   # invalid KAVACH_POLICY refuses to start, naming the field
_EXTRA_ORIGINS = [o.strip().rstrip("/")
                  for o in os.environ.get("KAVACH_CORS_ORIGINS", "").split(",") if o.strip()]
_EXTRA_ORIGINS += [o for o in _SETTINGS.cors_origins if o not in _EXTRA_ORIGINS]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000",
                   "http://localhost:4173", "http://127.0.0.1:4173", *_EXTRA_ORIGINS],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Request-Id"],
)

STARTED_AT = time.time()
#: itertools.count is a single C-level increment: atomic under the GIL, unlike `+= 1`.
_request_counter = itertools.count(1)
_requests_served = 0
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
#: Endpoints a stranger can drive from a QR code or a demo button. Bounded per client.
#: Not the webhook: its gate is the HMAC, and a legitimate burst from Razorpay's few egress
#: addresses must never be told to wait a minute.
_LIMITED = ("/api/stepup", "/api/checkout", "/api/mcp", "/api/demo", "/api/proof/tamper")
#: Every body on this API is an id, an amount, a mandate or a cart. A larger one is not a
#: request this surface has a use for; it is memory somebody else chose.
MAX_BODY = 1_000_000
_bucket = ratelimit.Bucket(int(os.environ.get("KAVACH_RATE_LIMIT", "0") or 0)
                           or _SETTINGS.rate_limit_per_minute)


#: Only a deployment that IS behind a proxy may believe X-Forwarded-For. Off by default:
#: trusting it unconditionally lets any client mint a fresh rate-limit bucket per request
#: by varying one header, which is a rate limit that only looks like one.
_TRUST_PROXY = os.environ.get("KAVACH_TRUST_PROXY", "").strip().lower() in {"1", "true", "on"}


def _client_key(request: Request) -> str:
    peer = request.client.host if request.client else "?"
    if not _TRUST_PROXY:
        return peer
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() if fwd else "") or peer


_access = logging.getLogger("kavach.access")


def _route_of(request: Request) -> str:
    """The route template, not the path: /api/intents/{intent_id} rather than one label per
    id, or the metrics cardinality is whatever callers make it."""
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    if path:
        return path
    return "/api/*" if request.url.path.startswith("/api/") else "/static"


@app.middleware("http")
async def _request_id_and_limits(request: Request, call_next):
    global _requests_served
    _requests_served = next(_request_counter)
    incoming = request.headers.get("x-request-id", "")
    rid = incoming if _REQUEST_ID.match(incoming) else f"req_{secrets.token_hex(6)}"
    request.state.request_id = rid
    token = observability.request_id.set(rid)
    started = time.perf_counter()
    try:
        length = request.headers.get("content-length", "")
        if length.isdigit() and int(length) > MAX_BODY:
            response = JSONResponse(status_code=413, content={
                "error": {"code": "payload_too_large",
                          "message": f"request bodies are limited to {MAX_BODY} bytes"}})
        elif request.url.path.startswith(_LIMITED) and not _bucket.allow(_client_key(request)):
            response = JSONResponse(status_code=429, content={
                "error": {"code": "rate_limited",
                          "message": "too many requests from this client; wait a minute"}})
        else:
            response = await call_next(request)
        response.headers["X-Request-Id"] = rid
        if request.url.path.startswith("/api/"):
            elapsed = time.perf_counter() - started
            route = _route_of(request)
            observability.http_requests.labels(route=route, method=request.method,
                                               status=str(response.status_code)).inc()
            observability.http_latency.labels(route=route).observe(elapsed)
            key = getattr(request.state, "key", None)
            _access.info("%s %s %d %.1fms", request.method, request.url.path,
                         response.status_code, elapsed * 1000,
                         extra={"route": route, "method": request.method,
                                "status": response.status_code,
                                "ms": round(elapsed * 1000, 1),
                                "key": key.name if key else None})
        return response
    finally:
        observability.request_id.reset(token)


# ------------------------------------------------------------------ infrastructure

_models: dict[str, Any] = {}


def _load_models() -> None:
    """Load once at startup. A model that fails to load stays absent rather than retrying
    per request: absent widens caution everywhere, which is the safe direction."""
    for name, module in (("risk", risk_model), ("entailment", entailment)):
        try:
            _models[name] = module.load() if module.MODEL_PATH.exists() else None
        except Exception:
            log.exception("could not load the %s model; continuing without it", name)
            _models[name] = None
        log.info("%s model: %s", name, "loaded" if _models[name] else "unavailable")


def policy(agent_id: str | None = None) -> governor.Policy:
    """The policy one decision runs under: KAVACH_POLICY's limits, this agent's tier, and
    the model's frozen threshold unless the file overrides it."""
    m = _models.get("risk")
    return config.current().policy_for(agent_id, model_threshold=m.threshold if m else None)


@contextmanager
def _open() -> Iterator[db.Connection]:
    """One connection per request, closed when the request ends.

    same_thread=False is required and safe here for a specific reason: FastAPI runs a
    synchronous dependency's body in one threadpool worker and its teardown in another, so
    the close() below lands on a different thread from the queries above it. The two never
    overlap, and no connection is ever shared between concurrent requests.
    """
    conn = connect(DB_PATH, same_thread=False)
    try:
        ledger.init(conn)
        envelope.init(conn)
        stepup.init(conn)
        checkout.init(conn)
        notify.init(conn)
        webhook.init(conn)
        migrations.apply(conn)
        yield conn
    finally:
        conn.close()


def _db_dep() -> Iterator[db.Connection]:
    with _open() as conn:
        yield conn


Conn = Annotated[db.Connection, Depends(_db_dep)]


def _fail(status: int, code: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code=status,
                         detail={"code": code, "message": message, **extra})


# ------------------------------------------------------------------ authentication
#
# Three scopes, readonly < agent < operator, carried as `Authorization: Bearer kv_...`.
# KAVACH_AUTH=off (the default only when KAVACH_DEMO=1) admits everyone as the anonymous
# operator. The routes that never take a key are the ones whose credential is something
# else: the webhook's HMAC, a step-up token, a Razorpay order id on the paying browser.

_BEARER = re.compile(r"^Bearer\s+(\S+)$", re.I)
ANONYMOUS = auth.Key("anonymous", "operator", "operator")


def caller(request: Request, conn: Conn) -> auth.Key | None:
    """The key behind this request, or None. Never raises; require() decides."""
    m = _BEARER.match(request.headers.get("authorization", ""))
    if not m:
        return None
    key = auth.verify(conn, m.group(1), now=int(time.time()))
    request.state.key = key
    return key


Caller = Annotated[auth.Key | None, Depends(caller)]


def require(scope: str):
    """A dependency admitting only a key that holds at least `scope`."""
    def dep(request: Request, key: Caller) -> auth.Key:
        if auth.mode() == "off":
            return key or ANONYMOUS
        if key is None:
            code = "invalid_key" if request.headers.get("authorization") else "missing_key"
            raise _fail(401, code, "this endpoint needs an API key: send "
                                   "`Authorization: Bearer kv_...`; mint one with "
                                   "`python -m kavach keys create`")
        if not auth.allows(key.scope, scope):
            raise _fail(403, "insufficient_scope",
                        f"this key holds the {key.scope} scope; {scope} is needed")
        return key
    return dep


ReadOnly = Annotated[auth.Key, Depends(require("readonly"))]
AgentKey = Annotated[auth.Key, Depends(require("agent"))]
Operator = Annotated[auth.Key, Depends(require("operator"))]


def demo_only() -> None:
    """Lab, storefront and console-MCP surfaces exist only where KAVACH_DEMO=1 says so.
    A 404 rather than a 403: outside a demo these routes are not something this
    deployment has, and naming them would be an inventory for a stranger."""
    if not demo.enabled():
        raise _fail(404, "demo_disabled", "this surface is only mounted when KAVACH_DEMO=1")


Demo = Annotated[None, Depends(demo_only)]


@app.exception_handler(HTTPException)
async def _http_error(_: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if not isinstance(detail, dict):
        detail = {"code": "error", "message": str(detail)}
    return JSONResponse(status_code=exc.status_code, content={"error": detail})


@app.exception_handler(RequestValidationError)
async def _invalid(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Rejections use the same envelope as every other error.

    Two shapes for two kinds of failure means the client needs two code paths to read an
    error, and the one it writes second is the one that renders "[object Object]".
    """
    fields = [{"field": ".".join(str(p) for p in e.get("loc", ())[1:]) or "body",
               "problem": e.get("msg", "is invalid")}
              for e in exc.errors()[:10]]
    return JSONResponse(status_code=422, content={"error": {
        "code": "invalid_request", "fields": fields,
        "message": "; ".join(f"{f['field']} {f['problem']}" for f in fields)
                   or "the request body is not valid"}})


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
    """Log everything, disclose nothing. The reference is how support ties a user's report
    to the line in the log without the response carrying the detail."""
    ref = f"err_{int(time.time() * 1000):x}"
    log.exception("unhandled error [%s] on %s", ref, request.url.path)
    return JSONResponse(status_code=500, content={"error": {
        "code": "internal_error", "reference": ref,
        "message": "Kavach could not complete this operation. The failure has been logged."}})


def _entity_type(value: str) -> str:
    if value not in ENTITY_TYPES:
        raise _fail(400, "unknown_entity_type",
                    f"entity type must be one of {', '.join(ENTITY_TYPES)}")
    return value


# ------------------------------------------------------------------ request models

class EvaluateRequest(BaseModel):
    """A proposed money movement. Dry run unless `commit` is explicitly true."""

    agent_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(min_length=1, max_length=128)
    target_id: str = Field(min_length=1, max_length=128)
    amount_minor: int = Field(gt=0, le=MAX_MINOR_UNITS)
    reason_text: str = Field(default="", max_length=2_000)
    tool: str = Field(default="create_refund", max_length=64)
    target_type: Literal["payment", "order"] = "payment"
    commit: bool = False

    @field_validator("agent_id", "session_id", "target_id", "tool")
    @classmethod
    def _printable(cls, v: str) -> str:
        # Identifiers land in an append-only log an operator reads. Control characters in
        # one are either a mistake or an attempt to make a log line lie about its shape.
        if any(ord(c) < 0x20 or ord(c) == 0x7F for c in v):
            raise ValueError("identifiers may not contain control characters")
        return v


class CartLineRequest(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    description: str = Field(min_length=1, max_length=300)
    category: str = Field(min_length=1, max_length=64)
    unit_amount_minor: int = Field(ge=0, le=MAX_MINOR_UNITS)
    quantity: int = Field(default=1, ge=1, le=1_000)
    liquid: bool = False


class MandateRequest(BaseModel):
    mandate_id: str = Field(min_length=1, max_length=128)
    principal_id: str = Field(min_length=1, max_length=128)
    agent_id: str = Field(min_length=1, max_length=128)
    purpose: str = Field(min_length=1, max_length=2_000)
    merchant_allowlist: list[str] = Field(min_length=1, max_length=64)
    categories: list[str] = Field(default_factory=list, max_length=64)
    per_txn_cap_minor: int = Field(ge=0, le=MAX_MINOR_UNITS)
    cumulative_cap_minor: int = Field(ge=0, le=MAX_MINOR_UNITS)
    not_before: int
    not_after: int
    nonce: str = Field(min_length=1, max_length=128)
    issued_at: int


class SignedEnvelope(BaseModel):
    """The bytes a principal signed, the signature, and which registered key to check with.
    Base64 because the signature covers the RAW bytes: re-serialising JSON on this side
    would make key order load-bearing."""

    raw_b64: str = Field(min_length=1, max_length=16_000)
    signature_b64: str = Field(min_length=1, max_length=256)
    key_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")

    def decode(self) -> tuple[bytes, bytes, str]:
        try:
            raw = base64.b64decode(self.raw_b64, validate=True)
            sig = base64.b64decode(self.signature_b64, validate=True)
        except (binascii.Error, ValueError):
            raise ValueError("raw_b64 and signature_b64 must be base64") from None
        if len(sig) != 64:
            raise ValueError("signature_b64 must decode to a 64-byte Ed25519 signature")
        return raw, sig, self.key_id

    @field_validator("raw_b64", "signature_b64")
    @classmethod
    def _b64(cls, v: str) -> str:
        try:
            base64.b64decode(v, validate=True)
        except (binascii.Error, ValueError):
            raise ValueError("must be base64") from None
        return v


class AdmitRequest(BaseModel):
    #: Exactly one of the two. `mandate` is the demo form (the server signs it as the demo
    #: principal); `envelope` is what a real principal produced with their own key.
    mandate: MandateRequest | None = None
    envelope: SignedEnvelope | None = None
    cart_id: str = Field(min_length=1, max_length=128)
    merchant_id: str = Field(min_length=1, max_length=128)
    lines: list[CartLineRequest] = Field(max_length=100)
    untrusted_context: str = Field(default="", max_length=8_000)
    #: false runs the ladder without claiming the nonce or charging the cumulative cap, so
    #: the same mandate can be explored repeatedly. Admission itself is unchanged.
    commit: bool = False

    @model_validator(mode="after")
    def _one_of(self) -> AdmitRequest:
        if (self.mandate is None) == (self.envelope is None):
            raise ValueError("send exactly one of `mandate` (demo, server-signed) or "
                             "`envelope` (raw_b64, signature_b64, key_id)")
        return self


class InspectRequest(BaseModel):
    mandate: MandateRequest | None = None
    envelope: SignedEnvelope | None = None

    @model_validator(mode="before")
    @classmethod
    def _bare_mandate(cls, data: Any) -> Any:
        # The console posts the mandate itself; a bare body is the demo form.
        if isinstance(data, dict) and "mandate_id" in data:
            return {"mandate": data}
        return data

    @model_validator(mode="after")
    def _one_of(self) -> InspectRequest:
        if (self.mandate is None) == (self.envelope is None):
            raise ValueError("send exactly one of `mandate` (demo, server-signed) or "
                             "`envelope` (raw_b64, signature_b64, key_id)")
        return self


class IssuerRequest(BaseModel):
    key_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    public_key_b64: str = Field(min_length=40, max_length=64)

    def public_key(self) -> bytes:
        try:
            raw = base64.b64decode(self.public_key_b64, validate=True)
        except (binascii.Error, ValueError):
            raise ValueError("public_key_b64 must be base64") from None
        if len(raw) != 32:
            raise ValueError("public_key_b64 must decode to a 32-byte raw Ed25519 key")
        return raw


class ReviewRequest(BaseModel):
    action: Literal["approve", "reject"]
    reviewer: str = Field(default="operator", min_length=1, max_length=128)
    note: str = Field(default="", max_length=2_000)


class PlanRequest(BaseModel):
    mandate: MandateRequest
    mode: str = Field(default="legit", min_length=1, max_length=32, pattern=r"^[a-z_]+$")


class NotifyRequest(BaseModel):
    channel: Literal["email", "sms", "whatsapp", "webhook"]
    to: str = Field(min_length=1, max_length=320)


class StepUpCreateRequest(AdmitRequest):
    """Admission plus, optionally, where to send the approval link."""

    notify: NotifyRequest | None = None


class StepUpResolveRequest(BaseModel):
    action: Literal["approve", "deny"]
    resolver: str = Field(default="principal", min_length=1, max_length=64,
                          pattern=r"^[A-Za-z0-9 ._-]+$")


class CheckoutStartRequest(BaseModel):
    """Only the cart id. Everything priced -- amount, merchant, agent -- is read from the
    gate's own admission event, which is the only record of what was authorised."""

    cart_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")
    mandate_id: str = Field(min_length=1, max_length=128)


class CheckoutConfirmRequest(BaseModel):
    order_id: str = Field(min_length=1, max_length=64, pattern=r"^order_[A-Za-z0-9]+$")
    payment_id: str = Field(min_length=1, max_length=64, pattern=r"^pay_[A-Za-z0-9]+$")
    signature: str = Field(min_length=1, max_length=128, pattern=r"^[a-f0-9]+$")


class TamperRequest(BaseModel):
    seq: int | None = Field(default=None, ge=1)


class McpCallRequest(BaseModel):
    args: dict[str, Any] = Field(default_factory=dict)

    @field_validator("args")
    @classmethod
    def _keys(cls, v: dict[str, Any]) -> dict[str, Any]:
        if len(v) > 32 or any(not re.match(r"^[a-z_][a-z0-9_]{0,63}$", k) for k in v):
            raise ValueError("argument names must be short snake_case identifiers")
        # A tool argument is an id, an amount or a sentence. Anything larger is not a call
        # this surface has a use for, and an unbounded one is memory somebody else chose.
        if len(json.dumps(v, default=str)) > 20_000:
            raise ValueError("arguments must be under 20 kB")
        return v


# ------------------------------------------------------------------ system

@app.get("/api/health")
def health(conn: Conn) -> dict[str, Any]:
    """What this environment actually is. The UI's mode banner reads this, not a constant.

    The chain check here is incremental (rows since the last verified head); the full walk
    is /api/proof/verify. A health probe every 30 s must not scan the whole log."""
    status = proof.status(conn)
    mode = os.environ.get("KAVACH_MODE", "replay")
    return {
        "status": "ok",
        "version": __version__,
        "mode": mode,
        "mode_note": ("deterministic replay: no external payment is created or mutated"
                      if mode != "live" else
                      "LIVE: calls reach the Razorpay API with real credentials"),
        "database": Path(DB_PATH).name,
        "models": {"duplicate_risk": _models.get("risk") is not None,
                   "entailment": _models.get("entailment") is not None},
        "integrity": {"chain_intact": status["ok"], "events": status["events"],
                      "broken_at": status["broken_at"], "incremental": True},
        # Limits are behind /api/policy (a key); an unauthenticated probe learns only what
        # this deployment IS, never what it would let through.
        "kill_switch": policy().kill_switch,
        "ui": STATIC_DIR.exists(),
        "razorpay": {"mode": mode,
                     "credentials": bool(os.environ.get("RAZORPAY_KEY_ID")
                                         and os.environ.get("RAZORPAY_KEY_SECRET")),
                     "checkout": checkout.available()[0],
                     "checkout_note": checkout.available()[1]},
        "webhook": {"configured": bool(os.environ.get("RAZORPAY_WEBHOOK_SECRET")),
                    "path": "/api/webhooks/razorpay",
                    "note": ("signed webhooks become DERIVED_CERTAIN evidence"
                             if os.environ.get("RAZORPAY_WEBHOOK_SECRET") else
                             "no RAZORPAY_WEBHOOK_SECRET: webhooks are refused (fail-closed) "
                             "and payments observed by polling stay DERIVED_PROBABLE")},
        "mcp": _mcp_status() if demo.enabled() else {
            "available": False,
            "reason": "the console MCP surface is a demo feature (KAVACH_DEMO=1); agents "
                      "connect over stdio with kavach-mcp-server"},
        "auth": {"mode": auth.mode(), "scopes": list(auth.SCOPES)},
        "demo": {"reset_enabled": demo.enabled()},
        "reconciler": _reconciler or {"enabled": False,
                                      "note": "KAVACH_RECONCILE_INTERVAL=0 or replay mode; "
                                              "run `python -m kavach reconcile` instead"},
        "observability": _observability,
        "uptime_seconds": int(time.time() - STARTED_AT),
    }


def _mcp_status() -> dict[str, Any]:
    try:
        return {"available": True, **_mcp().status()}
    except HTTPException as e:
        return {"available": False, "reason": e.detail.get("message")
                if isinstance(e.detail, dict) else str(e.detail)}


@app.get("/api/policy")
def get_policy(_: ReadOnly) -> dict[str, Any]:
    p = policy()
    m = _models.get("risk")
    s = config.current()
    return {
        "source": s.source or "compiled defaults (no KAVACH_POLICY)",
        "gate_costs": {"fraud_loss_share": s.costs.fraud_loss_share,
                       "margin_share": s.costs.margin_share,
                       "step_up_minor": s.costs.step_up_minor,
                       "hold_minor": s.costs.hold_minor,
                       "step_up_catch_rate": s.costs.step_up_catch_rate,
                       "hold_catch_rate": s.costs.hold_catch_rate},
        "agent_tiers": dict(s.agents),
        "limits": {
            "max_auto_refund_minor": p.max_auto_refund_minor,
            "session_cap_minor": p.session_cap_minor,
            "daily_cap_minor": p.daily_cap_minor,
            "risk_threshold": p.risk_threshold,
            "allow_write": p.allow_write,
            "kill_switch": p.kill_switch,
        },
        "threshold_source": ("[limits].risk_threshold in the policy file"
                             if s.risk_threshold_override is not None else
                             "the estimator's frozen training threshold"
                             if m else "governor.Policy default; no model is loaded"),
        "authority_order": [
            {"rank": 1, "layer": "Accounting invariants", "kind": "deterministic",
             "outcome": "DENY", "note": "cannot be overridden by a model or a human here"},
            {"rank": 2, "layer": "Permission tier", "kind": "deterministic",
             "outcome": "DENY", "note": "read-only agents cannot move money"},
            {"rank": 3, "layer": "Kill switch", "kind": "operator",
             "outcome": "ESCALATE",
             "note": "KAVACH_KILL_SWITCH suspends autonomous money movement; "
                     "a human sees every intent"},
            {"rank": 4, "layer": "Truth-plane confidence", "kind": "deterministic",
             "outcome": "ESCALATE",
             "note": "an obligation in an AMBIGUOUS state raises the floor to a human"},
            {"rank": 5, "layer": "Duplicate-risk model", "kind": "learned, advisory",
             "outcome": "ESCALATE",
             "note": "may only widen caution; a low score never authorises anything"},
            {"rank": 6, "layer": "Exposure caps", "kind": "deterministic",
             "outcome": "ESCALATE", "note": "per-refund, per-session and daily"},
        ],
        "mutable": False,
        "mutability_note": "policy comes from the file KAVACH_POLICY names, or the compiled "
                           "defaults. There is no API that edits it, because a limit an "
                           "operator can raise from the screen it is failing on is not a "
                           "limit; the file's diff and deploy are the audit trail.",
    }


@app.get("/api/overview")
def overview(conn: Conn, _: ReadOnly) -> dict[str, Any]:
    return dashboard.overview(conn)


@app.get("/api/stream")
def stream(conn: Conn, _: ReadOnly, limit: int = Query(40, ge=1, le=200),
           before: int | None = Query(None, ge=0)) -> dict[str, Any]:
    return dashboard.stream(conn, limit=limit, before=before)


# ------------------------------------------------------------------ intents

@app.get("/api/intents")
def list_intents(conn: Conn, _: ReadOnly, status: str | None = Query(None, max_length=32),
                 agent_id: str | None = Query(None, max_length=128),
                 target_id: str | None = Query(None, max_length=128),
                 limit: int = Query(50, ge=1, le=200),
                 offset: int = Query(0, ge=0)) -> dict[str, Any]:
    return intents.listing(conn, status=status, agent_id=agent_id, target_id=target_id,
                           limit=limit, offset=offset)


@app.get("/api/intents/{intent_id}")
def intent_detail(intent_id: str, conn: Conn, _: ReadOnly) -> dict[str, Any]:
    out = intents.detail(conn, intent_id)
    if out is None:
        raise _fail(404, "intent_not_found", f"No intent {intent_id} exists in this ledger.")
    return out


@app.post("/api/governor/evaluate")
def evaluate(body: EvaluateRequest, conn: Conn, _: AgentKey) -> dict[str, Any]:
    """Run the real outbound pipeline. Records nothing unless `commit` is true.

    The dry run is genuinely the same code path -- decisions.evaluate is what
    decisions.evaluate_and_record calls -- so what the lab shows is what execution would do.
    """
    now = int(time.time())
    intent = governor.new_gate_intent(body.agent_id, body.session_id, body.tool,
                                      body.target_type, body.target_id, body.amount_minor,
                                      body.reason_text, now)
    model = _models.get("risk")
    if not body.commit:
        decision, truth = decisions.evaluate(conn, intent, now=now,
                                             policy=policy(body.agent_id), model=model)
        return {"committed": False, "intent_id": None, "decision": decision.to_dict(),
                "truth": truth,
                "note": "dry run: no intent was recorded and no money moved"}

    out = decisions.evaluate_and_record(conn, intent, now=now, policy=policy(body.agent_id),
                                        model=model)
    # Same shape as the dry run -- `decision` nested -- so a client reads one field either
    # way. The flat copy evaluate_and_record returns is what the MCP tool hands agents.
    decision = {k: out[k] for k in ("action", "reasons", "evidence_events", "duplicate_risk",
                                    "risk_factors", "open_exposure")}
    return {"committed": True, "intent_id": out["intent_id"], "decision": decision,
            "truth": out["truth"], "decision_event_seq": out["decision_event_seq"],
            "executed": out["executed"], "reserved": out.get("reserved", False),
            "note": "the intent and its decision are recorded; the provider was not called"}


@app.get("/api/review")
def review_queue(conn: Conn, _: ReadOnly) -> dict[str, Any]:
    return intents.review_queue(conn)


@app.post("/api/review/{intent_id}")
def review_act(intent_id: str, body: ReviewRequest, conn: Conn,
               key: Operator) -> dict[str, Any]:
    # Who acted is the key, not a field the client fills in. Only the anonymous demo
    # operator (auth off) may name themselves.
    reviewer = body.reviewer if key is ANONYMOUS else key.name
    try:
        return review.act(conn, intent_id, action=body.action, reviewer=reviewer,
                          note=body.note)
    except review.ReviewError as e:
        status = {"not_found": 404, "not_pending": 409, "not_reviewable": 409}.get(
            e.code, 400)
        raise _fail(status, e.code, e.message) from None


@app.get("/api/reconciliation")
def reconciliation_queue(conn: Conn, _: ReadOnly) -> dict[str, Any]:
    return intents.unresolved(conn)


# ------------------------------------------------------------------ money

@app.get("/api/entities/{entity_type}")
def list_entities(entity_type: str, conn: Conn, _: ReadOnly,
                  limit: int = Query(50, ge=1, le=200),
                  offset: int = Query(0, ge=0)) -> dict[str, Any]:
    return financials.listing(conn, _entity_type(entity_type), limit=limit, offset=offset)


@app.get("/api/entities/{entity_type}/{entity_id}")
def entity_detail(entity_type: str, entity_id: str, conn: Conn,
                  _: ReadOnly) -> dict[str, Any]:
    out = financials.detail(conn, _entity_type(entity_type), entity_id)
    if out is None:
        raise _fail(404, "entity_not_found",
                    f"Kavach holds no events for {entity_type} {entity_id}.")
    return out


@app.get("/api/truth/{entity_type}/{entity_id}")
def truth_trace(entity_type: str, entity_id: str, conn: Conn,
                _: ReadOnly) -> dict[str, Any]:
    out = financials.truth_trace(conn, _entity_type(entity_type), entity_id)
    if out is None:
        raise _fail(404, "entity_not_found",
                    f"Kavach holds no events for {entity_type} {entity_id}, so there is "
                    f"no derivation to show.")
    return out


@app.get("/api/obligations")
def obligations(conn: Conn, _: ReadOnly) -> dict[str, Any]:
    return financials.obligations(conn)


# ------------------------------------------------------------------ agents and gate

@app.get("/api/agents")
def list_agents(conn: Conn, _: ReadOnly) -> dict[str, Any]:
    return {"items": intents.agents(conn)}


@app.get("/api/agents/{agent_id}")
def agent_detail(agent_id: str, conn: Conn, _: ReadOnly) -> dict[str, Any]:
    out = intents.agent_detail(conn, agent_id)
    if out is None:
        raise _fail(404, "agent_not_found", f"No agent {agent_id} has acted here.")
    return out


def _envelope_args(mandate: MandateRequest | None, signed: SignedEnvelope | None,
                   conn: db.Connection) -> dict[str, Any]:
    """The keyword arguments gate_service.admit/inspect take for either form. The demo
    form only exists under KAVACH_DEMO=1: outside a demo the server signs nothing."""
    if signed is not None:
        try:
            raw, sig, key_id = signed.decode()
        except ValueError as e:
            raise _fail(422, "invalid_request", str(e)) from None
        principal = _principal_of(raw)
        return {"signed": (raw, sig, key_id), "expected_principal": principal}
    assert mandate is not None
    if not demo.enabled():
        raise _fail(403, "demo_signing_disabled",
                    "this deployment does not sign mandates for callers; send `envelope` "
                    "{raw_b64, signature_b64, key_id} signed by a registered principal key")
    gate_service.register_demo_issuer(conn)
    return {"envelope_body": mandate.model_dump(), "expected_principal": mandate.principal_id}


def _principal_of(raw: bytes) -> str | None:
    """The principal the envelope names, so binding is checked; an unparsable envelope is
    left to the verifier, which reports MALFORMED with everything else."""
    try:
        body = json.loads(raw.decode())
        return str(body["principal_id"]) if isinstance(body, dict) else None
    except (ValueError, KeyError, TypeError):
        return None


@app.post("/api/gate/inspect")
def gate_inspect(body: InspectRequest, conn: Conn, _: ReadOnly) -> dict[str, Any]:
    """Verify a mandate without spending it. Carries no replay protection by design."""
    return gate_service.inspect(conn, now=int(time.time()),
                                **_envelope_args(body.mandate, body.envelope, conn))


@app.post("/api/gate/admit")
def gate_admit(body: AdmitRequest, conn: Conn, _: AgentKey) -> dict[str, Any]:
    return gate_service.admit(
        conn, cart_id=body.cart_id, merchant_id=body.merchant_id,
        lines=[line.model_dump() for line in body.lines], now=int(time.time()),
        untrusted_context=body.untrusted_context, model=_models.get("entailment"),
        charge=body.commit, **_envelope_args(body.mandate, body.envelope, conn))


# ------------------------------------------------------------------ proof

@app.get("/api/proof/chain")
def proof_chain(conn: Conn, _: ReadOnly, limit: int = Query(50, ge=1, le=200),
                before: int | None = Query(None, ge=1)) -> dict[str, Any]:
    return proof.chain(conn, limit=limit, before=before)


@app.get("/api/proof/verify")
def proof_verify(conn: Conn, _: ReadOnly) -> dict[str, Any]:
    status = proof.scan(conn)
    return {**status, "claims": proof.claims(), "verified_at": int(time.time())}


@app.get("/api/dispute/{intent_id}")
def dispute_pack(intent_id: str, conn: Conn, _: ReadOnly) -> JSONResponse:
    out = dispute.pack(conn, intent_id)
    if out is None:
        raise _fail(404, "intent_not_found", f"No intent {intent_id} exists in this ledger.")
    return JSONResponse(out, headers={
        "Content-Disposition": f'attachment; filename="kavach-dispute-{intent_id}.json"'})


# ------------------------------------------------------------------ adversary lab

@app.get("/api/scenarios")
def list_scenarios(_: Demo) -> dict[str, Any]:
    risk, ent = scenarios.models()
    return {"items": scenarios.catalogue(),
            "models": {"duplicate_risk": risk is not None, "entailment": ent is not None},
            "note": "each scenario runs against the real decision code in a fresh in-memory "
                    "database seeded at a fixed epoch; the operator ledger is untouched"}


@app.post("/api/scenarios/{scenario_id}/run")
def run_scenario(scenario_id: str, _: Demo) -> dict[str, Any]:
    try:
        return scenarios.run(scenario_id)
    except KeyError:
        raise _fail(404, "scenario_not_found", f"No scenario {scenario_id}.") from None


@app.get("/api/evaluations")
def evaluations(_: ReadOnly) -> dict[str, Any]:
    """The benchmark reports, as written by `make bench` / `make gate-bench`."""
    import json
    out: dict[str, Any] = {}
    for key, name in (("risk", "risk_report.json"), ("gate", "gate_report.json")):
        path = EVALS / name
        try:
            out[key] = json.loads(path.read_text()) if path.exists() else None
        except (OSError, json.JSONDecodeError):
            log.exception("could not read %s", name)
            out[key] = None
    return {**out, "note": "produced by the benchmarks in CI; not computed on request"}


# ------------------------------------------------------------------ the buyer journey

@app.get("/api/storefront")
def storefront_catalogue(_: Demo) -> dict[str, Any]:
    """The Bazaar's catalogue, Priya's default mandate, and the scenarios the agent can run."""
    return {**storefront.catalogue(), "mandate": storefront.default_mandate(int(time.time()))}


@app.post("/api/storefront/plan")
def storefront_plan(body: PlanRequest, _: Demo) -> dict[str, Any]:
    """The agent's cart for one mode, with the trace of how it got there. Decides nothing."""
    try:
        return storefront.plan(body.mandate.model_dump(), body.mode)
    except KeyError:
        raise _fail(404, "unknown_mode",
                    f"mode must be one of {', '.join(storefront.MODES)}") from None


def _stepup_fail(e: stepup.StepUpError) -> HTTPException:
    status = {"not_found": 404, "expired": 410, "already_resolved": 409,
              "invalid_action": 422, "not_step_up": 409,
              "re_admission_refused": 409}.get(e.code, 400)
    return _fail(status, e.code, e.message)


@app.post("/api/stepup")
def stepup_create(body: StepUpCreateRequest, conn: Conn, _: AgentKey) -> dict[str, Any]:
    """Ask the principal. The verdict is re-derived here, never taken from the client: only
    a cart the gate itself steps up can produce a token."""
    now = int(time.time())
    args = _envelope_args(body.mandate, body.envelope, conn)
    adm = gate_service.admit(
        conn, cart_id=body.cart_id, merchant_id=body.merchant_id,
        lines=[ln.model_dump() for ln in body.lines], now=now,
        untrusted_context=body.untrusted_context, model=_models.get("entailment"),
        charge=False, **args)
    cart = {"cart_id": body.cart_id, "merchant_id": body.merchant_id,
            "lines": [ln.model_dump() for ln in body.lines],
            "untrusted_context": body.untrusted_context}
    if body.envelope is not None:
        # The verified fields for the phone page, plus the exact signed bytes so approval
        # re-verifies what the principal signed rather than a re-serialisation.
        if adm.get("envelope_failures"):
            raise _fail(409, "not_step_up", "this envelope was refused: "
                        + ", ".join(adm["envelope_failures"]))
        mandate_body = {**json.loads(args["signed"][0].decode()),
                        "_signed": body.envelope.model_dump()}
    else:
        mandate_body = body.mandate.model_dump()
    try:
        out = stepup.create(conn, mandate_body=mandate_body, cart=cart,
                            admission_result=adm, now=now)
    except stepup.StepUpError as e:
        raise _stepup_fail(e) from None
    approve_path = f"/approve/?t={out['token']}"
    sent = None
    if body.notify is not None:
        sent = _notify(conn, out["token"], body.notify, approve_path, now)
    return {**out, "approve_path": approve_path, "admission": adm,
            "ttl_seconds": stepup.TTL, "notification": sent}


def _notify(conn: db.Connection, token: str, req: NotifyRequest, approve_path: str,
            now: int) -> dict[str, Any]:
    view = stepup.view(conn, token, now)
    try:
        return notify.dispatch(conn, token=token, channel=req.channel, to=req.to, view=view,
                               approve_path=approve_path, now=now,
                               open_conn=lambda: connect(DB_PATH, same_thread=False))
    except notify.NotifyError as e:
        status = {"public_url_unset": 503, "channel_unconfigured": 503}.get(e.code, 422)
        raise _fail(status, e.code, e.message) from None


@app.post("/api/stepup/{token}/notify")
def stepup_notify(token: str, body: NotifyRequest, conn: Conn, _: AgentKey) -> dict[str, Any]:
    """Send (or re-send) the approval link for a pending request over a channel."""
    now = int(time.time())
    try:
        view = stepup.view(conn, _token(token), now)
    except stepup.StepUpError as e:
        raise _stepup_fail(e) from None
    if view["status"] != stepup.PENDING:
        raise _fail(409, "already_resolved",
                    f"this request is {view['status'].lower()}; nothing to send")
    return _notify(conn, token, body, f"/approve/?t={token}", now)


@app.get("/api/stepup/{token}")
def stepup_view(token: str, conn: Conn) -> dict[str, Any]:
    try:
        view = stepup.view(conn, _token(token), int(time.time()))
    except stepup.StepUpError as e:
        raise _stepup_fail(e) from None
    return {**view, "notifications": notify.deliveries(conn, token)}


@app.post("/api/stepup/{token}/resolve")
def stepup_resolve(token: str, body: StepUpResolveRequest, conn: Conn) -> dict[str, Any]:
    try:
        return stepup.resolve(conn, _token(token), action=body.action, now=int(time.time()),
                              resolver=body.resolver, model=_models.get("entailment"))
    except stepup.StepUpError as e:
        raise _stepup_fail(e) from None


def _token(value: str) -> str:
    if not re.match(r"^[A-Za-z0-9_-]{16,64}$", value):
        raise _fail(404, "not_found", "this approval link is not one Kavach issued")
    return value


def _checkout_fail(e: checkout.CheckoutError) -> HTTPException:
    return _fail(e.status, e.code, e.message)


@app.post("/api/checkout")
def checkout_start(body: CheckoutStartRequest, conn: Conn, _: Demo) -> dict[str, Any]:
    """A real Razorpay TEST order -- for a cart the gate ADMITTED. The admission event is
    looked up in the log by cart id; a cart with no admission has no checkout."""
    admission = checkout.admitted(conn, body.cart_id)
    if admission is None:
        raise _fail(409, "not_admitted",
                    "this cart was not admitted against a mandate, so there is nothing to "
                    "pay for; run admission first")
    try:
        return checkout.start(conn, admission=admission, mandate_id=body.mandate_id,
                              now=int(time.time()))
    except checkout.CheckoutError as e:
        raise _checkout_fail(e) from None


@app.get("/api/checkout/latest")
def checkout_latest(conn: Conn, _: Demo) -> dict[str, Any]:
    """The most recent real payment, for the MCP console to refund. May be null."""
    return {"payment": checkout.latest_real_payment(conn)}


@app.post("/api/checkout/{order_id}/link")
def checkout_link(order_id: str, conn: Conn) -> dict[str, Any]:
    try:
        return checkout.link(conn, order_id=_order(order_id), now=int(time.time()))
    except checkout.CheckoutError as e:
        raise _checkout_fail(e) from None


@app.post("/api/checkout/confirm")
def checkout_confirm(body: CheckoutConfirmRequest, conn: Conn) -> dict[str, Any]:
    try:
        return checkout.confirm(conn, order_id=body.order_id, payment_id=body.payment_id,
                                signature=body.signature, now=int(time.time()))
    except checkout.CheckoutError as e:
        raise _checkout_fail(e) from None


@app.get("/api/checkout/{order_id}")
def checkout_status(order_id: str, conn: Conn) -> dict[str, Any]:
    try:
        return checkout.status(conn, order_id=_order(order_id), now=int(time.time()))
    except checkout.CheckoutError as e:
        raise _checkout_fail(e) from None


def _order(value: str) -> str:
    if not re.match(r"^order_[A-Za-z0-9]{1,40}$", value):
        raise _fail(404, "order_not_found", "no checkout for that order id")
    return value


@app.post("/api/webhooks/razorpay")
async def razorpay_webhook(request: Request) -> JSONResponse:
    """Signed webhooks become DERIVED_CERTAIN evidence. Same verifier as apps/webhook_server;
    fail-closed on a missing secret."""
    raw = await request.body()
    secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
    with _open() as conn:
        code, message = webhook.process(
            conn, raw, request.headers.get("X-Razorpay-Signature"), secret,
            event_id=request.headers.get("X-Razorpay-Event-Id"))
    return JSONResponse(status_code=code, content={"status": message})


@app.get("/api/webhooks/rejections")
def webhook_rejections(conn: Conn, _: Operator,
                       limit: int = Query(50, ge=1, le=200)) -> dict[str, Any]:
    """Deliveries the receiver refused, newest first: a misconfigured secret, a sender that
    is not Razorpay, a malformed body. Bodies are not kept, only their hash."""
    return {"items": webhook.rejections(conn, limit),
            "configured": bool(os.environ.get("RAZORPAY_WEBHOOK_SECRET"))}


@app.get("/api/duel")
def duel_run(_: Demo) -> dict[str, Any]:
    """Without Kavach vs with Kavach on one attack sequence. Derived, sandboxed, repeatable."""
    return duel.run()


@app.post("/api/proof/tamper")
def proof_tamper(body: TamperRequest, conn: Conn, _: Demo) -> dict[str, Any]:
    """Edit a COPY of the log and verify it. The live ledger is never written."""
    try:
        return tamper.demo(conn, seq=body.seq)
    except tamper.TamperError as e:
        raise _fail(404 if e.code == "no_such_event" else 409, e.code, e.message) from None


# ------------------------------------------------------------------ MCP over HTTP

def _mcp():
    """The MCP module, imported on first use: it opens its own connection and a Razorpay
    client, and in live mode without credentials that is a refusal, reported as a 503."""
    try:
        from kavach.mcp import server as mcp_server
    except RuntimeError as e:
        raise _fail(503, "mcp_unavailable", str(e)) from None
    return mcp_server


@app.get("/api/mcp/tools")
def mcp_tools(conn: Conn, _: Demo) -> dict[str, Any]:
    m = _mcp()
    return {
        "tools": m.catalogue(), "status": m.status(),
        "suggested_target": checkout.latest_real_payment(conn),
        "duplicate_target": intents.duplicate_candidate(conn),
        "seeded_targets": [r["entity_id"] for r in conn.execute(
            "SELECT entity_id, MAX(seq) AS last FROM events WHERE entity_type='payment' "
            "AND source='seed' GROUP BY entity_id ORDER BY last DESC LIMIT 6")],
        "config": {"mcpServers": {"kavach": {"command": "kavach-mcp-server",
                                             "args": ["--toolsets", "payments,refunds"]}}},
        "parity": {"toolsets": list(m.TOOLSETS),
                   "flags": ["--toolsets", "--read-only"],
                   "note": "same flags and semantics as razorpay-mcp-server; read-only also "
                           "compiles a policy the governor refuses writes under"},
    }


@app.post("/api/mcp/{tool}")
def mcp_call(tool: str, body: McpCallRequest, _: Demo) -> dict[str, Any]:
    """Call a tool exactly as an MCP client would. The function object is the one the stdio
    server registered; there is no HTTP re-implementation."""
    if not re.match(r"^[a-z_]{1,64}$", tool):
        raise _fail(404, "unknown_tool", "no such tool")
    m = _mcp()
    started = time.perf_counter()
    try:
        result = m.dispatch(tool, body.args)
    except KeyError:
        raise _fail(404, "unknown_tool",
                    f"no enabled tool named {tool}; see /api/mcp/tools") from None
    except TypeError as e:
        raise _fail(422, "invalid_arguments", f"{tool}: {e}") from None
    except (MoneyError, ValueError) as e:
        raise _fail(422, "invalid_arguments", f"{tool}: {e}") from None
    except RazorpayError as e:
        detail = f": {e.description}" if e.description else ""
        hint = ("" if e.status != 400 or "refund" not in e.path else
                " A test-mode account refunds out of its own balance, so a refund larger "
                "than that balance is refused here with no specific reason.")
        raise _fail(502, "provider_error",
                    f"Razorpay answered {e.status} on {e.path}{detail}. Kavach's decision "
                    f"was recorded and the intent settled by the failure classifier; no "
                    f"money moved.{hint}") from None
    except CassetteMismatch:
        raise _fail(503, "replay_no_recording",
                    "replay mode has no recorded provider response for this call; the "
                    "decision was recorded, the provider was not reached") from None
    return {"tool": tool, "args": body.args, "result": result,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
            "write": tool in m.WRITE_TOOLS, "toolset": m.TOOLSET_OF.get(tool)}


# ------------------------------------------------------------------ access

class KeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9 ._-]+$")
    scope: Literal["readonly", "agent", "operator"]


@app.get("/api/keys")
def keys_list(conn: Conn, _: Operator) -> dict[str, Any]:
    return {"items": auth.listing(conn), "scopes": list(auth.SCOPES), "mode": auth.mode()}


@app.post("/api/keys", status_code=201)
def keys_create(body: KeyCreateRequest, conn: Conn, _: Operator) -> dict[str, Any]:
    """Mint a key. The plaintext is in this response and nowhere else."""
    return {**auth.create(conn, name=body.name, scope=body.scope, now=int(time.time())),
            "note": "store the key now; it is not shown again"}


@app.delete("/api/keys/{key_id}")
def keys_revoke(key_id: str, conn: Conn, _: Operator) -> dict[str, Any]:
    if not re.match(r"^key_[a-f0-9]{12}$", key_id):
        raise _fail(404, "key_not_found", "no such key")
    if not auth.revoke(conn, key_id, now=int(time.time())):
        raise _fail(404, "key_not_found", "no such active key")
    return {"revoked": True, "key_id": key_id}


@app.get("/api/issuers")
def issuers_list(conn: Conn, _: Operator) -> dict[str, Any]:
    """The principal keys this deployment trusts to sign mandates."""
    return {"items": [{"key_id": i["key_id"],
                       "public_key_b64": base64.b64encode(i["public_key"]).decode(),
                       "simulated": i["key_id"] == gate_service.DEMO_KEY_ID}
                      for i in envelope.list_issuers(conn)]}


@app.post("/api/issuers", status_code=201)
def issuers_add(body: IssuerRequest, conn: Conn, _: Operator) -> dict[str, Any]:
    try:
        pub = body.public_key()
    except ValueError as e:
        raise _fail(422, "invalid_request", str(e)) from None
    if body.key_id == gate_service.DEMO_KEY_ID:
        raise _fail(409, "reserved_key_id", "that key id is reserved for the demo principal")
    envelope.register_issuer(conn, body.key_id, pub)
    return {"key_id": body.key_id, "public_key_b64": body.public_key_b64, "registered": True}


@app.delete("/api/issuers/{key_id}")
def issuers_remove(key_id: str, conn: Conn, _: Operator) -> dict[str, Any]:
    if not re.match(r"^[A-Za-z0-9._:-]{1,128}$", key_id):
        raise _fail(404, "issuer_not_found", "no such issuer")
    if not envelope.remove_issuer(conn, key_id):
        raise _fail(404, "issuer_not_found", "no such issuer")
    return {"key_id": key_id, "removed": True}


# ------------------------------------------------------------------ demo and metrics

@app.post("/api/demo/reset")
def demo_reset(conn: Conn, _: Demo) -> dict[str, Any]:
    """Re-seed the ledger deterministically. Destructive, so it exists only under
    KAVACH_DEMO=1 -- `make run` and compose set it; the image default does not."""
    counts = demo.seed_conn(conn, reset=True)
    return {"reset": True, "counts": counts, "at": int(time.time())}


@app.get("/api/metrics")
def metrics(conn: Conn, request: Request, key: str | None = Query(None, max_length=256)
            ) -> PlainTextResponse:
    """A small Prometheus text surface. Counts, not internals.

    Public unless KAVACH_METRICS_KEY is set, in which case the scraper presents it as a
    bearer token or `?key=`. A scrape key is not an API key: it opens nothing else."""
    want = os.environ.get("KAVACH_METRICS_KEY", "")
    if want:
        m = _BEARER.match(request.headers.get("authorization", ""))
        got = (m.group(1) if m else None) or key or ""
        if not secrets.compare_digest(got, want):
            raise _fail(401, "metrics_key_required",
                        "this metrics endpoint is locked with KAVACH_METRICS_KEY")
    status = proof.status(conn)
    observability.events_total.set(status["events"])
    observability.chain_intact.set(int(status["ok"]))
    for r in conn.execute("SELECT status, COUNT(*) c FROM intents GROUP BY status"):
        observability.intents_by_status.labels(status=r["status"]).set(r["c"])
    pend = conn.execute("SELECT COUNT(*) FROM stepups WHERE status='PENDING'").fetchone()[0]
    observability.stepups_pending.set(pend)
    observability.uptime.set(int(time.time() - STARTED_AT))
    body, content_type = observability.exposition()
    return PlainTextResponse(body, media_type=content_type)


# ------------------------------------------------------------------ static UI

class _Ui(StaticFiles):
    """Static files, with the app's own 404 page for a miss.

    Starlette answers an unknown path with `text/plain: Not Found`. That is correct and
    useless: a mistyped console URL would drop the operator out of the product entirely.
    Serving the exported 404 keeps them inside it, with links back.
    """

    async def get_response(self, path: str, scope):  # type: ignore[override]
        response = await super().get_response(path, scope)
        if response.status_code == 404:
            page = STATIC_DIR / "404" / "index.html"
            if page.is_file():
                return FileResponse(page, status_code=404)
        return response


def _mount_ui() -> None:
    if not STATIC_DIR.exists():
        log.warning("no built UI at %s; serving the API only "
                    "(run `npm run build` in web/)", STATIC_DIR)
        return
    # html=True resolves a directory to its index.html, which is what the export writes
    # for every route (trailingSlash). Mounted last so nothing here can shadow /api.
    app.mount("/", _Ui(directory=str(STATIC_DIR), html=True), name="ui")
    log.info("serving the built UI from %s", STATIC_DIR)


_reconciler: dict[str, Any] | None = None
_observability: dict[str, Any] = {"log_format": "text", "sentry": False, "otel": False}


def _start_background() -> None:
    """Optional hooks and the reconciler thread. Idempotent: once per process."""
    global _reconciler
    _observability["log_format"] = observability.configure_logging()
    _observability["sentry"] = observability.init_sentry()
    _observability["otel"] = observability.init_otel(app)
    live = os.environ.get("KAVACH_MODE", "replay") == "live"
    raw = os.environ.get("KAVACH_RECONCILE_INTERVAL", "").strip()
    interval = int(raw) if raw.isdigit() else (60 if live else 0)
    if interval > 0 and _reconciler is None:
        _reconciler = reconciliation.start_background(
            lambda: connect(DB_PATH, same_thread=False), interval=interval)
        log.info("reconciler: every %ds", interval)


def main() -> None:
    parser = argparse.ArgumentParser(description="Kavach API server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--workers", type=int,
                        default=int(os.environ.get("KAVACH_WORKERS", "1") or 1),
                        help="uvicorn worker processes (KAVACH_WORKERS); safe because every "
                             "request opens its own connection")
    args = parser.parse_args()

    _load_models()
    _mount_ui()
    _start_background()
    log.info("Kavach %s on http://%s:%d  (mode=%s, db=%s)", __version__, args.host,
             args.port, os.environ.get("KAVACH_MODE", "replay"), DB_PATH)
    if args.workers > 1:
        # Multiple workers need an import string, not an object: each worker re-imports.
        # `python apps/api_server.py` puts apps/ on sys.path, not the repo root, so add it.
        sys.path.insert(0, str(ROOT))
        uvicorn.run("apps.api_server:app", host=args.host, port=args.port,
                    workers=args.workers, log_level="info")
    else:
        uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
else:  # imported by tests or an ASGI runner
    _load_models()
    _mount_ui()
    _start_background()
