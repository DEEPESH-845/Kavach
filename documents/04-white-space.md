# 04 — Missing Layer

    Layer 1  Payment rails (UPI / cards / NPCI)
    Layer 2  Payment APIs
    Layer 3  Routing
    Layer 4  Vulcan — payment intelligence      [PRE-AUTHORISATION ONLY]
    Layer 5  Agentic Payments (UPI Circle / Reserve Pay)   [bounds SPEND]
    Layer 6  Merchant agents (Agent Studio, MCP, CLI)      [bounds NOTHING]
    Layer 7  >>> THE SEMANTIC + SAFETY CONTRACT BETWEEN AGENTS AND ASYNC MONEY <<<
    Layer 8  Merchant / consumer experience

Layer 7 answers three questions no other layer answers:
  1. WHAT IS TRUE?      canonical state + confidence + evidence   (deterministic)
  2. WHEN WILL IT BE?   calibrated P50/P80/P95 to terminal state  (ML)
  3. WHAT MAY I DO?     bounded, idempotent, audited action        (policy)

Ranked candidates (weights per brief section 32):
  1  Kavach v2 - Agent Financial Truth + Action Governor   89.1   <- WINNER
  2  Delayed Ground-Truth Engine                              79.0   deferred: feasibility
  3  Agent Retry Governor                                     78.4   absorbed into #1
  4  Agent Payment Trust Layer                                77.2   absorbed into #1
  5  Vulcan Shadow                                            74.7   killed: no Vulcan access
  ...
 12  Kavach v1 unchanged                                   54.7   KILLED

Every Vulcan-adjacent candidate scores 9-10 on Vulcan synergy and 3-4 on feasibility,
because we do not have Vulcan. Simulating Vulcan and then measuring regret against our
own simulator is circular. See docs/08-decisions.md ADR-002.
