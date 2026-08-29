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

## Critical Issues (P0)

### P0-1: Floating-point arithmetic in the money path
- **Severity**: P0
- **File**: `pkg/kavach/mcp/server.py` (functions `check_refund`, `create_refund`, `admit_cart`), `pkg/kavach/gate/admission.py` (function `expected_losses`).
- **Current Behavior**: Inputs are taken as `float` and cast via `int(round(amount * 100))`. `expected_losses` computes `risk * cart_total_minor * fraud_loss_share` as a float.
- **Expected Behavior**: Money must be handled as exact integer minor units throughout. MCP tools must accept floats only if safely parsed (preferably string/decimal), and `expected_losses` should round safely to int.
- **Why it matters**: IEEE 754 floats lose precision. A refund of 100.50 might become 10049.
- **Security/Financial Impact**: Direct financial loss or over-refunding.
- **Recommended Fix**: Implement a centralized `Money` parser that takes string/float and securely converts to integer minor units. Use integer arithmetic.
- **Regression test required**: Yes.
- **Implementation Status**: Needs fix.

### P0-2: Mutable Intent Ledger (INSERT OR REPLACE)
- **Severity**: P0
- **File**: `pkg/kavach/ledger.py`
- **Function**: `record()`
- **Current Behavior**: Uses `INSERT OR REPLACE INTO intents` which silently overwrites an existing intent if the ID conflicts, mutating history.
- **Expected Behavior**: Financial history must be append-only. Use `INSERT OR ABORT`/`IGNORE` and reject conflicting intents.
- **Why it matters**: Violates the immutable financial intent ledger requirement.
- **Security/Financial Impact**: Audit trails can be rewritten, obscuring agent actions.
- **Recommended Fix**: Change to `INSERT INTO` and catch `IntegrityError`, or use `INSERT OR IGNORE` and verify rowcount. 
- **Regression test required**: Yes.
- **Implementation Status**: Needs fix.

### P0-3: Rejected mandate consumes nonce
- **Severity**: P0
- **File**: `pkg/kavach/gate/admission.py`, `pkg/kavach/gate/envelope.py`
- **Function**: `decide()`, `verify()`
- **Current Behavior**: `verify()` defaults to `claim_nonce=True`. `decide()` calls `verify()` without kwargs, consuming the nonce *before* checking cap and scope. If cap fails, the cart is rejected but the mandate's nonce is already burned.
- **Expected Behavior**: The nonce must only be consumed atomically upon successful admission (ALLOW).
- **Why it matters**: Breaks replay protection mechanics and turns deterministic failures into a DoS on the mandate.
- **Security/Financial Impact**: A legitimate mandate can be bricked by a bad cart request.
- **Recommended Fix**: Pass `claim_nonce=False` in `decide()`. Consume the nonce in `admit()` or `record_admission()` only when the verdict is ALLOW.
- **Regression test required**: Yes.
- **Implementation Status**: Needs fix.

### P0-4: Concurrency Race Conditions
- **Severity**: P0
- **File**: `pkg/kavach/governor.py`, `pkg/kavach/ledger.py`
- **Function**: `execute()`, `decide()`
- **Current Behavior**: State is read in `decide()`, then written in `execute()`. Multiple concurrent agents can interleave reads and writes, allowing duplicate refunds to both pass caps and risk.
- **Expected Behavior**: SQLite transaction `BEGIN EXCLUSIVE` should be used to reserve the execution slot safely.
- **Why it matters**: Concurrent agents can bypass duplicate protection.
- **Security/Financial Impact**: Duplicate refunds execute successfully.
- **Recommended Fix**: Introduce transactional locking abstraction in `ledger.py`.
- **Regression test required**: Yes.
- **Implementation Status**: Needs fix.

### P0-5: Cryptographic Audit Chain Missing
- **Severity**: P0
- **File**: `pkg/kavach/eventlog.py`
- **Current Behavior**: Append-only log exists, but no cryptographically linked hashing (`event_hash`, `previous_event_hash`) is implemented.
- **Expected Behavior**: Each event must hash itself and the previous event's hash.
- **Why it matters**: The audit trail is not tamper-evident.
- **Security/Financial Impact**: An attacker with DB access can rewrite financial truth without detection.
- **Recommended Fix**: Add `previous_event_hash` and `event_hash` to the `events` table and compute them deterministically on `append()`.
- **Regression test required**: Yes.
- **Implementation Status**: PLANNED / MISSING.

## High Priority Issues (P1)

### P1-1: Webhook Ingestion & Deduplication
- **Severity**: P1
- **File**: `apps/`
- **Current Behavior**: Webhooks are not actively ingested by any web server/HTTP handler.
- **Expected Behavior**: A secure webhook receiver (`POST /webhooks/razorpay`) must verify HMAC signatures and deduplicate events into the event log.
- **Recommended Fix**: Create `pkg/kavach/webhooks/server.py` or similar HTTP endpoint.

