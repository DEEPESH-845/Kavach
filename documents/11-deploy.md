# 11 · Deploying Kavach

One image, one process, one port. The static export is served by the same FastAPI process
that decides, so there is no second service and no CORS. This document is the whole
procedure; nothing here is aspirational.

## What the image contains and how it is built

`Dockerfile` is two stages:

1. `node:22-alpine` runs `npm ci` and `next build`, producing `web/out`.
2. `python:3.12-slim` installs the package, **trains both estimators from their seeded
   corpora and runs both benchmarks** (~30 s), copies the export in, and starts
   `scripts/entrypoint.sh`.

The model artefacts (`data/*.pkl`) are gitignored on purpose; an image that exists has
therefore reproduced the benchmark numbers in `evals/*.json`, and a model that stops
beating its baselines fails the build.

`entrypoint.sh` seeds the demo ledger when `$KAVACH_DB` does not exist (or when
`KAVACH_SEED_ON_START=1`), then runs `python apps/api_server.py --host 0.0.0.0 --port $PORT`.

## Environment variables

| Variable | Required | Default | Effect |
|---|:--:|---|---|
| `RAZORPAY_KEY_ID` | for payments | unset | Razorpay **test** key (`rzp_test_…`). A live key is refused by checkout. |
| `RAZORPAY_KEY_SECRET` | for payments | unset | Verifies the Checkout handler signature server-side; never reaches the browser. |
| `KAVACH_MODE` | for payments | `replay` | `live` reaches the Razorpay API. `replay` never leaves the machine; checkout reports itself unavailable. |
| `RAZORPAY_WEBHOOK_SECRET` | no | unset | Verifies `X-Razorpay-Signature`. Unset ⇒ every webhook is refused (fail-closed) and polled payments stay `DERIVED_PROBABLE`. |
| `KAVACH_DB` | no | `/data/kavach.db` (image) | The event log: a SQLite path (mount a disk at its directory to persist) or a `postgresql://` URL. The image includes the driver; elsewhere `pip install 'kavach[postgres]'`. |
| `KAVACH_WORKERS` | no | `1` | uvicorn worker processes. Every request opens its own connection, so more than one is safe on either store. |
| `KAVACH_DEMO` | no | `0` (image) | `1` mounts the demo surfaces (storefront, duel, lab, tamper, console MCP, `POST /api/demo/reset`) and turns API keys off by default. compose/Render/Fly/Railway set it for the demo. |
| `KAVACH_AUTH` | no | `required`, or `off` when `KAVACH_DEMO=1` | Whether `/api` demands `Authorization: Bearer kv_…`. See *Authentication* below. |
| `KAVACH_METRICS_KEY` | no | unset | Locks `/api/metrics` behind a separate scrape secret (bearer or `?key=`). |
| `KAVACH_POLICY` | no | unset (compiled defaults) | Path to a TOML policy file: caps, thresholds, Gate economics, per-agent tiers, rate limit, CORS. See *Policy file* below. |
| `KAVACH_SEED_ON_START` | no | unset | `1` re-seeds on every start. |
| `KAVACH_KILL_SWITCH` | no | unset | Suspends autonomous money movement (every refund intent goes to a human). |
| `KAVACH_CORS_ORIGINS` | no | unset | Comma-separated extra browser origins allowed to call the API, e.g. `https://kavach-three-rust.vercel.app` when the UI is hosted on Vercel with `NEXT_PUBLIC_KAVACH_API` pointing here. Same-origin deploys need none. |
| `KAVACH_RATE_LIMIT` | no | `60` | Per-client requests/minute on step-up, checkout, MCP, reset, tamper, webhook routes. |
| `PORT` | no | `8000` | Set by Render and Cloud Run; honoured by the entrypoint. |

`.env.example` is the annotated copy of this table.

## Persistence, honestly

**Postgres.** Set `KAVACH_DB=postgresql://user:pass@host:5432/kavach`. Every table is
created on first start, the schema is versioned in `schema_migrations`, and writers
serialise on one advisory lock so the hash chain has exactly one head. This is the
configuration for more than one node or more than one worker; nothing else changes. Back it
up with `pg_dump` like any other database.

