# Kavach — Buildathon journey: design

Status: approved for implementation · 2026-09-04

## 0. What this is

Kavach already has a complete decision system (8 planes, 230 tests) and a complete
operator console (17 screens). What it does not have is a way for a person to *be* the
buyer, watch an agent act on their behalf, watch Kavach intervene, and touch the evidence.
This spec adds that layer, plus the deployment that lets a judge open one URL.

The whole design rests on one rule, stated first because everything else is subordinate
to it:

> **No second decision engine.** Every verdict any new surface shows is produced by
> `services/gate.admit`, `services/decisions.evaluate`, `governor.decide`,
> `proof.scan` or the MCP tool functions themselves. New services orchestrate; they never
> decide. Where a new flow needs a fact the system cannot yet produce, the fix is made in
> the source of truth, not in a wrapper.

## 1. Cast and journey

```
Priya (principal)   →  issues a MANDATE (purpose, caps, categories, merchant, window)
agent_desk_v1       →  shops the Bazaar within it, visibly
Kavach              →  admits / steps up / denies, with the 11-rung ladder and evidence
Razorpay (TEST)     →  takes the payment; the truth plane grades what it hears
Proof               →  hash chain, dispute pack, tamper demonstration
```

Routes, all static-exported and served by the one API process:

| Route | What it is |
|---|---|
| `/` | Landing: product hero (new copy + CTAs) → journey strip → the existing 11-chapter argument |
| `/tour` | Guided five-minute path, step rail + narration, composes the components below |
| `/shop` | Kavach Bazaar: storefront, mandate, agent activity, admission, checkout, evidence |
| `/approve?t=…` | Phone step-up page; mobile-first |
| `/duel` | Without Kavach ∥ With Kavach on the same attack sequence |
| `/dashboard/mcp` | MCP console: the real tool functions over HTTP |
| `/dashboard/proof` | + "Tamper with this evidence" sandbox |

Feature UIs are **components** (`web/components/bazaar/*`, `duel/`, `proof/Tamper`,
`mcp/McpConsole`); the pages are thin wrappers so `/tour` can compose the same objects.
Journey state (mandate, cart, admission, step-up token, checkout) lives in one small
store persisted to `sessionStorage`, so `/shop` and `/tour` share it and a reload survives.

## 2. Backend services and seams

All new modules live in `pkg/kavach/services/` and are thin. Amounts are integer minor
units everywhere.

### 2.1 `storefront.py` — catalogue and the visible agent
- `CATALOGUE`: ~14 products on the entailment corpus's vocabulary (`stationery` for office
  supplies, plus `electronics`, `furniture`, and a liquid gift card). Merchant
  `merchant_bazaar_direct`. Category and `liquid` are **merchant facts**, exactly as
  `mandate.Cart` requires.
- `default_mandate(now)`: Priya, purpose "printer paper, pens and notebooks for the home
  office", `categories=["stationery"]`, per-txn ₹5,000, cumulative ₹10,000, 7-day window.
- `plan(mandate, mode)`: a **deterministic** shopper. Filters by delegated categories, ranks
  by lexical fit to the purpose and budget, fills to ~60% of the per-txn cap. `mode` is one
  of `legit | cap | scope | liquid | drift | stepup`; attack modes mutate the plan the way
  the corpus's attack families do. Returns the cart lines, the untrusted context (drift
  only), and an **activity trace** templated from the actual picks — no invented steps.
- No LLM anywhere (ADR-017). The agent is labelled a bench agent in the UI.

### 2.2 `stepup.py` — cross-device re-consent
- Table `stepups(token PK, mandate_json, cart_json, admission_json, created_at,
  expires_at, status, resolved_at, resolved_by, note)`. Token = `secrets.token_urlsafe(24)`.
  TTL 10 minutes. The QR carries only `{origin}/approve/?t=<token>`.
- `create(conn, *, mandate, cart, admission, now)` → token, only when the admission verdict
  is `STEP_UP` (or `HOLD`, shown as merchant review).
- `view(conn, token, now)` → a phone-safe projection: amount, item summary, agent id, the
  reason, status. Never the envelope, never internal ids beyond the mandate id.
- `resolve(conn, token, *, action, now, resolver)`:
  - `PENDING` + `approve` → **re-run `gate.admit(charge=False)`** against the stored
    mandate and cart at *this* moment (revocation and expiry are read at decision time, as
    the envelope module promises). If the re-run is `ALLOW`/`STEP_UP`/`HOLD`, claim the
    nonce with `envelope.claim_nonce_for_env` and charge via `mandate.record_admission`.
    If it is `DENY`, the approval fails with that reason. Append `stepup.approved` /
    `stepup.denied` events (`source="stepup"`, `sig_verified=False` — a phone tap is our own
    record, not a rail signature).
  - Idempotent on `(token, action)`: repeating the same action returns `applied: false`;
    the opposite action on a resolved token is `409 already_resolved`.
  - Expired → `410 expired` and status flips to `EXPIRED`. Unknown → `404`.
