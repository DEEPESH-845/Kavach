# Buildathon Journey — Implementation Plan

> Executed inline in one session by the author of the spec. Steps use checkbox syntax.
> Every task ends with `make lint`, the relevant tests, and a commit.

**Goal:** Turn Kavach into a judge-ready, deployable product where the buyer→mandate→agent→
governor→evidence→payment→proof journey is experienced through interaction.

**Architecture:** New thin services orchestrate the existing decision machinery (no second
decision engine). Feature UIs are components composed by `/shop`, `/duel`, `/tour`, the
console and the landing page. One Docker image serves everything.

**Tech Stack:** Python 3.11+ / FastAPI / SQLite (WAL) / scikit-learn; Next 16 static export /
React 19 / motion / GSAP / lucide; `qrcode` (npm) for the step-up QR; Razorpay REST +
Standard Checkout (test mode).

**Spec:** `documents/specs/2026-09-04-buildathon-journey-design.md`

## Global constraints
- Amounts are integer minor units named `*_minor`; no float touches money.
- Verdicts come only from `gate.admit`, `decisions.evaluate`, `governor.decide`,
  `proof.scan`, MCP tool functions. New services never decide.
- Errors leave as `{"error": {code, message}}`; no stack traces.
- Frontend invents no data; unreachable API renders an error state.
- Reduced motion honoured (`useStill`), no unbounded polling, no secrets in the bundle.
- `tests/test_site.py` must stay green: `TREE.tests` = `def test` count, `TOOLS` = MCP
  tool set, every chapter id on the page.
- Ruff line length 96; `ruff check pkg/ tests/ apps/` clean; `tsc --noEmit` clean.

---

## Phase 2 — backend services and API seams

### Task 1: storefront service
- Create `pkg/kavach/services/storefront.py`: `MERCHANT`, `CATALOGUE` (list of dicts:
  sku, name, description, category, unit_amount_minor, liquid, review), `PRINCIPAL`,
  `AGENT`, `default_mandate(now) -> dict`, `MODES`, `plan(mandate, mode, *, now) ->
  {"mode", "lines", "untrusted_context", "trace": [str], "label", "expects"}`.
- Test `tests/test_storefront.py`: every mode yields non-empty lines from the catalogue;
  legit plan fits caps and categories; `cap` exceeds per-txn cap; `scope` includes an
  out-of-scope category; `liquid` includes a liquid line; `drift` has untrusted context;
  plan is deterministic. Then an integration assertion: running each mode through
  `gate_service.admit` with the trained model yields the expected verdict family
  (skipped when the model is absent).
- [ ] tests → impl → verify verdicts empirically with the real model → commit.

### Task 2: step-up service
- Create `pkg/kavach/services/stepup.py`: `SCHEMA`, `init(conn)`, `TTL = 600`,
  `create(conn, *, mandate, cart, admission, now) -> dict`, `view(conn, token, now) ->
  dict | None`, `resolve(conn, token, *, action, now, resolver, model) -> dict`,
  `StepUpError(code, message)` with codes `not_found | expired | already_resolved |
  invalid_action | not_step_up | re_admission_refused`.
- Test `tests/test_stepup.py`: create requires STEP_UP; view hides the envelope; approve
  charges the mandate (spent increases) and appends `stepup.approved`; deny appends
  `stepup.denied` and charges nothing; expired → `expired`; repeat same action →
  `applied False`; opposite action → `already_resolved`; unknown token → `not_found`;
  revoked-between → `re_admission_refused`.
- [ ] tests → impl → commit.

### Task 3: checkout service + client additions
- Modify `pkg/kavach/razorpay/client.py`: add `fetch_payment_link(id)`, `fetch_order(id)`,
  `order_payments(order_id)`, `create_order(..., notes)`, `create_payment_link(...,
  reference_id, notes)`; add `verify_checkout_signature(order_id, payment_id, signature,
  secret) -> bool`; extend `_shape` with `plink_`/`order_` (already) — verify.