**SQLite.** In WAL mode it is the one writer. On a **mounted disk** (`/data`) the ledger, the
step-up tokens and the checkouts survive restarts and deploys. On **ephemeral storage** the
container starts from the seed every time it starts — the demo still works, but a judge's
earlier session is gone. Say which you have:

- Render `disk`, Fly `[mounts]`, Docker `-v kavach-data:/data`: durable.
- Cloud Run without a volume, or any free tier without disks: ephemeral. Set
  `KAVACH_SEED_ON_START=1` so a restart is at least a *known* state.

Demo state (`stepups`, `checkouts`) and evidence semantics (the hash chain over `events`)
live in the same file but are separated by table; a reset re-creates both from the seed,
deterministically, with the wall clock of the moment it runs.

## Procedures

### Render (one URL, fastest)
1. New → **Blueprint** → this repository. `render.yaml` declares the service, the 1 GB disk
   at `/data`, and three secrets marked `sync: false`.
2. Enter `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (test mode) and, optionally,
   `RAZORPAY_WEBHOOK_SECRET`.
3. Deploy. Health check is `/api/health`. The public URL is the demo: `/tour`, `/shop`,
   `/duel`, `/dashboard`.

### Railway (this is what the live URL runs)
`railway.json` declares the Dockerfile build, `/api/health` as the healthcheck, and
`ON_FAILURE` restarts (the Trial and Free plans don't allow `ALWAYS`).

```bash
railway login                       # opens a browser; new accounts get a 30-day/$5 trial,
                                     # no card required (verify with GitHub for full network access)
railway init --name kavach          # create the project
railway add --service kavach        # create the service, then link it:
railway service kavach
railway volume add --mount-path /data   # persists kavach.db across deploys (500 MB on Trial)
railway variables --set KAVACH_MODE=replay \
                  --set KAVACH_TRUST_PROXY=1 \
                  --set KAVACH_DEMO=1 \
                  --set KAVACH_DB=/data/kavach.db   # Railway's edge is the only path in
railway up --ci                     # builds the Dockerfile and deploys, streaming the log
railway domain                      # generates the public *.up.railway.app URL
```

`railway volume add` takes no `--service`; link the service first, as above.

For a real payment, add the same three secrets as Render/Fly:
```bash
railway variables --set RAZORPAY_KEY_ID=rzp_test_… --set RAZORPAY_KEY_SECRET=…
railway variables --set RAZORPAY_WEBHOOK_SECRET=…    # optional, see below
railway variables --set KAVACH_MODE=live
```
Set the Razorpay webhook URL to `https://<service>.up.railway.app/api/webhooks/razorpay`.

Railway's Trial/Free volume storage cap is 0.5 GB — comfortably above what a demo SQLite
ledger needs. An unverified Trial account is network-restricted (limited egress/ports),
which can block the outbound call to Razorpay's API in `live` mode; connect GitHub at
`railway.com/verify` to lift that before switching out of `replay`.

### Fly.io
```bash
fly launch --copy-config --no-deploy
fly volumes create kavach_data -s 1 -r bom
fly secrets set RAZORPAY_KEY_ID=rzp_test_… RAZORPAY_KEY_SECRET=… KAVACH_MODE=live
fly deploy
```

### Cloud Run
```bash
gcloud run deploy kavach --source . --region asia-south1 --allow-unauthenticated \
  --set-env-vars KAVACH_MODE=live,KAVACH_DEMO=1,KAVACH_SEED_ON_START=1 \
  --set-secrets RAZORPAY_KEY_ID=…,RAZORPAY_KEY_SECRET=…
```
Cloud Run's filesystem is ephemeral; see above.

### Plain Docker / Compose
```bash
docker compose up --build            # http://127.0.0.1:8000, credentials from .env
# or
docker build -t kavach . && docker run -p 8000:8000 -v kavach-data:/data --env-file .env kavach
```

## Turning on verified webhooks (the truth upgrade)

Razorpay Dashboard → Settings → Webhooks → **Add**:

- URL: `https://<your-host>/api/webhooks/razorpay`
- Events: `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`
- Secret: any string; set the same value as `RAZORPAY_WEBHOOK_SECRET` and restart.

From then on a payment made in the Bazaar is observed twice — once by the API fetch
(`DERIVED_PROBABLE`) and once by the signed webhook (`DERIVED_CERTAIN`) — and the truth
panel shows the upgrade for real rather than as the labelled preview.