- The desktop polls `GET /api/stepup/{token}` every 2s while pending (visibility-aware),
  stops on resolution.

### 2.3 `checkout.py` — real Razorpay TEST payment
- `start(conn, client, *, cart, mandate_id, agent_id, admission_seq, now)` → creates a
  Razorpay **Order** (`receipt=cart_id`, `notes={kavach_cart, kavach_mandate,
  kavach_agent, kavach_admission_seq, kavach_event_hash}`) so the proof hash travels inside
  Razorpay's own entity. Appends `checkout.order.created` (entity_type `checkout`, which
  the obligation ledger does not scan, so an order never masquerades as an obligation).
  Returns `{order_id, amount_minor, key_id}` — the key **id** is public by design; the
  secret never leaves the server.
- `link(conn, client, order)` → a **Payment Link** for the phone path (`reference_id` =
  cart id). Created on demand only.
- `confirm(conn, client, *, order_id, payment_id, signature, secret, now)` → verifies
  `HMAC-SHA256(order_id|payment_id, key_secret)` constant-time; on success appends
  `checkout.signature.verified` (`sig_verified=True` — it *is* an HMAC from Razorpay, and
  what it covers is exactly those two ids), then fetches the payment entity and ingests it
  as `source="api_response"`, `sig_verified=False`. The truth plane therefore derives
  `DERIVED_PROBABLE`, honestly. A wrong signature is `401 bad_signature` and ingests nothing.
- `status(conn, client, *, order_id, now)` → polls `GET /orders/{id}/payments` (or the link)
  when no payment is observed yet, ingests, and returns the `FinancialFact`, its evidence
  rows with `sig_verified` flags, and a **sandbox preview**: the same events plus a
  signature-verified `payment.captured`, derived in memory and labelled `simulated`, so the
  screen can show what a configured webhook would upgrade the fact to. The preview is
  never written anywhere.
- In `replay` mode or without credentials every call answers `503 checkout_unavailable`
  with the exact env vars to set. Nothing is faked.
- `POST /api/webhooks/razorpay` is mounted in the API (same handler logic as
  `webhook.py`, fail-closed on a missing secret) so a deployed URL can receive real
  webhooks and upgrade the fact to `DERIVED_CERTAIN` without a second process.

### 2.4 `duel.py` — the same attack, two lanes
- Builds an isolated in-memory sandbox at the fixed epoch (like `scenarios.py`).
- Runs a fixed sequence through **both lanes** from identical inputs: legit cart, cap
  breach, scope escape, gift card, goal drift, then an outbound duplicate refund.
  - **Kavach lane**: `gate_service.admit` / `decisions.evaluate`, verbatim.
  - **Ungoverned lane**: the governance boundary bypassed — every action executes. This is
    raw entity passthrough, which is what `razorpay-mcp-server` plus a capable agent does.
    Its leak is *derived*: the sum of amounts the Kavach lane refused or held.
- Returns per-step results and cumulative counters for both lanes. The legit step passes in
  both, which is what makes the left lane a baseline and not a strawman.

### 2.5 `tamper.py` — break the chain, safely
- `sqlite3` backup of the live connection into `:memory:`; mutate one chosen row's
  `payload` (e.g. amount ×10) in the copy; run `proof.scan` and `proof.chain` on the copy.
  Return before/after status, the break seq, the field diff, and the affected rows.
  The live ledger is never written. "Restore" is a client-side reset.

### 2.6 MCP over HTTP and toolset parity
- `POST /api/mcp/{tool}` dispatches to the **same function objects** `mcp/server.py`
  registers (`@mcp.tool` returns the function unchanged; a `TOOLS` registry is added).
  A module lock serialises calls; the module's connection opens with `same_thread=False`.
  Provider errors (`RazorpayError`, `CassetteMismatch`) are caught and reported in the
  result envelope, never as a 500.
- `GET /api/mcp/tools` lists tools with their annotations, toolset, and the client config
  snippet.
- `kavach-mcp-server` gains `--toolsets` and `--read-only` (env `KAVACH_TOOLSETS`,
  `KAVACH_READ_ONLY`) with Razorpay's semantics: toolsets outside the list are removed;
  read-only removes write tools **and** sets `Policy(allow_write=False)` so even a stale
  client hitting `create_refund` is refused by the permission tier. New thin toolsets
  `payment_links` (`create_payment_link`, `fetch_payment_link`) and `orders`
  (`create_order`, `fetch_order`) mirror Razorpay's; both ingest their responses as events.

### 2.7 Demo reset and status
- `services/demo.py` owns the seed (moved out of `apps/demo_data.py`, which becomes the
  CLI). `seed(db, *, reset, now)` takes `now` per call so a reset an hour later is not an
  hour stale. Reset also clears `stepups`, `gate_nonces`, `gate_revocations`.
- `POST /api/demo/reset` — enabled when `KAVACH_DEMO=1` (default in the container and in
  `make run`); `403` otherwise. Rate-limited.
- `/api/health` gains `razorpay.credentials`, `webhook.configured`, `mcp.tools`,
  `demo.reset_enabled`. `/api/metrics` exposes a small Prometheus text surface (stdlib).
