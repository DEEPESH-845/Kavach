# Kavach production readiness — design

Date: 2026-09-13. Status: approved in conversation.

## Goal

Take Kavach from "one-image demo a judge can drive" to "a single merchant can run this in
front of a real ledger": every endpoint authenticated, mandates genuinely signed by
principals, policy configurable without a code change, Postgres behind the same event log,
step-up reaching a principal without a QR, and the operational surface (logs, metrics,
reconciliation, backups) an SRE expects. Fix every bug found on the way, backend and UI.

Decisions taken: single-tenant self-host; API keys for agents/operators with an identity
proxy in front of the console; Postgres via a thin dialect shim; all four feature areas in
scope (mandate issuance, policy config, step-up channels, observability).

Out of scope: multi-tenancy, `/api/v1` prefix, built-in password/OIDC login.

## Phase 0 — bug fixes (first, and throughout)

Audit backend and console against the current build. Each defect gets a root-cause fix and
one regression test. Known at design time:

- `eventlog.append` opens a deferred SAVEPOINT; under concurrent writers the second append
  fails `SQLITE_BUSY_SNAPSHOT` instead of serialising. Fix: outermost transaction is
  `BEGIN IMMEDIATE` (SQLite) / advisory lock (Postgres), nested is SAVEPOINT.
- `kavach.mcp.server` opens its DB connection and Razorpay client at import time; breaks
  multi-worker deploys and ties the HTTP dispatcher to one connection. Fix: per-call
  connection via the shared `db.connect()`.
- `_requests` counter in the API is not thread-safe; CORS omits `Authorization`;
  `KAVACH_DEMO=1` is the image default (destructive reset on by default).
- UI: every screen re-verified against error, empty, loading, 401 and narrow states; copy,
  contrast, focus and keyboard paths fixed where broken.

## 1. Database layer

`kavach/db.py`: `connect(url_or_path)` returns a `Connection` wrapper over `sqlite3` or
`psycopg` (v3) with the same `execute / executescript / fetchone / fetchall` surface the
existing 84 call sites use. It rewrites at execute time: `?` → `%s`, `INSERT OR IGNORE` →
`ON CONFLICT DO NOTHING`, `INSERT OR REPLACE` → `ON CONFLICT (pk) DO UPDATE`, `INTEGER
PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL PRIMARY KEY`, `BLOB` → `BYTEA`, `PRAGMA` → no-op.
`transaction(exclusive=False)` is a nesting-aware context manager. Rows are dict-like in
both backends. `KAVACH_DB` accepts a path (SQLite) or `postgres://…`.

Schema versioning: `schema_migrations(version, applied_at)` and an ordered list of
migrations in `kavach/migrations.py`; `init()` applies what is missing. Existing `CREATE
TABLE IF NOT EXISTS` blocks become migration 1.

Tests run on SQLite always and additionally on Postgres when `KAVACH_TEST_PG` is set; CI
adds a Postgres service job.

## 2. Authentication

Table `api_keys(key_id, key_hash, name, scope, created_at, revoked_at, last_used_at)`.
Key format `kv_<scope>_<random>`; only the SHA-256 hash is stored. Scopes:
`readonly` < `agent` < `operator`.

`Authorization: Bearer <key>`. `KAVACH_AUTH` defaults to `required` unless `KAVACH_DEMO=1`,
in which case it defaults to `off`; either can be forced. Exempt routes: `/api/health`,
`/api/metrics` (optionally `KAVACH_METRICS_KEY`), `/api/webhooks/*` (HMAC),
`/api/stepup/{token}` view/resolve (the token is the credential), `/api/checkout/{order}`
status and `/api/checkout/confirm` (browser side, signature-verified).

Demo surfaces (`/api/storefront*`, `/api/duel`, `/api/scenarios*`, `/api/proof/tamper`,
`/api/demo/*`, `/api/mcp/*` console dispatcher, `/api/checkout` start) return 404 unless
`KAVACH_DEMO=1`. Scope map: GET routes → readonly; gate admit / governor evaluate / stepup
create → agent; review, issuers, keys, policy reload, webhook rejections → operator.

Review actions record `reviewer` from the key's name; the request field is ignored when
auth is on. Bootstrap: `python -m kavach keys create --name ops --scope operator` prints
the key once. `list` and `revoke` subcommands.