## Authentication: API keys, and what is public

Outside a demo (`KAVACH_DEMO` unset or `0`, which is the image default) every `/api` route
needs `Authorization: Bearer kv_…`. Keys carry one of three scopes, ordered:

| Scope | May call |
|---|---|
| `readonly` | every GET: overview, stream, intents, entities, truth, proof, agents, policy, evaluations |
| `agent` | + `POST /api/gate/admit`, `POST /api/governor/evaluate`, `POST /api/stepup` |
| `operator` | + review actions, `/api/keys`, and everything a later phase adds for operators |

Mint the first key on the host (no server needed; `--db` takes the same path or URL as
`KAVACH_DB`):

```bash
python -m kavach keys create --name ops --scope operator      # prints the key ONCE
python -m kavach keys list
python -m kavach keys revoke key_…
```

Only a SHA-256 of the key is stored. The console keeps an operator's key in the browser
(Settings → Connect) and sends it on every request; the Access page mints and revokes
keys for the rest of the team. Who approved or rejected an escalation is recorded from the
key's name, not from anything the client typed.

`KAVACH_AUTH=off` forces keys off (a demo does this by default); `KAVACH_AUTH=required`
forces them on even in a demo. `KAVACH_METRICS_KEY` locks `/api/metrics` for a scraper
with a separate secret that opens nothing else.

**Public by design** — the credential is something other than a key:

- `/api/health` (no secrets in it), `/api/metrics` (unless locked as above)
- `/api/webhooks/razorpay` — the HMAC signature is the credential; fail-closed
- `/api/stepup/{token}` view and resolve — the 192-bit single-use token is the credential
- `/api/checkout/{order_id}` status, `/link`, `/confirm` — the paying browser's side, keyed
  by a Razorpay order id and verified with the key secret server-side. Anyone holding an
  `order_…` id can read that checkout's status; order ids are not guessable and carry no
  personal data, but they are not a secret either

**Demo-only** — a 404 outside `KAVACH_DEMO=1`: the storefront and buyer agent, the duel,
the Adversary Lab scenarios, the tamper demonstration, the console's MCP dispatcher, and
`POST /api/demo/reset` (it deletes the ledger). Agents still reach the MCP tools over
stdio with `kavach-mcp-server`.

Also before this sits in front of a real ledger:

- Put the console behind an identity proxy (Cloudflare Access, IAP, your own SSO) if you
  want people, not just keys, in the audit trail of who opened it.
- Set `KAVACH_TRUST_PROXY=1` only once something in front of you actually sets
  `X-Forwarded-For`; until then the rate limiter keys on the socket peer, which cannot be
  spoofed by a header.

The controls that are NOT relaxed for the demo: webhook HMAC is fail-closed, the checkout
signature is verified with the secret server-side, policy limits are compiled in with no
endpoint that edits them, a step-up token is 192 random bits with a ten-minute life, and
the tamper demonstration writes only to an in-memory copy.

## Policy file

`KAVACH_POLICY=/etc/kavach/kavach.toml` points at a copy of `kavach.example.toml`. Every
key is optional and defaults to the compiled-in value; an unknown key or a wrong type
refuses to start and names the field. The file is re-read when its mtime changes (one
`stat` per request); a file that becomes invalid while running keeps the last good
settings and logs the error rather than widening a limit or taking the API down.

| Section | Keys | Effect |
|---|---|---|
| `[limits]` | `max_auto_refund_minor`, `session_cap_minor`, `daily_cap_minor`, `risk_threshold`, `kill_switch` | The governor's caps. `risk_threshold` overrides the trained model's frozen threshold; omit it to use the model's. `KAVACH_KILL_SWITCH=1` in the environment always wins over `kill_switch`. |
| `[gate]` | `fraud_loss_share`, `margin_share`, `step_up_minor`, `hold_minor`, `step_up_catch_rate`, `hold_catch_rate` | The inbound gate's expected-loss economics. Every rate is a stated assumption reported beside each verdict. |
| `[agents]` | `"<agent_id>" = "readonly" \| "agent"` | Per-agent tier. A `readonly` agent is refused money movement by the governor's permission tier, whatever tools it holds. |
| `[server]` | `rate_limit_per_minute`, `cors_origins` | The API's own limits. `KAVACH_RATE_LIMIT` and `KAVACH_CORS_ORIGINS` in the environment add to these. |

