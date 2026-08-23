"""Kavach: a financial-truth and action-governance layer for AI agents on Razorpay.

Layering, strongest guarantee first:

    eventlog     append-only record of everything observed          deterministic
    truth        events -> FinancialFact (rail state vs obligation) deterministic
    ledger       obligations in flight + write-ahead intent log     deterministic
    intelligence duplicate-risk estimator                           learned, advisory only
    governor     may this agent move this money, right now          policy
    mcp          the tool surface an agent actually sees            transport
    razorpay     Razorpay REST client, live or replay               transport

Nothing below a layer may depend on anything above it.
"""

__version__ = "0.1.0"
