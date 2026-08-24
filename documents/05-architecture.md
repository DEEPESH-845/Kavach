# 05 — Architecture

Kavach is one system facing two directions, because agents now stand on both sides of a
merchant's counter. Buyer-side agents arrive at checkout holding a delegated mandate.
Operator-side agents sit inside the merchant's own dashboard moving money out. The failures
are different; the discipline is the same.

    INBOUND · Gate                                    OUTBOUND · Rail
    is this agent allowed to be here,                 is this action a duplicate of
    and is this cart what was delegated?              money already in flight?

## The shared spine

Both directions derive everything from one append-only event log. Not two, and the choice is
load-bearing (ADR-016): one log means one evidence chain, one replay path, and one thing for
the proof plane to wrap. A fact with no event behind it is structurally impossible rather
than merely discouraged.

    ┌──────────────────────────── eventlog.py ────────────────────────────┐
    │  append-only, idempotent on (source, external_id), causal ordering  │
    └─────────────────────────────────────────────────────────────────────┘
      gate/envelope.py    Ed25519, nonce, window     truth.py     rail vs obligation
      gate/mandate.py     scope, caps, revocation    ledger.py    open obligations
      intelligence/entailment.py  purpose ⊨ cart     intelligence/model.py  duplicate risk
      gate/admission.py   expected-loss verdict      governor.py  authority ladder
    ┌──────────────────────────── mcp/server.py ──────────────────────────┐
    │       nine tools; Razorpay-compatible names, fact-shaped returns    │
    └─────────────────────────────────────────────────────────────────────┘

## The determinism gradient

The layering order is also an ordering by how much a component can be trusted to be right.
Nothing below a layer may import anything above it, and the rule is enforced socially in
CONTRIBUTING.md rather than mechanically.

| Layer | Guarantee | If it is wrong |
|---|---|---|
| event log | records what was observed | nothing else can be believed |
| truth / envelope | pure functions of events and bytes | a fact is misstated; provable from the log |
| ledger / mandate | arithmetic over derived facts | a cap is miscounted; recomputable |
| intelligence | learned, advisory | a score is wrong; may only widen caution |
| governor / admission | policy | the wrong action is taken, with reasons attached |

The learned components sit second from the top on purpose (ADR-004). They produce a score.
They never determine state, amount, authorisation or admission.

## Inbound data flow

    agent → verify_agent(envelope, signature, key_id)
              signature over RAW BYTES, before parsing        → typed failures, nonce untouched
    agent → admit_cart(envelope, signature, cart)
              1  envelope.verify      forged/expired/replayed/revoked  → DENY
              2  mandate.admissible   merchant, category, both caps    → DENY
              3  entailment.score     purpose ⊨ cart?                  → risk
              4  admission.decide     argmin expected loss             → ALLOW | STEP_UP | HOLD | DENY
              5  on ALLOW only        record_admission → charges the cumulative cap

Steps 1 and 2 are arithmetic and cannot be argued with by step 3. Step 3 is the only path to
ALLOW: the deterministic layers cannot tell whether an in-scope, in-budget cart is what the
principal asked for, which is the entire reason this plane exists.

## Outbound data flow

    agent → create_refund(payment_id, amount, reason)
              1  eventlog             every API response ingested as an event
              2  truth.derive         rail state and obligation state, separately
              3  ledger               open obligations + prior intents on this payment
              4  intelligence.model   is this the same obligation already in flight?
              5  governor.decide      invariants → tier → confidence → risk → caps
              6  governor.execute     write-ahead intent, act, settle

## What is real and what is not

| Surface | Status |
|---|---|
| Orders, Payments, Refunds, webhooks + HMAC | **Real**, test mode |
| `X-Refund-Idempotency` on every refund write | **Real** |
| Razorpay MCP tool-name parity | **Real** |
| NPCI UAP agent registry | **Mocked** — no public API as of Aug 2026; mapping documented |
| UPI Reserve Pay agent mandate | **Mocked** — Ed25519 envelope stands in; mapping documented |
| Storefront and buyer agents | **Simulated by design** — this is a bench, not traffic |

## Stated ceilings

- **SQLite is single-writer.** Correct for the evaluation and the demo, not a production
  ingest path. The log is written behind one `append()` call, so the swap is a connection
  string (ADR-013).
- **Cumulative spend is recomputed, not counted.** A scan per decision, chosen because a
  second copy of a derived number drifts silently. It is the wrong trade above demo scale
  and the right one below it (ADR-016).
- **Entailment is lexical.** TF-IDF cannot bridge synonymy: "single malt" does not match
  "whisky". Quantified in `07-evals.md` and the reason ADR-017 keeps an LLM path open.
