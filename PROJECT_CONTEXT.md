# PROJECT_CONTEXT.md: Forensic Engineering Evidence Pack

> **Document Type:** Forensic Repository Audit & Architecture Evidence Pack  
> **Target Audience:** Pitch-writing model / Technical Due Diligence Evaluator  
> **Repository:** `Kavach` (`pkg/kavach`, `apps/`, `web/`, `tests/`, `evals/`, `data/`, `documents/`)  
> **Audited Commit / Version:** `0.1.0` (commit `cbffdb2`, 290 passing tests)  
> **Verification Status:** Verified against active Python 3.12 codebase, running FastAPI server on `:8000`, active SQLite WAL database, and compiled Next.js 16 static export.

---

## 1. PROJECT

### What It Is
Kavach is a merchant-side trust and governance engine for agentic commerce. It operates in two directions:
1. **Inbound (Kavach Gate):** Evaluates whether an autonomous buyer agent arriving at checkout holds a valid delegated mandate and whether its assembled cart genuinely satisfies the principal's stated intent.
2. **Outbound (Kavach Rail):** Governs operator-side AI agents inside merchant dashboards moving money (e.g., refunds, payouts) to prevent duplicate executions, cap breaches, and premature settlement assumptions.

Both directions are anchored to a single append-only, SHA-256 hash-chained cryptographic event log (`pkg/kavach/eventlog.py`).

### The Problem
When autonomous AI agents interact with financial rails, existing controls fail because they protect the wrong boundaries:
- **Inbound Gap:** AP2 cart mandates, UPI Reserve Pay, and card network spend caps bind **how much** an agent may spend and verify that a key signed an envelope. They cannot verify **what an agent is buying**. A mandate reading *"weekly groceries under ₹2,000"* is satisfied arithmetically and to the rupee by ₹1,800 in Amazon Pay gift cards or 12 packs of wheat flour. Furthermore, prompt injections hidden in untrusted product reviews or seller listings can hijack an agent's objective without breaking cap or category rules.
- **Outbound Gap:** Payment gateway APIs return entity status acknowledgements, not terminal settlement truth. When an operator agent calls `create_refund(payment_id, amount)`, Razorpay answers `200 OK {"status": "processed"}`. As Razorpay's documentation states: *"Usually, Razorpay moves a refund to the processed state before receiving the ARN/RRN from the Gateway."* An autonomous agent routinely misinterprets `processed` as *"the customer has received the money."* When the customer complains hours later, the agent forms a **semantically new intent** (*"The previous refund didn't go through; issuing another ₹5,000 refund"*) and calls the API again.
- **Why Existing Controls Fail:**
  - **Idempotency Keys:** Only deduplicate an identical network replay. An agent generating a fresh intent generates a fresh idempotency key (`kavach-intent-uuid`).
  - **Daily/Session Spend Caps:** A second ₹5,000 refund inside a ₹50,000 daily limit passes every cap check.
  - **Read-Only Scoping:** The agent legitimately needs write permission for `create_refund`.
  - **Temporal / Durable Execution:** Ensures exactly-once execution *within a single workflow*; it has no visibility across distinct agent sessions, prompts, or workflows.

### Target User
1. **E-Commerce Merchants & Marketplaces:** Accepting checkout orders from buyer agents (e.g., ChatGPT Operator, Claude Coworker, Perplexity Shopping, auto-purchasing bots).
2. **Merchant Operations & Support Teams:** Deploying AI customer support or dispute bots with tool access to issue refunds, cancel orders, and trigger payouts.
3. **Payment Aggregators / Platforms (Razorpay):** Embedding trust and intent verification layers into developer MCP servers, checkout SDKs, and payment intelligence pipelines.

### Why Now
- **Agentic Commerce Explosion (2026):** Razorpay, OpenAI, Anthropic, and Google launched Agent Toolsets, Remote MCP servers, and Agentic Payments (UPI Circle, Reserve Pay). Tools were placed directly in agents' hands without changing the semantics of what tools return (raw API entities).
- **Asymmetric Fraud Scale:** Automated bot farms can trigger thousands of delegated checkout sessions or duplicate refund attempts per minute. Human review queues cannot scale linearly with agent concurrency.
- **Regulatory & Network Movement:** NPCI's Universal Agent Platform (UAP) and UPI Reserve Pay are actively defining agent delegation, creating an urgent need for the merchant-side decision contract.

### Core Innovation
1. **The Determinism Gradient (Order of Authority):**
   - **Entrance:** Cryptography (Ed25519) and integer arithmetic (caps, merchant allowlists, category scope). Deterministic, non-negotiable.
   - **Middle:** Learned advisory ML models (TF-IDF + relational logistic estimators for semantic duplicate risk and intent-cart entailment). **Crucial rule:** Learned models are advisory only; a model may only ever shift a decision toward *more caution* (escalating to human review or step-up). A model score of `0.00` cannot override a cap or an invariant.
   - **Exit:** Accounting invariants (`total_refunded <= captured_amount`) and permission tiers.
2. **Separation of Rail State from Obligation State:**
   - Gateway status (`processed`) represents gateway dispatch, not customer settlement.
   - Obligation remains `OPEN` until a banking reference (Acquirer Reference Number / ARN / RRN) arrives via a verified webhook.
3. **In-Process Inference with Zero External Dependencies:**
   - Both learned estimators run locally via Scikit-Learn in-process. Zero LLMs on the decision path.
   - Decision latency is **~1 ms** (p99 < 2 ms, > 1,100 decisions/sec/core). No external API or LLM outage can cause a payments outage.
4. **Unified Cryptographic Audit Spine:**
   - All inbound admissions and outbound governance actions share the exact same append-only log. Every decision cites the exact event sequence numbers (`evidence: [seq1, seq2]`) on which it was based.

---

## 2. PRODUCT

### Every User-Facing Feature
1. **Guided Interactive Tour (`/tour`):**
   - 10-step scripted walkthrough showcasing mandate creation, autonomous agent shopping, deterministic refusal, cross-device QR step-up on mobile, real Razorpay TEST payment, truth grading, live cryptographic tampering, and dual-lane comparison.