There is no API that edits the file. `GET /api/policy` reports its path and every value in
force; the console's Governor page shows the same.

## Real mandates: a principal signs, Kavach verifies

Outside a demo Kavach signs nothing. A principal (the human delegating to an agent) holds an
Ed25519 key; the merchant registers its public half; the agent presents mandates the
principal signed. Four steps:

```bash
# 1. On the principal's device: a keypair. Keep private_key_b64 there.
python -m kavach principal keygen
#    {"key_id": "prin_…", "public_key_b64": "…", "private_key_b64": "…"}

# 2. On the merchant's side: trust the public half (either form).
python -m kavach issuers add --key-id prin_… --public-key <public_key_b64>
curl -X POST https://<host>/api/issuers -H "Authorization: Bearer kv_operator_…" \
     -H "Content-Type: application/json" \
     -d '{"key_id": "prin_…", "public_key_b64": "…"}'

# 3. On the principal's device: sign a mandate (the fields MandateRequest lists).
python -m kavach principal sign --private-key <private_key_b64> --key-id prin_… mandate.json
#    {"raw_b64": "…", "signature_b64": "…", "key_id": "prin_…"}

# 4. The agent presents it at admission, unchanged.
curl -X POST https://<host>/api/gate/admit -H "Authorization: Bearer kv_agent_…" \
     -H "Content-Type: application/json" \
     -d '{"envelope": {"raw_b64": "…", "signature_b64": "…", "key_id": "prin_…"},
          "cart_id": "cart_1", "merchant_id": "bazaar", "lines": [...], "commit": true}'
```

The signature is verified over the exact bytes in `raw_b64`; tampering with a single byte
is `BAD_SIGNATURE`, an unregistered `key_id` is `UNKNOWN_ISSUER`, and a spent nonce is
`REPLAYED_NONCE` — including on `/api/gate/inspect`, which never spends one. Step-up stores
the signed bytes and re-verifies them at the moment of approval. `DELETE /api/issuers/{id}`
stops trusting a key; mandates it signed fail `UNKNOWN_ISSUER` from then on, and nothing
already admitted is rewritten.

The `mandate` body form — where the server signs as a demo principal — is refused with
`demo_signing_disabled` unless `KAVACH_DEMO=1`, and the demo issuer is never registered on a
production ledger.

## Verifying a deployment

```bash
curl https://<host>/api/health        # mode, credentials, webhook, models, chain, mcp
curl https://<host>/api/metrics       # Prometheus text
```

Then the five-minute path: `/tour` → **Start**. It resets the ledger (if `KAVACH_DEMO=1`),
so every judge starts from the same state.

## What has actually been built and run

Docker is not installed on the development machine, so the image was first built by
**Railway's builder** — which is now the live deployment:

**<https://kavach-production-0363.up.railway.app>** · `/tour` `/shop` `/duel` `/dashboard`

`KAVACH_MODE=live` against Razorpay **test** keys, a 500 MB volume at `/data`,
`KAVACH_TRUST_PROXY=1`, `KAVACH_DEMO=1`, no webhook secret (so webhooks stay fail-closed and
polled payments stay `DERIVED_PROBABLE` — see above to turn that on).

Verified against that deployment, not asserted: every read endpoint and every exported page;
a real Razorpay TEST order created from the admitted cart; the step-up path minted, approved
on the token and charged; all four attack carts DENIED; all eleven adversary scenarios HELD;
the MCP duplicate-refund demo escalated without money moving; the hash chain intact after
the tamper demonstration; and every console route rendered in a real browser with no console
errors and live data on screen.

### One Railway-specific constraint

Railway refuses a Dockerfile that declares `VOLUME` (`dockerfile invalid: docker VOLUME at
Line N is not supported, use Railway Volumes`). The instruction has been removed — every
target mounts `/data` explicitly anyway (compose names the volume, `docker run -v`, Fly
`[mounts]`, a Render disk), so nothing else changes.

`railway.json` is Railway's deprecated Config-as-Code and keeps working until 2026-12-01;
`railway config migrate --apply` writes the `.railway/railway.ts` replacement when that
matters.