- Every response carries `X-Request-Id`; errors log it.

### 2.8 Rate limiting
A stdlib token bucket per client IP on `/api/stepup/*`, `/api/checkout/*`,
`/api/mcp/*`, `/api/demo/reset` (60/min). Nothing else changes.

## 3. Frontend

Design language: the console tokens (colour is determinism; mono is a machine speaking).
The Bazaar is **not** a dashboard: a storefront grid, product cards, a mandate card
with a budget meter, an agent activity rail whose rows are appended on real state
transitions only, and a checkout drawer. Verdicts use the existing `<Why>` and `<Ladder>`.

- `bazaar/Journey.tsx` — the state machine: `mandate → planning → admission → (stepup |
  checkout | denied) → evidence`. Each transition is a real API call; the activity rail
  logs what the API returned.
- `bazaar/Storefront.tsx`, `ProductCard`, `Cart`, `MandateCard` (editable caps/purpose),
  `AgentActivity`, `Verdict` (three visually distinct outcomes, progressive disclosure:
  sentence → evidence → raw), `Checkout` (loads `checkout.razorpay.com/v1/checkout.js`,
  opens the real modal with the order id and public key id; the handler POSTs to
  `/api/checkout/confirm`), `TruthPanel` (observed source · signature · confidence, and the
  sandbox preview of the webhook upgrade), `StepUp` (QR from the `qrcode` package, polling).
- `/approve` — one screen: what the agent wants, the amount, why it stopped, Approve /
  Deny, then the outcome; handles expired, resolved, invalid, duplicate tap.
- `duel/Duel.tsx` — two lanes, synchronised playback, counters animated with
  `motion` from the derived numbers only.
- `proof/Tamper.tsx` — button, red break at the exact seq, diff, restore.
- `mcp/McpConsole.tsx` — tool picker, arguments, request → tool → decision → evidence.
- `/tour` — step rail (10 steps + finale), each step mounts the relevant component with
  narration; the finale is the synthesis screen (one agent · one mandate · many actions →
  ALLOW / STEP-UP / DENY → authority · policy · evidence · proof).
- Landing hero: "KAVACH — The authorization layer for agentic commerce." /
  "Let AI agents act on your behalf without giving them unchecked authority." /
  CTAs **See Kavach in action** → `/tour`, **Explore the architecture** → chapter 02.
  A journey strip below the hero draws Buyer → Mandate → Agent → Action → Governor →
  Evidence → Verdict → Payment → Proof. The existing chapters follow unchanged.

Performance: the Bazaar/duel/tour bundles import GSAP/motion only where used; polling is
visibility-aware and bounded; no intervals survive unmount; reduced motion honoured via
`useStill()`.

## 4. Deployment

- `Dockerfile` (multi-stage): `node:22-alpine` builds `web/out`; `python:3.12-slim`
  installs the package, copies the export, **trains both models at build** (they are
  gitignored; ~30s; the build fails if a model stops beating its baselines), and starts
  `entrypoint.sh`: seed if `$KAVACH_DB` is absent (or `KAVACH_SEED_ON_START=1`), then
  `python apps/api_server.py --host 0.0.0.0 --port $PORT`.
- `.dockerignore`, `docker-compose.yml` (volume at `/data`), `render.yaml` (disk),
  `fly.toml` (mount). Health check `/api/health`.
- Persistence is explicit: `KAVACH_DB=/data/kavach.db` on a mounted disk. On ephemeral
  storage the ledger restarts from the seed; the docs say so. Demo state (`stepups`) and
  evidence semantics (hash chain) are separated: a reset re-seeds both deterministically.
- `.env.example` lists every variable, required vs optional. `documents/11-deploy.md`
  documents the procedure and the webhook setup that upgrades truth to `DERIVED_CERTAIN`.
- Docker is not installed on the development machine; every step is verified individually
  and the report says so.

## 5. Security boundaries touched
No sessions or cookies (no CSRF surface); CORS unchanged. Step-up tokens: 192-bit random,
single-purpose, TTL, no PII in the QR. Checkout: only the public key id reaches the
browser; the secret verifies signatures server-side. Webhooks: HMAC over the raw body,
fail-closed. Inputs: pydantic models with bounds; identifiers reject control characters.
Errors: the existing `{"error": {...}}` envelope; no stack traces. Reset: env-gated and
rate-limited. Tamper: sandbox copy only. Secrets never logged.

## 6. Tests
New files: `test_storefront.py`, `test_stepup.py`, `test_checkout.py`, `test_duel.py`,
`test_tamper.py`, `test_mcp_http.py`, `test_api_journey.py` (FastAPI TestClient smoke of
every new endpoint, invalid inputs, rate limit, reset gating). Existing 230 stay green;
`test_site.py` keeps policing copy (tool list, test count, chapters).

## 7. Out of scope (deliberately)
LLM shopping agent; RazorpayX payouts governance; Postgres adapter; real WhatsApp/SMS
(the phone page is the channel); external chain anchoring.