Console: `api.ts` sends the stored key; a 401 routes to `/dashboard/settings#connect`,
where the key is pasted and kept in `localStorage`. New `/dashboard/access` page lists keys
and issuers (operator scope) with create/revoke.

## 3. Real mandate issuance

`POST /api/issuers {key_id, public_key_b64}` and `DELETE /api/issuers/{key_id}` (operator).
`POST /api/gate/admit`, `/api/gate/inspect`, `/api/stepup` accept either the existing
`mandate` body (demo only; server signs with the demo key) or
`envelope: {raw_b64, signature_b64, key_id}`, which goes straight to
`admission.admit(raw, sig, key_id)`. With `KAVACH_DEMO≠1` the `mandate` form is refused with
`demo_signing_disabled`. `python -m kavach principal keygen` and `… sign mandate.json`
produce a keypair and a signed envelope for integrators. `issuer.simulated` stays in the
response.

## 4. Policy as config

`KAVACH_POLICY=/path/kavach.toml` (stdlib `tomllib`). Sections: `[limits]`
(`max_auto_refund_minor`, `session_cap_minor`, `daily_cap_minor`, `risk_threshold`
optional override), `[gate]` (`stepup_budget`, cost weights), `[agents."<id>"]`
(`tier = "readonly"|"agent"`), `[server]` (`rate_limit_per_minute`, `cors_origins`).
Validation errors name the field and refuse to start. Re-read when the file's mtime
changes (one `stat` per request, cached). `KAVACH_KILL_SWITCH` env still wins.
`GET /api/policy` reports `source` and the loaded values. No write API.

## 5. Step-up notification channels

`POST /api/stepup` gains `notify: {channel: "email"|"sms"|"whatsapp"|"webhook", to}`.
`kavach/services/notify.py` exposes `send(channel, to, view) -> Delivery`. Adapters:
`email` (stdlib `smtplib`, `KAVACH_SMTP_URL`), `sms`/`whatsapp` (Twilio REST via `urllib`,
`TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM`), `webhook` (`KAVACH_STEPUP_WEBHOOK_URL`, POST JSON,
HMAC header with `KAVACH_STEPUP_WEBHOOK_SECRET`). Sent on a background thread; outcome
(`sent|failed`, provider id, error) is written to `stepups.notify_json` and shown in the
console and in `GET /api/stepup/{token}` for the operator.

## 6. Observability and operations

- JSON log formatter (`KAVACH_LOG_FORMAT=json|text`), one access-log line per request with
  request id, route, status, duration, key name.
- `prometheus_client` registry at `/api/metrics`: request latency histogram by route,
  decisions by action, admissions by verdict, webhooks by outcome, chain-intact gauge,
  step-ups pending.
- Optional extras `kavach[otel]` and `kavach[sentry]`, enabled by
  `OTEL_EXPORTER_OTLP_ENDPOINT` / `SENTRY_DSN`, lazy-imported.
- `webhook_rejections(id, received_at, reason, signature_present, body_sha256)` and
  `GET /api/webhooks/rejections` (operator). Bodies are not stored.
- Reconciler: background thread every `KAVACH_RECONCILE_INTERVAL` seconds (0 = off) and
  `python -m kavach reconcile`.
- `python -m kavach backup <dest>`: SQLite `VACUUM INTO`; Postgres prints the `pg_dump`
  command and exits non-zero.
- `KAVACH_WORKERS` → uvicorn workers; per-request connections make this safe.

## Testing

Every fix and feature lands with tests in the existing suite. The Postgres path runs the
full suite in CI against a service container. The console keeps `tsc --noEmit` and the
static build as its gate, plus a browser pass over every route in error/empty/live/401.

## Phases

1. DB shim, Postgres, concurrency fix, migrations.
2. Auth, demo-gating, image default, console connect + access pages.
3. Policy config, mandate issuance, CLI.
4. Step-up channels.
5. Observability, reconciler, DLQ, backup, workers.
6. Polish: every console screen, docs (`documents/11-deploy.md`, README envelope), CI.

Bug fixes are not a phase: each is fixed where found, with its test, inside the phase that
touches that code.
