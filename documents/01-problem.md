# 01 — The Problem

**Tool acknowledgement is not financial truth.**

Razorpay shipped MCP (35-50 tools), a CLI, Agent Studio and Agentic Payments during 2026.
Each of those puts a money-moving tool in an AI agent's hand. Those tools return raw
Razorpay API entities.

    agent: create_refund(payment_id, 500000)
    api:   200 OK  {"id":"rfnd_...", "status":"processing"}
    agent: "Done — I've refunded Rs 5,000."
    truth: the customer has not been credited and may not be for 34 hours.

The agent has conflated an API acknowledgement with a financial outcome. When the
customer complains again, the agent forms a NEW intent ("the refund didn't work, issue
another") and calls the tool again. An idempotency key does not stop this: the key
protects against a REPLAYED request, not a SEMANTICALLY NEW but financially duplicate one.

## Why this gets worse, not better
- Post-authorisation state is genuinely delayed. NPCI: customer chargeback window 45 days;
  beneficiary bank response TAT 15 days; Deemed Credit exists precisely because the
  beneficiary bank's response may never reach NPCI.
- Agents retry by default. Retry heuristics are correlated across agents.
- Vulcan (18 Aug 2026) is a PRE-authorisation model: routing, fraud, RTO, checkout.
  Post-authorisation truth is not among its publicly claimed functions.

## Evidence labels used across these docs
SOURCE FACT | VERIFIED EXTERNAL FACT | INFERENCE | HYPOTHESIS | PROPOSED DESIGN
