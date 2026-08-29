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
import logging
import os
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Annotated, Any, Literal

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from kavach import __version__, governor, ledger, proof
from kavach.eventlog import connect
from kavach.gate import envelope
from kavach.intelligence import entailment
from kavach.intelligence import model as risk_model
from kavach.money import MAX_MINOR_UNITS
from kavach.services import (
    dashboard,
    decisions,
    dispute,
    financials,
    intents,
    review,
    scenarios,
)
from kavach.services import gate as gate_service
from pydantic import BaseModel, Field, field_validator

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
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000",
                   "http://localhost:4173", "http://127.0.0.1:4173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


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


def policy() -> governor.Policy:
    m = _models.get("risk")
    return governor.Policy(risk_threshold=m.threshold) if m else governor.Policy()


@contextmanager
def _open() -> Iterator[sqlite3.Connection]:
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
        yield conn
    finally:
        conn.close()


def db() -> Iterator[sqlite3.Connection]:
    with _open() as conn:
        yield conn


Conn = Annotated[sqlite3.Connection, Depends(db)]


def _fail(status: int, code: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code=status,
                         detail={"code": code, "message": message, **extra})


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


class AdmitRequest(BaseModel):
    mandate: MandateRequest
    cart_id: str = Field(min_length=1, max_length=128)
    merchant_id: str = Field(min_length=1, max_length=128)
    lines: list[CartLineRequest] = Field(max_length=100)
    untrusted_context: str = Field(default="", max_length=8_000)
    #: false runs the ladder without claiming the nonce or charging the cumulative cap, so
    #: the same mandate can be explored repeatedly. Admission itself is unchanged.
    commit: bool = False


class ReviewRequest(BaseModel):
    action: Literal["approve", "reject"]
    reviewer: str = Field(default="operator", min_length=1, max_length=128)
    note: str = Field(default="", max_length=2_000)


# ------------------------------------------------------------------ system

@app.get("/api/health")
def health(conn: Conn) -> dict[str, Any]:
    """What this environment actually is. The UI's mode banner reads this, not a constant."""
    status = proof.scan(conn)
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
                      "broken_at": status["broken_at"]},
        "policy": {"max_auto_refund_minor": policy().max_auto_refund_minor,
                   "session_cap_minor": policy().session_cap_minor,
                   "daily_cap_minor": policy().daily_cap_minor,
                   "risk_threshold": policy().risk_threshold},
        "ui": STATIC_DIR.exists(),
    }


@app.get("/api/policy")
def get_policy() -> dict[str, Any]:
    p = policy()
    m = _models.get("risk")
    return {
        "limits": {
            "max_auto_refund_minor": p.max_auto_refund_minor,
            "session_cap_minor": p.session_cap_minor,
            "daily_cap_minor": p.daily_cap_minor,
            "risk_threshold": p.risk_threshold,
            "allow_write": p.allow_write,
        },
        "threshold_source": ("the estimator's frozen training threshold"
                             if m else "governor.Policy default; no model is loaded"),
        "authority_order": [
            {"rank": 1, "layer": "Accounting invariants", "kind": "deterministic",
             "outcome": "DENY", "note": "cannot be overridden by a model or a human here"},
            {"rank": 2, "layer": "Permission tier", "kind": "deterministic",
             "outcome": "DENY", "note": "read-only agents cannot move money"},
            {"rank": 3, "layer": "Truth-plane confidence", "kind": "deterministic",
             "outcome": "ESCALATE",
             "note": "an obligation in an AMBIGUOUS state raises the floor to a human"},
            {"rank": 4, "layer": "Duplicate-risk model", "kind": "learned, advisory",
             "outcome": "ESCALATE",
             "note": "may only widen caution; a low score never authorises anything"},
            {"rank": 5, "layer": "Exposure caps", "kind": "deterministic",
             "outcome": "ESCALATE", "note": "per-refund, per-session and daily"},
        ],
        "mutable": False,
        "mutability_note": "policy is compiled into governor.Policy. There is no API that "
                           "edits it, because a limit an operator can raise from the "
                           "screen it is failing on is not a limit.",
    }


@app.get("/api/overview")
def overview(conn: Conn) -> dict[str, Any]:
    return dashboard.overview(conn)


@app.get("/api/stream")
def stream(conn: Conn, limit: int = Query(40, ge=1, le=200),
           before: int | None = Query(None, ge=0)) -> dict[str, Any]:
    return dashboard.stream(conn, limit=limit, before=before)


# ------------------------------------------------------------------ intents

@app.get("/api/intents")
def list_intents(conn: Conn, status: str | None = Query(None, max_length=32),
                 agent_id: str | None = Query(None, max_length=128),
                 target_id: str | None = Query(None, max_length=128),
                 limit: int = Query(50, ge=1, le=200),
                 offset: int = Query(0, ge=0)) -> dict[str, Any]:
    return intents.listing(conn, status=status, agent_id=agent_id, target_id=target_id,
                           limit=limit, offset=offset)


@app.get("/api/intents/{intent_id}")
def intent_detail(intent_id: str, conn: Conn) -> dict[str, Any]:
    out = intents.detail(conn, intent_id)
    if out is None:
        raise _fail(404, "intent_not_found", f"No intent {intent_id} exists in this ledger.")
    return out


@app.post("/api/governor/evaluate")
def evaluate(body: EvaluateRequest, conn: Conn) -> dict[str, Any]:
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
        decision, truth = decisions.evaluate(conn, intent, now=now, policy=policy(),
                                             model=model)
        return {"committed": False, "intent_id": None, "decision": decision.to_dict(),
                "truth": truth,
                "note": "dry run: no intent was recorded and no money moved"}

    out = decisions.evaluate_and_record(conn, intent, now=now, policy=policy(), model=model)
    return {"committed": True, **out,
            "note": "the intent and its decision are recorded; the provider was not called"}