### P1-2: Reconciliation Engine Missing
- **Severity**: P1
- **File**: `pkg/kavach/reconciliation/`
- **Current Behavior**: `UNKNOWN_OUTCOME` is conceptually supported, but no background worker exists to poll Razorpay and resolve stuck intents.
- **Expected Behavior**: Background polling of intents in `APPROVED` state to query the provider and `settle()` to `EXECUTED` or `FAILED`.
- **Recommended Fix**: Implement a reconciler worker.

## Lower Priority Issues (P2)
- **P2-1 (WONTFIX)**: ~Frontend uses mock data and static exports. Needs to be wired to the backend API/DB.~ *Per ADR-019, the Next.js UI is meant to be a static documentation asset that verifies benchmark numbers at build time. No DB connection is intended.*
- **P2-2**: SQLite `kavach.db` hardcoded or uses CWD. Need robust environment variable configuration `KAVACH_DB`.
- **P2-3**: Needs robust application lifecycle (startup/shutdown).


---

## Round 2 findings (console build)

Found by building the product on top of the engine, and by verifying it in a real browser
rather than assuming it worked.

### R2-1: `governor.evaluate_and_record` was a fake decision path — FIXED
A second evaluator with a hardcoded `if amount > X` heuristic that never read truth, the
ledger or the estimator, and minted `"ed25519_" + sha256(...)` as a "signature" that the
proof explorer displayed as cryptographic. Every dashboard page and the adversary lab ran
through it. Deleted. `services/decisions.py` is now the only outbound path, and decisions
are recorded as hash-chained events rather than carrying an invented signature.

### R2-2: a captured payment aged out to AMBIGUOUS — FIXED
`Rail.CONFIRMED` was missing from `truth._TERMINAL`, so any payment older than the
fifteen-minute tolerance derived as AMBIGUOUS and `governor.decide` refused every refund
against it with "payment is not captured". A credited refund (ARN present) had the same
problem at six hours, re-opening settled obligations forever and inflating exposure.
Guarded by two regression tests.

### R2-3: `cmd/` shadowed the stdlib `cmd` module — FIXED
`pytest` could not start at all: collecting tests imports `pdb`, which imports `cmd`, which
resolved to the repository's entrypoint package. Renamed to `apps/`.

### R2-4: the web build was broken, and would not have served — FIXED
An unescaped `>` in JSX failed the build outright. Underneath that, `assetPrefix: '.'`
resolved `/dashboard/gate`'s assets to `/dashboard/_next/...`, and `trailingSlash: false`
emitted `dashboard.html` where any static server looks for `dashboard/index.html` — so the
whole console would have 404'd the moment it was served. Both fixed and verified over HTTP.

### R2-5: every API call 500'd from a browser — FIXED
FastAPI runs a synchronous `yield` dependency's body in one threadpool worker and its
teardown in another, so `conn.close()` tripped sqlite3's thread-affinity guard. Sequential
`curl` never reproduced it; a browser's parallel fetches did every time. `connect()` now
takes an explicit `same_thread` flag, opt-in, with a regression test for both directions.

### R2-6: `useAction` froze its closure — FIXED
`call` was memoised with `[]` dependencies, so it always invoked the first render's
function. The Agent Gate posted the cart from its initial render: selecting a different
cart and submitting showed **ALLOW over a cart it had not evaluated**. On a screen whose
only job is to report what the backend decided, that is the worst available failure. The
callable now lives in a ref refreshed every render.

### R2-7: a grid track blew past the viewport — FIXED
Bare `display: grid` wrappers create an implicit `auto` column that sizes to content, so the
Agent Gate's result panel was 849px inside a 519px track and ran off a 1440px screen. Added
a `.stack` primitive with `minmax(0, 1fr)`. Zero horizontal overflow at 1440/1180/900/390.

### R2-8: the demo seed staged an execution the governor denied — FIXED
Rail events were written before the intents that caused them, so the second refund was
denied for exposure it was itself about to create, and the seed then forced it to EXECUTED.
The seed now runs in causal order and raises rather than staging any outcome the governor
did not produce.

### Known limits, stated rather than fixed
- The duplicate-risk estimator reads refund-reason text and is only meaningful in-distribution.
  The same duplicate pair scores 0.74 at a 35-minute gap and 0.46 at an 11-minute gap — under
  the threshold. This is documented in `services/scenarios.py` and is why the model may only
  escalate, never authorise.
- The hash chain is tamper-evident, not tamper-proof, and proves nothing about authorship.
  Both limits ship in every proof response via `proof.claims()`.
- The Gate's demo issuer key is derived locally. The Ed25519 verification is real; the claim
  that a human signed the mandate is not, and every admission response says so.
