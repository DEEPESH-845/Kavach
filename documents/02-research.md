# 02 — Research (verified 23 Aug 2026)

Labels: [V]=verified external fact  [I]=inference  [H]=hypothesis

## The thesis is externally corroborated — this is not a student's theory
[V] Finextra/Boboev, "hidden liability of agentic commerce": payments now originate in
    "external LLMs, personal assistants, and procurement bots... You are now forced to
    trust a software agent you did not build and cannot inspect." (shifting trust perimeter)
[V] Industry write-ups of the exact failure: "A user submits payment at 2:47 PM. The agent
    returns a success confirmation. The transaction never completes. No error is thrown."
[V] "An agent cannot interpret 'Please try again later' — it needs a code like
    soft_decline:issuer_unavailable:retry_after_300s."
[V] "Current architectures provide no principled mechanism to detect or reason about
    such inconsistencies [stale/misleading tool output]."
=> The gap Kavach targets is documented 2026 industry consensus, not an invented problem.

## Razorpay's own docs prove ack != truth
[V] razorpay.com/docs/payments/refunds: 5-10 business days to reflect in customer account.
[V] "Usually, Razorpay moves a refund to the processed state before receiving the ARN/RRN
    from the Gateway."  <- even Razorpay's terminal-looking status is not proof of credit.
[V] Docs advise: if a critical flow needs instant status and the webhook has not arrived,
    perform an immediate API fetch.  <- Razorpay already acknowledges the belief/truth gap
    and pushes resolution onto the integrator. Agents are integrators that do not do this.

## What Razorpay already ships (overlap audit)
[V] MCP server: 35+ tools; flags --read-only and TOOLSETS/--toolsets.
    => COARSE permission scoping EXISTS. Do not pitch read-only mode as novel.
    [I] Tools map 1:1 to API endpoints; no canonical-state or confidence layer documented.
[V] Agent Studio guardrails blog — 9 principles, and they apply ONLY to marketplace-published,
    Razorpay-certified agents ("Every agent published to the Agent Studio marketplace goes
    through Razorpay's validation process"). Covers: merchant control of actions/approvals,
    no price invention, action validation, consent, "every action is logged with a full
    audit trail." NOT addressed anywhere in the published principles: approval tiers,
    spend caps, idempotency, duplicate-action prevention, reversibility windows,
    asynchronous/pending state handling.  <- the four gaps Kavach occupies, sourced.
[V] Idempotency EXISTS on Payouts, Direct Transfers, and BOTH Normal and Instant Refunds.
    Merchant-generated key, safe retry within 7 days, body must match.
    => Kill any pitch line implying Razorpay lacks idempotency. See ADR-008.
[V] Sprint 2026 agent surface (each one is an agent holding a money tool, none certified
    by Agent Studio): Payments on LLMs, Razorpay for ChatGPT Apps, Voice Payments,
    Razorpay Dashboard on Claude, Agentic Dashboard, Remote MCP, Razorpay Node for n8n,
    Razorpay x Replit, CLI. Plus Agentic Business Banking: Payouts / Bookkeeping /
    Reporting / Receivables / Insights agents, and a Payroll Approvals Agent.
[V] Vulcan (18 Aug 2026): transformer, ~3T data points / 4B payments, NVIDIA+AWS.
    Public functions: routing, fraud, risk assessment, checkout personalisation.
    8-10% success-rate lift over 1.5M txns / 50k merchants. All PRE-authorisation.
    ADR-002 holds: no public inference API, nothing to build against.

## Competitive landscape — who else is solving this
[V] AP2 (Google): Intent Mandate + Cart Mandate, W3C VCs, JSON-LD, ECDSA P-256 + SHA-256.
    Proves a human authorised an action. Says NOTHING about whether the money moved.
[V] Stripe: Restricted API Keys scope WHICH calls, explicitly not HOW MUCH — "An agent with
    payment_intents:write can create unlimited payment intents of any amount."
[V] Open issues on stripe/ai: #356 governance layer (spend limits, allowlists, audit trail),
    #320 RFC cryptographic signing + spend limits. Unsolved, publicly.
[V] Agent Passport (Apache 2.0): 4-gate preflight = passport valid, scope authorised,
    budget remaining, merchant allowlist; signed receipts.
[V] Stripe Issuing for Agents / Mastercard Agent Pay: scoped virtual cards, spend limits,
    merchant allowlist, auto-expiry.
[V] Temporal-style durable execution: exactly-once activity execution, checkpointing.

CONCLUSION — the crowded half vs the empty half:
  CROWDED: authorisation proof (AP2), spend bounding (Issuing/passports/RAKs), coarse
           tool scoping (Razorpay --read-only), replay-safety (idempotency keys, Temporal).
  EMPTY:   reconciling an agent's BELIEF with delayed financial TRUTH, and detecting a
           SEMANTICALLY NEW intent that is financially a duplicate of an in-flight one.
  Every gate in Agent Passport's preflight passes a second ₹5,000 refund inside a ₹50,000
  daily cap. AP2 signs it. Idempotency keys do not fire — the agent generated a new key
  because it formed a new intent. Temporal is exactly-once WITHIN a workflow it controls;
  the duplicate here is cross-session, cross-agent, cross-workflow.
  [I] This is the defensible core. Lead with it. See ADR-009.