@app.get("/api/review")
def review_queue(conn: Conn) -> dict[str, Any]:
    return intents.review_queue(conn)


@app.post("/api/review/{intent_id}")
def review_act(intent_id: str, body: ReviewRequest, conn: Conn) -> dict[str, Any]:
    try:
        return review.act(conn, intent_id, action=body.action, reviewer=body.reviewer,
                          note=body.note)
    except review.ReviewError as e:
        status = {"not_found": 404, "not_pending": 409, "not_reviewable": 409}.get(
            e.code, 400)
        raise _fail(status, e.code, e.message) from None


@app.get("/api/reconciliation")
def reconciliation(conn: Conn) -> dict[str, Any]:
    return intents.unresolved(conn)


# ------------------------------------------------------------------ money

@app.get("/api/entities/{entity_type}")
def list_entities(entity_type: str, conn: Conn, limit: int = Query(50, ge=1, le=200),
                  offset: int = Query(0, ge=0)) -> dict[str, Any]:
    return financials.listing(conn, _entity_type(entity_type), limit=limit, offset=offset)


@app.get("/api/entities/{entity_type}/{entity_id}")
def entity_detail(entity_type: str, entity_id: str, conn: Conn) -> dict[str, Any]:
    out = financials.detail(conn, _entity_type(entity_type), entity_id)
    if out is None:
        raise _fail(404, "entity_not_found",
                    f"Kavach holds no events for {entity_type} {entity_id}.")
    return out


@app.get("/api/truth/{entity_type}/{entity_id}")
def truth_trace(entity_type: str, entity_id: str, conn: Conn) -> dict[str, Any]:
    out = financials.truth_trace(conn, _entity_type(entity_type), entity_id)
    if out is None:
        raise _fail(404, "entity_not_found",
                    f"Kavach holds no events for {entity_type} {entity_id}, so there is "
                    f"no derivation to show.")
    return out


@app.get("/api/obligations")
def obligations(conn: Conn) -> dict[str, Any]:
    return financials.obligations(conn)


# ------------------------------------------------------------------ agents and gate

@app.get("/api/agents")
def list_agents(conn: Conn) -> dict[str, Any]:
    return {"items": intents.agents(conn)}


@app.get("/api/agents/{agent_id}")
def agent_detail(agent_id: str, conn: Conn) -> dict[str, Any]:
    out = intents.agent_detail(conn, agent_id)
    if out is None:
        raise _fail(404, "agent_not_found", f"No agent {agent_id} has acted here.")
    return out


@app.post("/api/gate/inspect")
def gate_inspect(body: MandateRequest, conn: Conn) -> dict[str, Any]:
    """Verify a mandate without spending it. Carries no replay protection by design."""
    gate_service.register_demo_issuer(conn)
    return gate_service.inspect(conn, envelope_body=body.model_dump(), now=int(time.time()),
                                expected_principal=body.principal_id)


@app.post("/api/gate/admit")
def gate_admit(body: AdmitRequest, conn: Conn) -> dict[str, Any]:
    gate_service.register_demo_issuer(conn)
    return gate_service.admit(
        conn, envelope_body=body.mandate.model_dump(), cart_id=body.cart_id,
        merchant_id=body.merchant_id,
        lines=[line.model_dump() for line in body.lines],
        now=int(time.time()), expected_principal=body.mandate.principal_id,
        untrusted_context=body.untrusted_context,
        model=_models.get("entailment"), charge=body.commit)


# ------------------------------------------------------------------ proof

@app.get("/api/proof/chain")
def proof_chain(conn: Conn, limit: int = Query(50, ge=1, le=200),
                before: int | None = Query(None, ge=1)) -> dict[str, Any]:
    return proof.chain(conn, limit=limit, before=before)


@app.get("/api/proof/verify")
def proof_verify(conn: Conn) -> dict[str, Any]:
    status = proof.scan(conn)
    return {**status, "claims": proof.claims(), "verified_at": int(time.time())}


@app.get("/api/dispute/{intent_id}")
def dispute_pack(intent_id: str, conn: Conn) -> JSONResponse:
    out = dispute.pack(conn, intent_id)
    if out is None:
        raise _fail(404, "intent_not_found", f"No intent {intent_id} exists in this ledger.")
    return JSONResponse(out, headers={
        "Content-Disposition": f'attachment; filename="kavach-dispute-{intent_id}.json"'})


# ------------------------------------------------------------------ adversary lab

@app.get("/api/scenarios")
def list_scenarios() -> dict[str, Any]:
    risk, ent = scenarios.models()
    return {"items": scenarios.catalogue(),
            "models": {"duplicate_risk": risk is not None, "entailment": ent is not None},
            "note": "each scenario runs against the real decision code in a fresh in-memory "
                    "database seeded at a fixed epoch; the operator ledger is untouched"}


@app.post("/api/scenarios/{scenario_id}/run")
def run_scenario(scenario_id: str) -> dict[str, Any]:
    try:
        return scenarios.run(scenario_id)
    except KeyError:
        raise _fail(404, "scenario_not_found", f"No scenario {scenario_id}.") from None


@app.get("/api/evaluations")
def evaluations() -> dict[str, Any]:
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


def main() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="Kavach API server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    _load_models()
    _mount_ui()
    log.info("Kavach %s on http://%s:%d  (mode=%s, db=%s)", __version__, args.host,
             args.port, os.environ.get("KAVACH_MODE", "replay"), DB_PATH)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
else:  # imported by tests or an ASGI runner
    _load_models()
    _mount_ui()
