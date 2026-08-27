# Kavach Engineering Audit

## A. Complete Repository Architecture Map
- **cmd/**: Entrypoints (`mcp_server.py`, `benchmark.py`, `gate_benchmark.py`).
- **pkg/kavach/**: Core domain logic.
  - **eventlog.py**: Append-only log with idempotent ingestion.
  - **truth.py**: Deterministic state machine (Rail State vs Obligation State).
  - **ledger.py**: Open-object ledger, intent write-ahead log.
  - **governor.py**: Authority ladder, enforces caps/invariants.
  - **gate/**: Inbound agent admission (envelope, mandate, admission).
  - **intelligence/**: Duplicate-risk model, entailment model, feature extraction.
  - **razorpay/**: Provider adapter (live/replay client).
  - **mcp/**: MCP server implementation.
  - **proof/**: Cryptographic audit chain (Planned).
- **web/**: Next.js frontend (Mock/Demo UI).

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
Frontend is partially implemented in `web/` using Next.js. Currently reads mock data. Needs to consume backend state dynamically via API or direct DB connection.

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
| Event Log | IMPLEMENTED (missing hash chain) |
| Obligation Ledger | PARTIALLY IMPLEMENTED (Lacks concurrency locks) |
| Risk Model | IMPLEMENTED |
| Governor | IMPLEMENTED |
| Razorpay Client | IMPLEMENTED |
| Webhook Ingestion | PLANNED / MISSING |
| Reconciliation | PLANNED / MISSING |
| Inbound Gate | IMPLEMENTED (has bugs) |
| MCP | IMPLEMENTED (has bugs) |
| Proof / Hash Chain | PLANNED / MISSING |
| Web Experience | IMPLEMENTED (Static UI aligned with ADR-019) |

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
- **File**: `cmd/`
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