- Create `pkg/kavach/services/checkout.py`: `SCHEMA` (`checkouts(order_id PK, cart_id,
  mandate_id, agent_id, amount_minor, link_id, created_at)`), `init`, `available() ->
  (bool, reason)`, `start(...)`, `link(...)`, `confirm(...)`, `status(...)`,
  `preview_verified(events)` (sandbox), `CheckoutError`.
- Test `tests/test_checkout.py`: signature verify vectors; `start` in replay without tape
  → unavailable; with a stub client: start appends `checkout.order.created` with notes
  carrying the admission hash; confirm with bad signature ingests nothing and raises;
  confirm with good signature appends `checkout.signature.verified` (sig_verified=1) and
  the payment as api_response (sig_verified=0) and the fact is `DERIVED_PROBABLE`;
  preview yields `DERIVED_CERTAIN` and is labelled simulated.
- [ ] tests → impl → commit.

### Task 4: duel service
- Create `pkg/kavach/services/duel.py`: `run() -> {"steps": [...], "ungoverned":
  {exposure_minor}, "kavach": {exposure_minor, protected_minor}, "sandbox": {...}}`
  reusing `scenarios._sandbox`, `_payment`, `_refund` (import them; make them public
  aliases if needed), storefront plans for inbound steps.
- Test `tests/test_duel.py`: both lanes agree on the legit step; ungoverned exposure ==
  sum of amounts Kavach refused/held + allowed; kavach exposure counts only ALLOWs;
  deterministic across runs; steps carry verdicts from the real code.
- [ ] tests → impl → commit.

### Task 5: tamper service
- Create `pkg/kavach/services/tamper.py`: `demo(conn, *, seq=None, limit=12) -> {"before",
  "after", "target": {seq, field, original, mutated}, "rows": [...]}`.
- Test `tests/test_tamper.py`: live conn unchanged after demo (scan ok, hashes equal);
  after-status broken at the chosen seq; rows after the break carry `verified False`.
- [ ] tests → impl → commit.

### Task 6: MCP registry, HTTP dispatch, toolsets, read-only
- Modify `pkg/kavach/mcp/server.py`: `TOOLS: dict[str, Callable]`, `TOOLSETS`,
  `WRITE_TOOLS`, connection `same_thread=False`, `LOCK`, new tools
  `create_payment_link`, `fetch_payment_link`, `create_order`, `fetch_order`,
  `configure(toolsets, read_only)`, argparse in `main()`.
- Test `tests/test_mcp_http.py` (function-level, monkeypatched module globals to a temp
  DB): `TOOLS` matches decorated names; `configure(read_only=True)` removes write tools
  and sets `allow_write=False`; toolset filtering; `dispatch("check_refund", {...})`
  returns the dry-run shape; unknown tool → `KeyError`.
- Update `web/lib/data.ts` TOOLS to the new set.
- [ ] tests → impl → commit.

### Task 7: demo seed as a service, reset, health, metrics, rate limit, request id
- Create `pkg/kavach/services/demo.py` with `seed(db_path, *, reset=True, now=None)`
  (moved from `apps/demo_data.py`; the app becomes a CLI shim). Also `reset_demo(conn)`
  helper used by the API.
- Create `pkg/kavach/services/ratelimit.py`: `Bucket(rate_per_min)`, `allow(key) -> bool`.
- Modify `apps/api_server.py`: init `stepup`/`checkout` schemas in `_open`; endpoints:
  `GET /api/storefront`, `POST /api/storefront/plan`, `POST /api/stepup`,
  `GET /api/stepup/{token}`, `POST /api/stepup/{token}/resolve`, `POST /api/checkout`,
  `POST /api/checkout/{order_id}/link`, `POST /api/checkout/confirm`,
  `GET /api/checkout/{order_id}`, `POST /api/webhooks/razorpay`, `GET /api/duel`,
  `POST /api/proof/tamper`, `GET /api/mcp/tools`, `POST /api/mcp/{tool}`,
  `POST /api/demo/reset`, `GET /api/metrics`; health extension; request-id middleware;
  rate limiting.
