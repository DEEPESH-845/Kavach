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
| `KAVACH_DB` | no | `/data/kavach.db` (image) | The event log. Mount a disk at its directory to persist. |
| `KAVACH_DEMO` | no | `1` (image) | Enables `POST /api/demo/reset` and the **Reset demo** button. Set `0` outside a demo. |
| `KAVACH_SEED_ON_START` | no | unset | `1` re-seeds on every start. |
| `KAVACH_KILL_SWITCH` | no | unset | Suspends autonomous money movement (every refund intent goes to a human). |
| `KAVACH_RATE_LIMIT` | no | `60` | Per-client requests/minute on step-up, checkout, MCP, reset, tamper, webhook routes. |
| `PORT` | no | `8000` | Set by Render and Cloud Run; honoured by the entrypoint. |

`.env.example` is the annotated copy of this table.

## Persistence, honestly

SQLite in WAL mode is the one writer. On a **mounted disk** (`/data`) the ledger, the
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

### Railway
`railway.json` declares the Dockerfile build, `/api/health` as the healthcheck, and
`ON_FAILURE` restarts (the Trial and Free plans don't allow `ALWAYS`).

```bash
railway login                       # opens a browser; new accounts get a 30-day/$5 trial,
                                     # no card required (verify with GitHub for full network access)
railway init                        # create/select the project
railway volume add --mount-path /data   # persists kavach.db across deploys
railway variables --set KAVACH_MODE=replay   # or "live" once Razorpay keys are set below
railway variables --set KAVACH_TRUST_PROXY=1 # safe here: Railway's edge is the only path in
railway up                          # builds the Dockerfile and deploys
railway domain                      # generates the public *.up.railway.app URL
```

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

## There is no authentication, deliberately — and what that means

Kavach ships no login. Every screen and every endpoint is open to whoever can reach the
URL. That is right for a demonstration a judge should be able to open and drive, and it is
wrong for anything else. Before this sits in front of a real ledger:

- Put it behind an identity proxy (Cloudflare Access, IAP, your own SSO) — the API is
  stateless, so there is nothing session-shaped to retrofit.
- Set `KAVACH_DEMO=0` so `POST /api/demo/reset` disappears. It deletes the ledger.
- Set `KAVACH_TRUST_PROXY=1` only once something in front of you actually sets
  `X-Forwarded-For`; until then the rate limiter keys on the socket peer, which cannot be
  spoofed by a header.
- Know that anyone holding an `order_...` id can read that checkout's status. Order ids are
  Razorpay's, not guessable, and carry no personal data — but they are not a secret either.

The controls that are NOT relaxed for the demo: webhook HMAC is fail-closed, the checkout
signature is verified with the secret server-side, policy limits are compiled in with no
endpoint that edits them, a step-up token is 192 random bits with a ten-minute life, and
the tamper demonstration writes only to an in-memory copy.

## Verifying a deployment

```bash
curl https://<host>/api/health        # mode, credentials, webhook, models, chain, mcp
curl https://<host>/api/metrics       # Prometheus text
```

Then the five-minute path: `/tour` → **Start**. It resets the ledger (if `KAVACH_DEMO=1`),
so every judge starts from the same state.

## What was and was not verified on the development machine

Docker is **not installed** on the machine this was built on. Every step of the image was
rehearsed in a clean virtual environment instead: `pip install .` from the same file set,
both benchmarks, the seed, the entrypoint boot, `/api/health` and `/api/metrics`. The
`docker build` itself was not executed there; the Dockerfile is deterministic (pinned
bases, `npm ci`, seeded corpora) and every command in it is the one that was run by hand.
