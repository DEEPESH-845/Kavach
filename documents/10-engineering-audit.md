# Kavach Engineering Audit

## A. Complete Repository Architecture Map
- **apps/**: Entrypoints (`mcp_server.py`, `benchmark.py`, `gate_benchmark.py`).
- **pkg/kavach/**: Core domain logic.
  - **eventlog.py**: Append-only log with idempotent ingestion.
  - **truth.py**: Deterministic state machine (Rail State vs Obligation State).
  - **ledger.py**: Open-object ledger, intent write-ahead log.
  - **governor.py**: Authority ladder, enforces caps/invariants.
  - **gate/**: Inbound agent admission (envelope, mandate, admission).
  - **intelligence/**: Duplicate-risk model, entailment model, feature extraction.
  - **razorpay/**: Provider adapter (live/replay client).
  - **mcp/**: MCP server implementation.
  - **proof.py**: Hash-chain verification, with its limits stated in `claims()`.
  - **services/**: the one decision path shared by MCP, HTTP and the demo seed.
- **apps/api_server.py**: the HTTP boundary; also mounts the built UI.
- **web/**: landing page + operator console (Next.js static export, client-rendered).

## B. Runtime/Data-Flow Map
1. **Agent MCP Call** -> `mcp/server.py`
2. **Intent Creation** -> `governor.new_intent`
3. **Truth Derivation** -> `ledger.fact_for` (reads `eventlog.py`)
4. **Risk Evaluation** -> `intelligence.model.score`
5. **Decisioning** -> `governor.decide` (checks invariants, tiers, truth, risk, caps)
6. **Execution** -> `governor.execute` (writes to `ledger`, calls Razorpay)
7. **Webhook Ingestion (Planned)** -> Writes to `eventlog.py`
8. **Reconciliation (Planned)** -> Updates `eventlog.py` -> `ledger.py`

## C. Dependency Graph
- `mcp.server` -> `governor`, `ledger`, `gate.admission`, `razorpay.client`, `truth`
- `governor` -> `ledger`, `truth`, `razorpay.client`
- `ledger` -> `eventlog`, `truth`
- `truth` -> `eventlog`
- `gate.admission` -> `gate.mandate`, `gate.envelope`, `intelligence.model`
- `intelligence.model` -> `intelligence.features`

## D. Security Boundary Map
- **Inbound Webhooks**: HMAC-SHA256 signature verification over raw bytes (Implemented in client, but webhook endpoint is missing).
- **Outbound Razorpay API**: Basic Auth from ENV (Implemented).
- **Agent -> MCP**: All destructive calls gated by `governor.decide` (Implemented).
- **Model -> Decision**: Advisory only; model cannot override invariants (Implemented).

## E. Financial State-Machine Map
- **Rail State**: INITIATED, ACCEPTED, PROCESSING, CONFIRMED, SETTLED, FAILED_TERMINAL, REVERSED, AMBIGUOUS.
- **Obligation State**: OPEN or CLOSED.
- Implemented in `pkg/kavach/truth.py`.

## F. Agent -> Kavach -> Razorpay Execution Flow
`Agent -> mcp.create_refund -> governor.decide -> ledger.record (PROPOSED) -> razorpay.client.create_refund -> ledger.settle (EXECUTED)`

## G. Inbound Mandate -> Cart -> Semantic Gate Flow
`Agent -> mcp.admit_cart -> gate.admission.admit -> gate.envelope.verify -> gate.mandate.admissible -> intelligence.model.score -> gate.admission.expected_losses -> gate.mandate.record_admission`

## H. Frontend -> Backend Integration Map
`browser -> apps/api_server.py -> kavach.services.* -> truth/ledger/governor/gate/proof`.

The console is a static export that fetches at runtime; the API mounts `web/out` at `/`, so
one process serves both and there is no CORS in the demo path. No dashboard screen reads
mock data, and none substitutes a value when the API is unreachable.

## I. ML Training -> Inference -> Governance Flow
`make bench` -> `intelligence/evaluate.py` trains `model.pkl` -> `mcp/server.py` loads `model.pkl` -> `governor.decide` consumes score -> Output bounded by `policy.risk_threshold`.

## J. Current Test Coverage Map
Test coverage is mostly present for core deterministic components (`truth`, `ledger`, `governor`, `mandate`, `envelope`). Concurrency testing, failure injection, and property-based testing are missing. 

## K. Current Benchmark/Evaluation Map
- Rail duplicate risk evaluated in `tests/test_model.py` / `benchmark.py`.
- Gate evaluated in `gate_benchmark.py`.
- Benchmark generates baseline comparisons safely.

## Subsystem Implementation Status
| Subsystem | Status |
|-----------|--------|
| Truth Engine | IMPLEMENTED |
| Event Log | IMPLEMENTED (hash-chained) |
| Obligation Ledger | IMPLEMENTED |
| Risk Model | IMPLEMENTED |
| Governor | IMPLEMENTED |
| Razorpay Client | IMPLEMENTED (live \| replay) |
| Webhook Ingestion | IMPLEMENTED (HMAC, idempotent) |
| Reconciliation | IMPLEMENTED |
| Inbound Gate | IMPLEMENTED |
| MCP | IMPLEMENTED |
| Proof / Hash Chain | IMPLEMENTED, with limits stated in `proof.claims()` |
| HTTP API | IMPLEMENTED |
| Operator Console | IMPLEMENTED (17 routes, live data) |
| Adversary Lab | IMPLEMENTED (11 scenarios, asserted in CI) |
| Dispute Pack | IMPLEMENTED (JSON export) |

---

## Findings, and where each one stands

The list below was written before most of the system existed and is kept as the record of
what was asked for. Every item now has a resolution and the test that holds it.

| # | Finding | Status | Where |
|---|---|---|---|
| P0-1 | Float arithmetic on the money path | **Resolved** | `money.parse_inr` (Decimal, exact paise, overflow cap); every HTTP amount is `*_minor: int`. `tests/test_money.py` |
| P0-2 | `INSERT OR REPLACE` on the intent ledger | **Resolved** | `ledger.record` is a plain INSERT; a duplicate id raises. `tests/test_ledger.py` |
| P0-3 | A rejected mandate consumed its nonce | **Resolved** | `envelope.verify` claims the nonce only after every other check passes; inspection never claims and now reports a spent one. `tests/test_envelope.py` |
| P0-4 | Read-then-write races between agents | **Resolved** | Every writer runs under `db.Connection.transaction()` (`BEGIN IMMEDIATE` / Postgres advisory lock); `evaluate_and_record` and the MCP `create_refund` hold it from the first read; `ledger.exposure` counts APPROVED reservations. `tests/test_concurrency.py`, `tests/test_ledger.py` |
| P0-5 | No hash chain | **Resolved** | `eventlog.append` chains SHA-256 over the row and its predecessor; `proof.scan` recomputes; `proof.status` verifies incrementally for health. `tests/test_proof.py`, `tests/test_tamper.py` |
| P1-1 | No webhook receiver | **Resolved** | `POST /api/webhooks/razorpay` and `apps/webhook_server.py` share `webhook.process`: HMAC fail-closed, idempotent on event id, refusals recorded. `tests/test_webhook.py` |
| P1-2 | No reconciler | **Resolved** | `reconciliation.reconcile_pending_intents` settles APPROVED intents against the provider and executes the ones it never received, under the intent's idempotency key; runs as a thread in the API or `python -m kavach reconcile`. `tests/test_reconciliation.py` |
| P2-1 | UI on mock data | **Resolved** | The console reads the API on every screen and renders an error state when it cannot. `tests/test_console_css.py`, browser sweep |
| P2-2 | Database path hard-coded | **Resolved** | `KAVACH_DB`: a SQLite path or a `postgresql://` URL. `tests/test_db.py` |
| P2-3 | No application lifecycle | **Resolved** | Per-request connections, `--workers`, background reconciler, health that reports what is running. |

### Since the audit

- **Authentication**: scoped API keys (`auth.py`), demo surfaces gated by `KAVACH_DEMO`.
- **Real mandate issuance**: principals sign, `/api/issuers` trusts keys, the demo key is
  never registered outside a demo.
- **Policy file**: `KAVACH_POLICY` (`config.py`), validated, hot-reloaded, no write API.
- **Step-up channels**: email, SMS, WhatsApp, webhook (`services/notify.py`).
- **Observability**: JSON logs with request ids, Prometheus metrics, optional Sentry/OTel,
  webhook rejection log, backup command.