- Test `tests/test_api_journey.py` with `fastapi.testclient.TestClient` against a temp
  DB (monkeypatch `KAVACH_DB` before import via `importlib.reload`): every endpoint's
  happy path in replay mode, invalid inputs → 422 envelope, unknown stepup → 404, reset
  gated by `KAVACH_DEMO`, rate limit → 429, webhook without secret → 401, metrics text.
- [ ] tests → impl → commit.

## Phase 3–11 — frontend

### Task 8: shared journey store + API types
- Create `web/lib/journey.ts` (store with `useSyncExternalStore`, sessionStorage persist,
  actions: setMandate, setPlan, setAdmission, setStepUp, setCheckout, reset).
- Modify `web/lib/api.ts`: types + endpoints for storefront, stepup, checkout, duel,
  tamper, mcp, demo, health additions.
- [ ] `tsc` → commit.

### Task 9: Kavach Bazaar (`/shop`)
- Create `web/app/shop/page.tsx`, `web/app/shop/bazaar.css`, components under
  `web/components/bazaar/`: `Journey.tsx`, `Storefront.tsx`, `MandateCard.tsx`,
  `AgentActivity.tsx`, `CartPanel.tsx`, `Verdict.tsx`, `StepUpPanel.tsx`,
  `CheckoutPanel.tsx`, `TruthPanel.tsx`, `ScenarioBar.tsx`.
- Install `qrcode` + `@types/qrcode`.
- [ ] build → manual browser check (Playwright screenshots) → commit.

### Task 10: `/approve` phone page
- Create `web/app/approve/page.tsx` (+ styles in bazaar.css). States: loading, invalid,
  expired, pending (Approve/Deny), approved, denied, already resolved.
- [ ] build → phone-viewport screenshot → commit.

### Task 11: `/duel`
- Create `web/app/duel/page.tsx`, `web/components/duel/Duel.tsx`, `duel.css`.
- [ ] build → screenshot → commit.

### Task 12: tamper on `/dashboard/proof`
- Create `web/components/proof/Tamper.tsx`; mount in proof page.
- [ ] build → screenshot → commit.

### Task 13: `/dashboard/mcp`
- Create `web/app/dashboard/mcp/page.tsx`, `web/components/mcp/McpConsole.tsx`; add nav
  item; `document.title` map.
- [ ] build → screenshot → commit.

### Task 14: `/tour` + finale
- Create `web/app/tour/page.tsx`, `web/components/tour/Tour.tsx`, `Finale.tsx`, `tour.css`.
- [ ] build → screenshot → commit.

### Task 15: landing page
- Modify `web/components/Hero.tsx` (copy, CTAs), add `web/components/JourneyStrip.tsx`,
  mount in `web/app/page.tsx`, update `Handoff.tsx` doors, `Proof.tsx` tools list reads
  `TOOLS`; keep `test_site.py` green.
- [ ] build → tests → commit.

## Phase 12 — deployment
### Task 16
- Create `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `render.yaml`, `fly.toml`,
  `scripts/entrypoint.sh`, `documents/11-deploy.md`; update `.env.example`, `Makefile`
  (`docker-build`, `docker-run` targets; `run` exports `KAVACH_DEMO=1`), README deploy
  section. Verify each build step locally in a clean venv.
- [ ] commit.

## Phase 13–17 — audit, tests, performance, polish, judge run
### Task 17
- Security pass over every new file (checklist in spec §5). Full `make check` minus
  bench (bench once). Lighthouse-style checks with Playwright: bundle sizes, console
  errors, viewports 390/768/1280/1440. Polish pass. Clean-state judge run following
  the tour. Final report.
