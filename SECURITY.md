# Security

Kavach sits in the path of money movement. Treat every item here as load-bearing.

## Reporting

Open a private security advisory on this repository. Do not file a public issue for
anything that touches credentials, signature verification, or the policy engine.

## Trust boundaries

| Boundary | Control |
|---|---|
| Inbound webhooks | HMAC-SHA256 over the **raw** body, constant-time compare, fail closed on a missing secret. An unverified webhook is never written as `sig_verified` evidence and can therefore never raise a fact to `DERIVED_CERTAIN`. |
| Outbound Razorpay calls | Basic auth from env only. Keys are never logged, never persisted to the event log, never returned by an MCP tool. |
| Agent -> MCP tools | Every money-moving tool routes through the governor. There is no code path from a tool call to `create_refund` that skips `governor.decide`. |
| Model -> decision | The risk model may only widen caution (ADR-006). No score, however low, unlocks a cap, an invariant, or a permission tier. |

## Credentials

`.env` is gitignored; `.env.example` is committed in its place. This repository is intended
to be public, so:

- Use test-mode keys (`rzp_test_...`) only. Nothing here should ever hold a live key.
- Rotate any key that has appeared in a terminal transcript, a screen recording, or a demo
  video. Test-mode keys still address a real account.
- The webhook secret is separate from the API key and must be set for signature
  verification to pass at all.

## Known limits

- SQLite is single-writer. Fine for the evaluation and demo; not a production ingest path.
  See ADR-013 for the stated ceiling and the swap.
- The duplicate-risk model is trained on a synthetic corpus with a stated 12% duplicate base
  rate. It is not calibrated against production traffic and its thresholds should be refit
  before any real deployment.
- Prompt injection reaching an agent is out of scope for the model, and deliberately so: the
  governor's invariants hold regardless of what an agent was persuaded to ask for. That is
  the point of putting them below the model rather than inside the prompt.