2. **Kavach Bazaar Storefront (`/shop`):**
   - Live demo e-commerce store with a 14-item catalogue (`stationery`, `electronics`, `furniture`, and stored value).
   - Principal Mandate card with live budget meters and editable parameters (Priya's mandate).
   - Deterministic Bench Agent with live execution traces across 6 test scenarios (`legit`, `stepup`, `cap`, `scope`, `liquid`, `drift`).
   - Visual 11-rung Agent Gate Admission Ladder.
   - Embedded Razorpay Standard Checkout modal integration.
3. **Cross-Device Mobile Step-Up (`/approve?t=<token>`):**
   - Mobile-responsive screen triggered by scanning a dynamically generated QR code.
   - Displays agent identity, purpose, cart item summary, and risk reasons.
   - Live Approve and Deny buttons; executing an approval re-admits the cart at that exact instant.
4. **The Duel: Live A/B Sandbox (`/duel`):**
   - Parallel playback comparing an **Ungoverned Lane** (raw passthrough via stock Razorpay MCP) against the **Kavach Governed Lane** across an identical sequence of 5 inbound carts and 2 outbound refund actions.
   - Live rupees-leaked vs rupees-protected metric tickers.
5. **Operator Console (`/dashboard` - 18 Routes):**
   - **Overview (`/dashboard`):** Real-time KPI cards (events, open exposure, leak prevented, active agents, active kill switch status).
   - **Agent Gate (`/dashboard/gate`):** Interactive mandate editor, cart builder, untrusted context injection input, preset selection, and real-time execution of the 11-rung admission ladder.
   - **Decisions (`/dashboard/decisions`):** Interactive dry-run / commit testing harness for outbound actions (`create_refund`).
   - **Truth Engine (`/dashboard/truth`):** Visual state machine inspector showing chronological event trees, rail state vs obligation state, and confidence levels.
   - **Obligations Ledger (`/dashboard/obligations`):** Table of all active entities holding open obligations.
   - **Payments (`/dashboard/payments`):** Captured payment facts, open refund exposure, and cited evidence events.
   - **Refunds (`/dashboard/refunds`):** Refund lifecycle inspector, ARN presence, and settlement status.
   - **Review Queue (`/dashboard/review`):** Operator queue for escalated intents with Approve / Reject action buttons.
   - **Reconciliation (`/dashboard/reconciliation`):** Monitor for stuck `APPROVED` intents requiring provider polling.
   - **Governor Policy (`/dashboard/governor`):** Visualization of the 6-layer authority ladder and immutability parameters.
   - **Risk Intelligence (`/dashboard/risk`):** Feature contribution waterfall and TF-IDF explanation for duplicate-risk scoring.
   - **Adversary Lab (`/dashboard/adversary`):** Interactive execution harness for all 11 adversarial scenarios.
   - **Proof Explorer (`/dashboard/proof`):** Block-by-block cryptographic hash chain viewer with an interactive **"Tamper with Evidence"** sandbox.
   - **Live Event Stream (`/dashboard/stream`):** Polling event log monitor.
   - **Agents Directory (`/dashboard/agents`):** Profile directory of all observed agent IDs and their transaction histories.
   - **MCP Console (`/dashboard/mcp`):** HTTP dispatcher for all 14 Kavach MCP tools with live JSON argument testing.
   - **Evaluations (`/dashboard/evaluations`):** Detailed precision, recall, and monetary baseline comparisons from offline benchmarks.
   - **Settings (`/dashboard/settings`):** Read-only configuration flags and system environment diagnostic report.

### Exact User Flows
- **Flow A: Inbound Mandate & Cart Admission:**
  1. Principal creates/signs an Ed25519 mandate specifying allowed merchants, categories, per-txn cap, cumulative cap, validity window, and free-text purpose.
  2. Buyer agent arrives at `/shop`, selects items, and submits `admit_cart(envelope, signature, cart)`.
  3. Kavach checks envelope signature over raw bytes -> checks validity window -> checks revocation status.
  4. Kavach checks merchant allowlist -> category scope -> per-transaction cap -> cumulative spend.
  5. If deterministic checks pass, entailment model evaluates semantic match between purpose and SKU text; provenance module scores lexical drift against untrusted context; population module checks agent velocity.
  6. Expected loss formula evaluates: $\min(\text{Loss}_{\text{ALLOW}}, \text{Loss}_{\text{STEP\_UP}}, \text{Loss}_{\text{HOLD}}, \text{Loss}_{\text{DENY}})$.
  7. On `ALLOW`, nonce is claimed in `gate_nonces`, cumulative spend is recorded in `events`, and Razorpay checkout order is unlocked.
- **Flow B: Cross-Device Re-Consent Step-Up:**
  1. If expected loss minimizes at `STEP_UP`, gate emits a 192-bit secure URL-safe token with a 10-minute TTL (`pkg/kavach/services/stepup.py`).
  2. UI renders a QR code pointing to `/approve/?t=<token>`.
  3. Merchant desktop polls `GET /api/stepup/{token}` every 2 seconds.
  4. Principal scans QR on mobile phone, reviews details, and clicks "Approve".
  5. Backend re-runs admission at that exact instant to verify that the mandate was not revoked or expired while waiting. If valid, the nonce is claimed and status flips to `APPROVED`.
  6. Desktop receives resolution and transitions directly to Razorpay Checkout.
- **Flow C: Real Payment & Truth Derivation:**
  1. Desktop invokes `POST /api/checkout`, creating an authentic Razorpay TEST Order. Order carries notes: `notes.kavach_admission_hash` and `notes.kavach_admission_seq`.
  2. Razorpay Standard Checkout modal opens. User completes test payment using card/UPI.
  3. Razorpay client handler returns `razorpay_payment_id`, `razorpay_order_id`, and `razorpay_signature`.
  4. Desktop posts confirmation to `POST /api/checkout/confirm`. Server verifies HMAC-SHA256 signature using `RAZORPAY_KEY_SECRET`.
  5. Server fetches payment entity via API. Truth plane marks event as `sig_verified=False` (API response, not webhook), deriving state `CONFIRMED` with confidence `DERIVED_PROBABLE`.
  6. UI displays sandbox preview showing that an HMAC-verified webhook would upgrade confidence to `DERIVED_CERTAIN`.
- **Flow D: Outbound Agent Governance & Duplicate Interception:**
  1. Support agent calls `create_refund(payment_id, amount, reason)`.
  2. Request hits `pkg/kavach/services/decisions.py` inside an atomic `BEGIN EXCLUSIVE` SQLite transaction.
  3. Governor checks invariants: Is payment captured? Does existing open exposure + requested refund exceed captured amount? If violated -> `DENY`.
  4. Governor checks permission tier: Is `allow_write=True`? If false -> `DENY`.
  5. Governor checks kill switch: Is `KAVACH_KILL_SWITCH` active? If active -> `ESCALATE`.
  6. Governor checks truth plane: Are prior obligations `AMBIGUOUS` or stale? If so -> `ESCALATE`.
  7. Governor runs duplicate-risk model: TF-IDF vectorizer + relational feature extractor scores intent against prior intents on the same payment. If risk $\ge 0.513$ -> `ESCALATE`.
  8. Governor checks caps: amount > ₹1,000, session spend > ₹5,000, or daily spend > ₹25,000 -> `ESCALATE`.
  9. If all clear -> `ALLOW`. Intent is logged with write-ahead status `APPROVED`. Razorpay API is called with idempotency key `kavach-{intent_id}`. On success, intent is updated to `EXECUTED`.

### What Is Actually Demoable
- **100% Demoable End-to-End Locally:**
  - Launch with `make run` (serves unified API and UI on `http://127.0.0.1:8000`).
  - Five-minute guided tour (`/tour`).
  - Full shop and cart admission with live model scoring (`/shop`).
  - Mobile QR code scanning and real phone-based approval (`/approve`).
  - Real Razorpay test payments via Standard Checkout when test keys are provided in `.env`.
  - In-memory cryptographic chain tampering demo (`/dashboard/proof`).
  - Headless adversary suite execution (`make scenarios`).
  - Latency benchmarks (`make latency`).
  - Offline model benchmarks (`make bench`, `make gate-bench`).
  - Live MCP server invocation over stdio or HTTP.

### What Is Mocked
1. **NPCI UAP Agent Registry:** No public API exists as of August 2026. The field mapping is formally documented, but agent registry identity lookups are mocked.
2. **UPI Reserve Pay Delegation Protocol:** No public API exists. An Ed25519 cryptographic envelope stands in field-for-field.
3. **Buyer Agent in Storefront:** The shopping agent is a deterministic, rule-based test bench agent (`pkg/kavach/services/storefront.py`), not an autonomous LLM.

### What Is Incomplete
1. **SMS / WhatsApp Re-Consent Dispatch:** The step-up channel generates the token, stores the state, and serves the mobile web UI (`/approve`), but automated push via WhatsApp Business API or Twilio SMS is not wired (relies on QR code or URL sharing).
2. **Postgres Storage Adapter:** The persistence layer is currently SQLite with WAL mode. While all DB queries are centralized through `eventlog.connect()`, a production PostgreSQL adapter has not been implemented.
3. **External Hash Chain Anchoring:** The cryptographic proof chain links events via SHA-256 in SQLite, but the chain head is not periodically committed to an external public ledger (RFC 6962 / Transparency Log).

---

## 3. ARCHITECTURE

### Frontend
- **Framework:** Next.js 16 (React 19, TypeScript) configured as a static HTML/CSS/JS export (`output: 'export'`, `trailingSlash: true`).
- **Styling:** Vanilla CSS design system using CSS custom properties (`web/app/dashboard/console.css`, `kavach.css`, `bazaar.css`, `duel.css`, `tour.css`). Glassmorphism aesthetic with high contrast and zero Tailwind CSS dependency.
- **Animation & Motion:** GSAP and Framer Motion / Motion-DOM for timeline orchestration, step rail animations, and numbers counters.
- **Client Architecture:** Fully decoupled, client-rendered static application. Makes runtime `fetch` calls to `/api/*`. Implements zero mock fallbacks: if the backend is down, components render explicit diagnostic error cards with remediation commands.

### Backend
- **Framework:** FastAPI / Uvicorn running asynchronously in Python 3.11+.
- **Monolithic Single-Port Serving:** When `web/out` exists, FastAPI mounts it via custom Starlette `StaticFiles` at `/`, serving the entire web UI, API, and webhook listeners on port `8000`.
- **Concurrency & Threading:** SQLite connection per request using `same_thread=False` to handle FastAPI threadpool worker handoffs safely. Destructive financial operations utilize `BEGIN EXCLUSIVE` transactions.
- **Services Architecture (`pkg/kavach/services/`):** Unified business logic layer shared identically across MCP tools, HTTP API endpoints, and demo seeders.

### Database
- **Engine:** SQLite 3 in Write-Ahead Logging (`PRAGMA journal_mode=WAL`) and foreign keys enabled (`PRAGMA foreign_keys=ON`).
- **Schemas:**
  1. `events`: Append-only event log. Columns: `seq`, `source`, `external_id`, `entity_type`, `entity_id`, `parent_entity_id`, `event_type`, `payload`, `occurred_at`, `received_at`, `sig_verified`, `previous_event_hash`, `event_hash`. Unique on `(source, external_id)`.
  2. `intents`: Write-ahead intent ledger. Columns: `intent_id`, `agent_id`, `session_id`, `tool`, `target_type`, `target_id`, `amount_minor`, `reason_text`, `created_at`, `status`, `decision`, `result_id`.
  3. `gate_issuers`: Trusted public keys (`key_id`, `public_key` raw 32-byte Ed25519).
  4. `gate_nonces`: Single-use replay protection (`nonce`, `mandate_id`, `claimed_at`).
  5. `gate_revocations`: Real-time blacklist (`mandate_id`, `revoked_at`, `reason`).
  6. `stepups`: Mobile re-consent records (`token`, `mandate_json`, `cart_json`, `admission_json`, `created_at`, `expires_at`, `status`, `resolved_at`, `resolved_by`, `result_json`).
  7. `checkouts`: Razorpay order linkages (`order_id`, `cart_id`, `mandate_id`, `agent_id`, `amount_minor`, `link_id`, `link_url`, `payment_id`, `created_at`).

### APIs
- **HTTP REST Endpoints (`apps/api_server.py`):**
  - **System:** `GET /api/health`, `GET /api/policy`, `GET /api/overview`, `GET /api/stream`, `GET /api/metrics`, `POST /api/demo/reset`.
  - **Intents & Actions:** `GET /api/intents`, `GET /api/intents/{id}`, `POST /api/governor/evaluate`, `GET /api/review`, `POST /api/review/{id}`, `GET /api/reconciliation`.
  - **Financial Truth:** `GET /api/entities/{type}`, `GET /api/entities/{type}/{id}`, `GET /api/truth/{type}/{id}`, `GET /api/obligations`.
  - **Inbound Gate:** `GET /api/agents`, `GET /api/agents/{id}`, `POST /api/gate/inspect`, `POST /api/gate/admit`.
  - **Proof & Tampering:** `GET /api/proof/chain`, `GET /api/proof/verify`, `POST /api/proof/tamper`, `GET /api/dispute/{id}`.
  - **Adversary & Benchmarks:** `GET /api/scenarios`, `POST /api/scenarios/{id}/run`, `GET /api/evaluations`, `GET /api/duel`.
  - **Storefront & Checkout:** `GET /api/storefront`, `POST /api/storefront/plan`, `POST /api/stepup`, `GET /api/stepup/{token}`, `POST /api/stepup/{token}/resolve`, `POST /api/checkout`, `GET /api/checkout/latest`, `POST /api/checkout/{order_id}/link`, `POST /api/checkout/confirm`, `GET /api/checkout/{order_id}`.
  - **Webhooks:** `POST /api/webhooks/razorpay`.
  - **MCP HTTP:** `GET /api/mcp/tools`, `POST /api/mcp/{tool}`.

### MCP / Tools
- Implemented in `pkg/kavach/mcp/server.py` using official Model Context Protocol Python SDK (`mcp.server.MCPServer`).
- **14 Tools Across 6 Toolsets:**
  1. `payments`: `fetch_payment` (returns financial fact, rail state, obligation state, and open exposure).
  2. `refunds`: `fetch_refund`, `list_open_obligations`, `check_refund` (dry-run evaluation), `create_refund` (governed write action).
  3. `governance`: `approval_queue`, `audit_trail`, `verify_audit_trail`.
  4. `gate`: `verify_agent` (inspection without nonce consumption), `admit_cart` (admit and spend mandate).
  5. `payment_links`: `create_payment_link`, `fetch_payment_link`.
  6. `orders`: `create_order`, `fetch_order`.
- **Parity with `razorpay-mcp-server`:** Identical tool names, identical arguments, and support for `--toolsets` and `--read-only`. When `--read-only` is set, write tools are omitted and the Governor policy is compiled with `allow_write=False`.

### AI / Models
1. **Outbound Duplicate-Risk Estimator (`pkg/kavach/intelligence/model.py`):**
   - **Type:** Scikit-Learn `LogisticRegression` (class-weighted, L2 regularized) + `StandardScaler` + `TfidfVectorizer` (character/word n-grams 1-2, sublinear TF).
   - **Features (11):** `max_text_sim`, `dup_evidence` ($sim \times (1 - \Delta_{\text{amount}})$), `min_amount_delta`, `amount_exact_match`, `log_time_gap`, `frac_diff_session`, `n_prior`, `open_ratio`, `open_count`, `any_result_unknown`, `amount_share`.
   - **Input:** Reason text of the current intent + prior intents on the same payment.
   - **Output:** Calibrated probability $[0.0, 1.0]$ of semantic duplicate obligation.
2. **Inbound Entailment Estimator (`pkg/kavach/intelligence/entailment.py`):**
   - **Type:** Scikit-Learn `LogisticRegression` + `StandardScaler` + `TfidfVectorizer`.
   - **Features (10):** `purpose_sim_max`, `purpose_sim_mean`, `purpose_sim_value_weighted`, `unsupported_value_share`, `liquid_value_share`, `max_line_share`, `cap_utilisation`, `max_quantity`, `n_lines`, `log_total`.
   - **Input:** Mandate purpose text + cart line item descriptions, unit amounts, quantities, and merchant liquidity tags.
   - **Output:** Purpose-mismatch risk probability $[0.0, 1.0]$.
3. **Inbound Goal-Drift Scorer (`pkg/kavach/gate/provenance.py`):**
   - **Type:** Lexical set overlap analysis.
   - **Calculation:** Measures token overlap between cart items and untrusted context strings (e.g., prompt injections in reviews), discounting the vocabulary of the authorized mandate.
4. **Population Velocity Scorer (`pkg/kavach/gate/population.py`):**
   - **Type:** Heuristic sliding-window velocity analyzer over the intent ledger. Flags agents executing $>20$ actions/hr (score 0.6) or $>50$ actions/hr (score 1.0).

### Event System
- All database operations are driven through `pkg/kavach/eventlog.py`.
- **Append-Only Ingestion:** Every write is an `append()` call. Idempotent based on `(source, external_id)`.
- **Cryptographic Chaining:** Each record computes:
  $$\text{event\_hash} = \text{SHA-256}(\text{prev\_hash} \parallel \text{source} \parallel \text{external\_id} \parallel \text{entity\_type} \parallel \text{entity\_id} \parallel \text{event\_type} \parallel \text{payload} \parallel \text{occurred\_at} \parallel \text{sig\_verified})$$
- **Causal Ordering:** Derivations order by `(occurred_at, seq)` rather than arrival timestamp to handle out-of-order webhook delivery.

### Risk Engine
- Implements microeconomic **Expected Loss Optimization** (`pkg/kavach/gate/admission.py`):
  - $\text{Loss}_{\text{ALLOW}} = \text{Risk} \times \text{CartTotal} \times \text{FraudLossShare}$
  - $\text{Loss}_{\text{STEP\_UP}} = \text{FrictionCost}_{\text{StepUp}} + \text{Risk} \times (1 - \text{CatchRate}_{\text{StepUp}}) \times \text{CartTotal} \times \text{FraudLossShare}$
  - $\text{Loss}_{\text{HOLD}} = \text{ReviewCost}_{\text{Hold}} + \text{Risk} \times (1 - \text{CatchRate}_{\text{Hold}}) \times \text{CartTotal} \times \text{FraudLossShare}$
  - $\text{Loss}_{\text{DENY}} = (1 - \text{Risk}) \times \text{CartTotal} \times \text{MarginShare}$
- Automatically selects the verdict that minimizes expected monetary loss.

### Policy / Governor
- Authority ladder enforced in strict hierarchical priority:
  1. Accounting invariants (`DENY` - non-negotiable).
  2. Permission tiers (`DENY`).
  3. Operator Kill Switch (`ESCALATE` - routes all actions to human review).
  4. Truth-plane confidence (`ESCALATE` if state is `UNKNOWN` or `AMBIGUOUS`).
  5. Duplicate-risk model (`ESCALATE` if risk $\ge$ threshold; never authorises).
  6. Financial exposure caps (`ESCALATE` if per-refund, session, or daily limits breached).

### External Integrations
- **Razorpay REST API (`pkg/kavach/razorpay/client.py`):**
  - Live mode: Authenticated HTTP basic auth against `api.razorpay.com/v1` for Orders, Payments, Refunds, Payment Links.
  - Replay mode: Cassette-based mock recording/playback (`data/cassette.jsonl`) for reproducible, offline evaluation.
- **Razorpay Webhooks (`pkg/kavach/webhook.py`):**
  - Ingests `payment.captured`, `refund.processed`, `refund.created`, `refund.failed`.
  - Verifies HMAC-SHA256 signatures over raw request body using `RAZORPAY_WEBHOOK_SECRET`.
- **Razorpay Standard Checkout:**
  - Client-side checkout modal loaded from `https://checkout.razorpay.com/v1/checkout.js`.
  - Server-side signature verification using `verify_checkout_signature` over `order_id|payment_id`.

---

## 4. DATA FLOW

```
[Agent or Buyer Request]
         │
         ▼
 1. Input Normalization & Security Boundary
    ├── Money parsed strictly into integer minor units (parse_inr)
    └── Identifiers sanitized (no control characters, length bounded)
         │
         ▼
 2. Ingestion & Pre-Condition Checks
    ├── Inbound Gate: Ed25519 signature verified over raw bytes -> Nonce checked -> Window checked
    └── Outbound Rail: Event log checked for target entity -> Prior intents queried
         │
         ▼
 3. Truth Derivation (pkg/kavach/truth.py)
    ├── Fold events in causal order (occurred_at, seq)
    ├── Check rank progression for regressions/contradictions
    ├── Check staleness (payments: 15m, refunds: 6h)
    └── Emit FinancialFact (rail_state, obligation_open, confidence, evidence)
         │
         ▼
 4. Risk Evaluation (pkg/kavach/intelligence/)
    ├── Inbound: Entailment model + Goal drift scoring + Agent velocity
    └── Outbound: Relational features + TF-IDF reason text -> Risk probability
         │
         ▼
 5. Deterministic Decision Gate (Governor / Admission Ladder)
    ├── Inbound: Expected loss argmin over (ALLOW, STEP_UP, HOLD, DENY)
    └── Outbound: Accounting invariants -> Permission tier -> Kill switch -> Risk threshold -> Caps
         │
         ▼
 6. Action Execution (Atomic Transaction)
    ├── Write-ahead record in `intents` ledger (status = APPROVED)
    └── If Inbound ALLOW: Nonce claimed in `gate_nonces`, spend recorded in `events`
         │
         ▼
 7. External Provider Invocation (pkg/kavach/razorpay/client.py)
    ├── Call Razorpay API (POST /refunds, POST /orders)
    ├── Pass idempotency key: `kavach-{intent_id}`
    └── Pass notes: `kavach_admission_hash`, `kavach_admission_seq`
         │
         ▼
 8. Webhook Ingestion & Invariant Upgrade (pkg/kavach/webhook.py)
    ├── Webhook arrives: POST /api/webhooks/razorpay
    ├── Verify HMAC-SHA256 signature against raw body bytes
    └── Append event with `sig_verified=True` -> Upgrades truth from DERIVED_PROBABLE to DERIVED_CERTAIN
         │
         ▼
 9. Background Reconciliation (apps/reconciler.py)
    ├── Poll for intents stuck in `APPROVED` beyond tolerance (60s)
    ├── Query Razorpay payment refunds endpoint
    └── Settle intent to `EXECUTED` (if matched) or `FAILED` (if absent)
         │
         ▼
10. Audit & Cryptographic Proof (pkg/kavach/proof.py)
    ├── Compute SHA-256 hash chaining over event record
    └── Store in append-only log -> Exportable as signed Dispute Pack
```

---

## 5. DEMO

### Exact Demo Scenario
The demo follows the standard 5-minute operator pitch script (`documents/09-demo.md`, `README.md`):
- **Scenario:** Priya delegates a home-office purchasing mandate to her autonomous assistant (`agent_desk_v1`). She sets a ₹5,000 per-order cap, ₹10,000 cumulative cap, and restricts purchases to `stationery`.
- **Step 1:** The agent autonomously selects paper, pens, and notebooks. Kavach runs the 11-rung admission ladder; all checks pass; cart is admitted (`ALLOW`).
- **Step 2:** The agent misinterprets the prompt and attempts to purchase an HP Colour Inkjet Printer for ₹7,499. Kavach refuses by integer arithmetic (`DENY` - Cap Exceeded) without consulting the ML model.
- **Step 3:** The agent selects an LED Desk Lamp (plausible extra, not in original text). Kavach flags semantic ambiguity. Expected loss dictates `STEP_UP`. UI renders a mobile QR code.
- **Step 4:** The user scans the QR on their smartphone, opening `/approve`. The user approves the transaction. The gate re-evaluates the mandate dynamically and admits the cart.
- **Step 5:** The user pays via authentic Razorpay TEST Standard Checkout. The resulting payment carries the admission hash into Razorpay's entity notes. The fact is graded `DERIVED_PROBABLE` (polled), and the UI illustrates the webhook upgrade to `DERIVED_CERTAIN`.
- **Step 6:** Outbound attack: An agent attempts to refund the order twice. The semantic duplicate model detects the paraphrased collision, evaluates exposure, and halts the execution (`ESCALATE`).
- **Step 7:** Tamper demonstration: The user clicks "Tamper with Evidence". A byte in the log is modified in a sandbox copy; the verifier detects hash-chain corruption at that exact sequence number.

### Exact Commands & Clicks
1. **Start System:**
   ```bash
   make run
   ```
2. **Browser Navigation:** Open `http://127.0.0.1:8000/tour` in a browser.
3. **Step 1 (Mandate):** Click "Next: Autonomous Shopping" -> Observes Priya's Ed25519 mandate.
4. **Step 2 (Shop & Overreach):** Click "Inject Overreach" -> Agent selects ₹7,499 printer.
5. **Step 3 (Refusal):** Click "Run Gate Ladder" -> Observes Rung 6 (Cap Arithmetic) fail with `DENY`.
6. **Step 4 (Ambiguity & QR):** Click "Test Ambiguous Cart" -> Agent selects Desk Lamp. Gate returns `STEP_UP`. QR code renders.
7. **Step 5 (Phone Approval):** Scan QR with phone camera -> On phone browser, tap "Approve Purchase". Desktop updates instantly.
8. **Step 6 (Payment):** Click "Pay with Razorpay" -> Razorpay modal opens -> Complete test payment using Razorpay test card.
9. **Step 7 (Tamper):** Navigate to `/dashboard/proof` -> Click "Tamper with Evidence" -> Event row highlights red, reporting hash mismatch at sequence #30.
10. **Step 8 (Duel):** Navigate to `/duel` -> Click "Run Duel Simulation" -> Observes 7 actions evaluated side-by-side.

### Expected Outputs
- Gate Admission: `{"verdict": "ALLOW", "purpose_risk": 0.00, "charged_to_mandate": true}`.
- Cap Breach: `{"verdict": "DENY", "scope_violations": ["PER_TXN_CAP_EXCEEDED"]}`.
- Step-Up: `{"verdict": "STEP_UP", "approve_path": "/approve/?t=..."}`.
- Outbound Duplicate: `{"action": "ESCALATE", "duplicate_risk": 0.81, "reasons": ["duplicate-risk 0.81 >= 0.51"]}`.
- Tamper Scan: `{"ok": false, "broken_at": 30, "detail": "event 30 does not reproduce its stored hash"}`.

### Best WOW Moment
Scanning the desktop QR code with a physical mobile phone, clicking "Approve" on the mobile device, and watching the desktop instantly re-admit the cart, update the audit trail, and pop open the genuine Razorpay Checkout modal without touching the desktop keyboard.

### Failure Cases Handled
1. **Model Missing from Disk:** If `.pkl` files are deleted, system falls back closed (Admission floors at `STEP_UP`, never `ALLOW`; Governor escalates to human review).
2. **Replayed Mandate Nonce:** Re-submitting a previously spent mandate returns typed error `Failure.REPLAYED_NONCE`.
3. **Revoked Mandate:** Mandates revoked mid-flight are immediately rejected (`Failure.REVOKED`) because revocation is queried live from SQLite on every evaluation.
4. **Out-of-Order Webhooks:** Events arriving late are sorted causally by `occurred_at`, preventing state regression.
5. **API Backend Down:** Next.js UI displays an honest, styled diagnostic card stating that the backend is unreachable, naming the failed URL, and providing the exact `make run` shell command to fix it.

### Backup / Demo Fallback
- If live internet or Razorpay API is down: Set `KAVACH_MODE=replay` in `.env`. The system reads pre-recorded HTTP cassettes from `data/cassette.jsonl` with zero network calls.
- If database gets corrupted during live presentation: Invoke `POST /api/demo/reset` or click "Reset Ledger" in console header. Resets the database to a pristine seed in under 200 ms.

---

## 6. ENGINEERING

### Hardest Technical Problems
1. **Semantic Duplicate Detection Without Keyword Collisions:** Distinguishing between *"item damaged, issuing refund"* and *"item damaged, issuing refund for second unit in same order"*. Deterministic rules treat these identically. Solved by combining TF-IDF reason embeddings with relational graph features (time delta, amount match, prior attempt count), allowing the model to learn that *"second unit"* is a distinct financial obligation.
2. **Eliminating Nonce-Burning Denial of Service:** If a nonce is claimed upon receiving a request, an attacker can submit an invalid cart or incorrect timestamp to permanently burn a legitimate customer's mandate. Solved by verifying signatures and checking caps *before* claiming nonces, consuming the nonce *only* when the transaction reaches an `ALLOW` verdict.
3. **Sub-2ms Latency Guarantee:** AI guardrails typically use LLM calls (e.g., GPT-4o-mini, Claude 3.5 Haiku) requiring 400ms–1500ms network round trips. Solved by replacing LLMs on the decision path with optimized Scikit-Learn logistic models running in-process via C-extensions, executing in 1.4 ms.
4. **Preventing Cumulative Spend Counter Drift:** A cached counter table (`spent_so_far`) inevitably drifts from event reality during concurrent retries or network partitions. Solved by deriving cumulative spend dynamically from the append-only log via indexed SQL queries.

### Bugs Encountered, Root Causes & Fixes
- **Bug P0-1: Floating-Point Arithmetic in Money Calculations:**
  - *Root Cause:* MCP tools took `amount: float` and computed `int(round(amount * 100))`. IEEE 754 precision loss caused ₹100.50 to occasionally convert to 10049 minor units.
  - *Fix:* Created `pkg/kavach/money.py` with integer minor unit validation (`parse_inr`) and rejected float math in the financial path.
- **Bug P0-2: Mutable Intent Ledger via `INSERT OR REPLACE`:**
  - *Root Cause:* `ledger.record()` used `INSERT OR REPLACE INTO intents`, silently overwriting prior intent state and destroying audit history.
  - *Fix:* Replaced with strict `INSERT INTO intents` and caught `sqlite3.IntegrityError`, enforcing immutability.
- **Bug P0-3: Rejected Mandate Burned Nonces:**
  - *Root Cause:* `envelope.verify()` defaulted to `claim_nonce=True`, burning nonces even when a cart exceeded its cap.
  - *Fix:* Defaulted `claim_nonce=False` in `verify()` and decoupled inspection from admission; nonces are claimed strictly upon `ALLOW`.
- **Bug P0-4: Concurrency Race Condition on Duplicate Refunds:**
  - *Root Cause:* `decide()` read state and `execute()` wrote state in separate transactions. Two concurrent agent requests could both read zero open exposure and execute duplicate refunds.
  - *Fix:* Introduced `BEGIN EXCLUSIVE` transactions in SQLite during execution reservation.
- **Bug R2-1: Fake Secondary Decision Path:**
  - *Root Cause:* An older evaluation method (`governor.evaluate_and_record`) contained hardcoded heuristics and minted mock `ed25519_` sha256 strings.
  - *Fix:* Completely excised the mock path; unified all evaluations under `pkg/kavach/services/decisions.py`.
- **Bug R2-2: Captured Payments Aging Out to AMBIGUOUS:**
  - *Root Cause:* `Rail.CONFIRMED` was omitted from the `_TERMINAL` set in `truth.py`. After 15 minutes of silence, captured payments transitioned to `AMBIGUOUS`, causing Governor to deny all subsequent valid refund requests.
  - *Fix:* Added `Rail.CONFIRMED` to `_TERMINAL`.
- **Bug R2-5: FastAPI Thread-Affinity SQLite Crashes:**
  - *Root Cause:* FastAPI runs dependency yield bodies in one worker thread and cleanup/teardown in another. SQLite's default thread-check raised `ProgrammingError: SQLite objects created in a thread can only be used in that same thread`.
  - *Fix:* Passed `same_thread=False` to request-scoped database connections.
- **Bug R2-6: React Stale Closure Freezing Cart Action:**
  - *Root Cause:* `useAction` hook memoized its callback with `[]` dependencies, binding to the initial cart state. Changing cart selections in the UI continued to submit the previous cart.
  - *Fix:* Stored the callback in a mutable `useRef` updated on every render cycle.

### Architectural Decisions & Tradeoffs
- **ADR-004: LLM Placement:** LLMs are strictly forbidden from determining financial state, amounts, authorization, or risk. Rules -> ML -> Policy.
- **ADR-006: Asymmetric Caution Principle:** A model error or failure may only ever widen caution (escalate / hold / step-up); it can never authorize an action.
- **ADR-013: SQLite WAL Mode over PostgreSQL/Redis:** Chosen to ensure zero-setup execution (`make run`) for evaluation while retaining ACID transactional guarantees. Tradeoff: Single-writer bottleneck.
- **ADR-016: Single Shared Event Log:** Both Gate (inbound) and Rail (outbound) share one event log table. Tradeoff: Cumulative spend calculations require scanning prior admission events rather than reading a static counter.
- **ADR-017: Lexical Entailment over LLMs:** Deployed TF-IDF over relational features to allow local execution without API keys. Tradeoff: Cannot resolve semantic synonyms (e.g., "Glenfiddich 12" under "wine and whisky").

---

## 7. EVALUATION

### Datasets
1. **Outbound Duplicate-Risk Corpus (`pkg/kavach/intelligence/corpus.py`):**
   - 2,600 payments -> 5,740 intents (9.3% duplicate base rate, seed 7).
   - Filtered strictly to intents with $\ge 1$ prior intent on the same payment to eliminate structural negative bias.
   - Temporal train/test split with payments disjoint across sets.
   - Held-out test set: $n = 925$ intents, 154 duplicates, ₹2,25,311 total duplicate exposure.
2. **Inbound Cart Entailment Corpus (`pkg/kavach/intelligence/cart_corpus.py`):**
   - 2,000 mandates -> 3,948 carts (14.0% out-of-purpose rate, seed 7).
   - Population: Carts arriving under valid envelopes that pass all deterministic checks.
   - Temporal split with disjoint mandate IDs.
   - Held-out test set: $n = 1,185$ carts, 177 violations, ₹2,62,532 out-of-purpose exposure.
   - Four distinct attack families: F1 (Liquidity/Gift cards), F2 (Goal drift across sessions), F3 (Quantity anomalies), F4 (Cap-hugging filler).

### Methodology
- **Fixed Operational Review Budget Constraint:** Compares systems at **identical human escalation rates** (~20% budget). Evaluating without budget parity allows trivial "escalate everything" rules to win.
- Vectorizers, scalers, and classification thresholds are fit **strictly on training data** and frozen before evaluating test sets.

### Outbound Duplicate Benchmark Results (`evals/risk_report.json`)
*Test set: $n = 925$, Duplicate exposure: ₹2,25,311, Review budget: 20%*

| System | Precision | Recall | Average Precision (AP) | Escalation Rate | Rupees Leaked | Within Budget? |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **B0 Escalate Everything** | 0.166 | 1.000 | 0.166 | 100.0% | ₹0 | ✗ |
| **B1 Exact Text Match** | 0.000 | 0.000 | 0.166 | 0.0% | ₹2,25,311 | ✓ |
| **B2 Rule: Amount + Open + 24h** | 0.187 | 0.221 | 0.171 | 19.7% | ₹1,84,636 | ✓ |
| **B3 Learned (No Text)** | 0.659 | 0.779 | 0.832 | 19.7% | ₹61,105 | ✓ |
| **B4 Kavach (Learned + Reads Text)** | **0.813** | **0.961** | **0.980** | **19.7%** | **₹14,257** | **✓** |

> **Key Finding:** At identical human review cost (19.7%), a standard engineering rule leaks **₹1,84,636**, whereas Kavach leaks **₹14,257** (13x reduction in financial leakage).

### Inbound Cart Admission Benchmark Results (`evals/gate_report.json`)
*Test set: $n = 1,185$, Out-of-purpose exposure: ₹2,62,532, Step-up budget: 20%*

| System | Precision | Recall | Average Precision (AP) | Step-Up Rate | Rupees Leaked | Within Budget? |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **G0 Step Up Everything** | 0.149 | 1.000 | 0.149 | 100.0% | ₹0 | ✗ |
| **G1 Lexical Overlap** | 0.151 | 0.695 | 0.154 | 68.8% | ₹98,482 | ✗ |
| **G2 Category + Cap Rule** | 0.000 | 0.000 | 0.149 | 0.0% | ₹2,62,532 | ✓ |
| **G3 Hand-Written Red Flags** | 0.189 | 0.469 | 0.207 | 37.1% | ₹1,07,924 | ✗ |
| **G4 Learned (No Text)** | 0.310 | 0.418 | 0.393 | 20.2% | ₹1,46,293 | ✗ |
| **G5 Kavach (Learned + Reads Cart)** | **0.549** | **0.723** | **0.744** | **19.7%** | **₹59,898** | **✓** |

> **Key Finding:** G2 (standard AP2 / Stripe cap & category rule) scores **0.000** recall and leaks 100% of exposure because every attack cart sits inside delegated categories and caps. Reading cart text reduces leakage from **₹1,46,293** (G4) to **₹59,898** (G5).

### Per-Family Recall Analysis (Inbound Gate)
- **F1 Liquidity (Stored value / Gift cards):** $n = 18$, Recall = **1.000** (100% caught)
- **F3 Quantity Anomalies (Unreasonable volume):** $n = 29$, Recall = **1.000** (100% caught)
- **F4 Cap-Hugging Filler:** $n = 70$, Recall = **0.686**
- **F2 Purpose Drift (Session goal drift):** $n = 60$, Recall = **0.550** (Weakest plane; lexical drift without LLM context fails on subtle semantic shifts).

---

## 8. SECURITY

### Threat Model
- **Assets Protected:** Merchant account balance, open refund reserves, customer mandate authorizations, tamper-evident audit history.
- **Adversary Classes:**
  - **A1 Forger:** Crafts fake mandates without a valid private key. Defended by Ed25519 verification over raw bytes.
  - **A2 Replayer:** Replays a valid mandate to execute duplicate purchases. Defended by single-use atomic nonces.
  - **A3 Scope Stretcher:** Exploits category loopholes or attempts bulk purchases. Defended by integer cap and scope arithmetic.
  - **A4 Purpose Subverter:** Purchases unauthorized items (gift cards) within category/cap limits. Defended by semantic entailment scoring.
  - **A5 Hijacked Agent (Prompt Injection):** Injected instructions in web content/reviews redirecting cart goals. Defended by provenance drift scoring and objective bounding against original mandate text.
  - **A6 Re-Deciding Agent:** Outbound agent generating duplicate refunds across distinct sessions. Defended by semantic duplicate-risk model and obligation ledger.
  - **A7 Confused Agent:** Conflates API `processed` statuses with customer credit. Defended by rail-vs-obligation truth separation.

### Trust Boundaries
- **Untrusted:** Buyer agent parameters, HTTP request headers, webhook signatures before verification, product reviews, free-text refund reasons.
- **Partially Trusted:** Razorpay API responses (authenticated via Basic Auth, but ingested as `sig_verified=False` -> `DERIVED_PROBABLE`).
- **Trusted:** Merchant database, pre-configured issuer public keys, merchant product catalogue facts (`category`, `liquid` tags).

### Authentication & Authorization
- **Agent Admission:** Ed25519 digital signatures verified against known issuer public keys (`pkg/kavach/gate/envelope.py`).
- **Webhooks:** Constant-time HMAC-SHA256 signature verification (`pkg/kavach/webhook.py`). Missing secret fails closed.
- **Operator Console:** **No authentication implemented.** The operator dashboard assumes internal network or VPN isolation.

### Idempotency
- **Event Log:** Unique constraint on `(source, external_id)` via `INSERT OR IGNORE`.
- **Intents:** Enforced via primary key `intent_id` and unique `X-Refund-Idempotency: kavach-{intent_id}` header sent to Razorpay.
- **Mandates:** Single-use nonce claimed in `gate_nonces` table.
- **Step-Up:** Tokens resolve idempotently (`(token, action)` repeated returns `applied: false`).

### Failure & Degradation Posture
- **Fail-Closed Principle:**
  - Missing or unreadable risk model -> Admission floors at `STEP_UP`, Outbound Governor escalates to human review. `ALLOW` is unreachable.
  - Missing webhook secret -> Webhooks rejected (401); polling stays `DERIVED_PROBABLE`.
  - Clock skew beyond envelope window -> Refused (`EXPIRED` or `NOT_YET_VALID`).
  - Database lock contention -> Rollback and HTTP 500 error envelope; no partial state committed.

---

## 9. HONEST LIMITATIONS

### Mocked Integrations
1. **NPCI UAP:** Network identity queries are mocked; public network specifications are not yet deployed.
2. **UPI Reserve Pay Mandates:** Field mapping is simulated via standalone Ed25519 JSON envelopes.
3. **Storefront Shopping Agent:** Deterministic script (`pkg/kavach/services/storefront.py`), not an autonomous LLM.

### Synthetic Data
1. **Corpora:** Both duplicate refund (5,740 intents) and cart admission (3,948 carts) datasets are synthetically generated via rule-based combinatorics and paraphrase templates.
2. **Assumed Base Rates:**
   - 12% duplicate intent base rate is an assumed industry parameter.
   - 15% out-of-purpose cart rate is an assumed parameter.
   - Step-up catch rate (70%) and human review catch rate (95%) are assumed economic model parameters.

### Prototype Components
1. **Single-Node SQLite:** Single-writer architecture cannot sustain high-throughput enterprise ingest (>1,500 writes/sec).
2. **Cumulative Spend Recomputation:** Scans prior events on every admission request ($O(N)$ event scan per decision). Acceptable for demo scale (<10,000 events); requires indexed aggregation tables in production.
3. **In-Memory Tampering Demo:** Backs up SQLite to `:memory:` to demonstrate tampering, rather than supporting a live multi-node blockchain/transparency log.

### Known Weaknesses
1. **Lexical Semantic Gap (No Synonym Resolution):** Because entailment uses TF-IDF n-grams rather than dense vector embeddings or an LLM, it cannot resolve synonyms without lexical overlap. For example, *"Glenfiddich 12 Single Malt"* under an authorized mandate for *"wine and whisky"* produces zero word overlap, yielding a high risk score and triggering an unnecessary step-up.
2. **Goal Drift Recall is Low (0.550):** Provenance goal-drift detection relies on word set differences between cart and context. Subtly phrased injections achieve only 55% recall on family F2.
3. **Duplicate Detection Time Gap Sensitivity:** The duplicate model is sensitive to time gaps. A duplicate refund requested 35 minutes later scores 0.81 (escalated), but the same duplicate requested 11 minutes later scores 0.46 (below the 0.51 threshold).
4. **No Operator Auth:** Anyone with network access to port 8000 can approve refunds, trigger resets, or inspect audit logs.

---

## 10. RAZORPAY FIT

### Why Razorpay
Razorpay has established leadership in the Indian agentic payments landscape:
- Shipped `razorpay-mcp-server` (remote MCP tool execution).
- Shipped Razorpay CLI and Dashboard-on-Claude.
- Shipped Agent Studio and UPI Reserve Pay integrations.
However, Razorpay's current stack solves **how an agent initiates a payment**, but does not solve **how a merchant validates an inbound agent or prevents its own agents from creating duplicate liabilities**.

### Which Razorpay Capability It Complements
1. **Razorpay MCP Server:** Kavach provides a drop-in wrapper (`kavach-mcp-server`) with tool-name parity, replacing raw entity responses with validated financial facts and governance checks.
2. **Vulcan:** Vulcan is a pre-authorization routing and risk engine. Kavach operates post-authorization (truth derivation, duplicate obligation tracking) and pre-checkout (agent mandate validation).
3. **Thirdwatch / RTO Shield:** Thirdwatch evaluates human behavioral signals (device fingerprints, COD patterns). Kavach evaluates agent-specific signals (mandate cryptographic envelopes, goal drift, semantic reason overlap).
4. **Razorpay Standard Checkout:** Carries cryptographic admission proofs into core payment entities via `notes.kavach_admission_hash`.

### Where It Would Sit in Razorpay's Architecture
```
[Buyer Agents] ──► [NPCI UAP / UPI Reserve Pay]
                          │
                          ▼
             ┌─────────────────────────┐
             │       KAVACH GATE       │  ◄── Inbound Admission (Pre-Checkout)
             └────────────┬────────────┘
                          │ (ALLOW + Admission Hash)
                          ▼
             ┌─────────────────────────┐
             │ Razorpay Standard / API │
             └────────────┬────────────┘
                          │
                          ▼
             ┌─────────────────────────┐
             │   Vulcan Risk Engine    │  ◄── Pre-Auth Routing & Card Fraud
             └────────────┬────────────┘
                          │
                          ▼
             ┌─────────────────────────┐
             │      Payment Rails      │
             └────────────┬────────────┘
                          │ (Webhooks)
                          ▼
             ┌─────────────────────────┐
             │       KAVACH RAIL       │  ◄── Post-Auth Truth & Obligation Ledger
             └────────────┬────────────┘
                          │ (Financial Facts & Refusal Bounds)
                          ▼
[Merchant Dashboard / Agent Studio / Support MCP Agents]
```

### Productionization Path
1. **Phase 1: Shadow Gateway Extension (30 Days)**
   - Deploy Kavach Rail alongside Razorpay webhook ingestion.
   - Ingest live merchant webhooks into an append-only event log.
   - Run duplicate-risk scoring in shadow mode to establish true production duplicate base rates without blocking traffic.
2. **Phase 2: MCP Server Drop-In Replacement (60 Days)**
   - Replace `razorpay-mcp-server` deployments with `kavach-mcp-server`.
   - Agents automatically receive `FinancialFact` structures instead of raw API responses.
   - Activate Governor policy caps to block unauthorized write operations.
3. **Phase 3: Checkout SDK & UAP Integration (90 Days)**
   - Integrate Kavach Gate validation into Razorpay Checkout APIs (`POST /orders`).
   - Bind incoming payments to NPCI UAP agent certificates and UPI Reserve Pay mandate tokens.
   - Transition SQLite persistence layer to a distributed PostgreSQL cluster with external transparency log anchoring.
