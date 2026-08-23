# 03 — Razorpay Capability Map  (VERIFIED EXTERNAL FACT unless noted)

| Capability | Product | Solves | AI? | Vulcan rel. | Remaining gap | Class |
|---|---|---|---|---|---|---|
| Routing | Vulcan hyper-precision routing | best path per txn | yes | IS Vulcan | confidence not exposed | RED |
| Fraud | Vulcan network-level fraud | pre-auth fraud | yes | IS Vulcan | tail cost weighting | RED |
| RTO | RTO Shield / RTO Insights / Vulcan | COD risk | yes | IS Vulcan | ring-level decisions | RED |
| Checkout | Vulcan predictive personalisation | UPI app preference | yes | IS Vulcan | — | RED |
| Subscriptions | Subscription Recovery agent | failed mandate retry | yes | adjacent | pre-failure prediction | RED |
| Recovery | Intelligent Retry Engine | failed debit nudges | yes | adjacent | incrementality | RED |
| Disputes | Dispute Responder | evidence submission | yes | adjacent | fight-or-fold EMV | ORANGE |
| Settlement | Settlement Insights | daily digests | yes | none | rupee-level gap attribution | ORANGE |
| Reconciliation | RazorpayX Bookkeeping/Reporting | ERP entries | yes | none | guaranteed error bounds | ORANGE |
| Agentic payments | UPI Circle + Reserve Pay + Claude/ChatGPT | consumer agent checkout | yes | none | bounds SPEND, not ACTION SEMANTICS | **BLUE** |
| MCP / CLI | Remote MCP 2.0, CLI | agent tool access | no | none | has `--read-only` + TOOLSETS (coarse scoping); **no canonical truth, no confidence, no dup detection** | **BLUE** |
| Agent Studio | marketplace + builder | building agents | yes | none | 9 published guardrails, but **only for certified marketplace agents**; silent on approval tiers, spend caps, idempotency, dup prevention, async state | **BLUE** |
| RazorpayX payouts | Payouts Agent | payouts + TDS | yes | none | write-ahead intent log, approval tiers | GREEN |
| Onboarding | Agentic Onboarding | KYC | yes | none | txn laundering post-onboarding | YELLOW |

BLUE = high-criticality whitespace with strong AI + Razorpay fit. The winner lives here.

CORRECTION (23 Aug, verified): the earlier reading that Agent Studio "bounds NOTHING" and that
MCP has no controls was wrong. Agent Studio publishes 9 guardrails; MCP ships --read-only and
toolset filtering. Both are real. Neither reaches the async-truth or semantic-duplicate layer,
and Agent Studio's scope stops at certified marketplace agents -- which excludes Dashboard on
Claude, ChatGPT Apps, Voice Payments, n8n, Replit, CLI and every custom MCP client.
See docs/02-research.md for sources.
