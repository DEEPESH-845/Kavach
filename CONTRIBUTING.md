# Contributing

## Getting set up

    make install
    make check      # lint + tests + benchmark, exactly what CI runs

No Docker, no database server, no network. `make check` must pass offline.

## Layering rule

    eventlog -> truth -> ledger -> intelligence -> governor -> mcp

Nothing below a layer may import anything above it. The determinism gradient runs the same
way: `eventlog`, `truth` and `ledger` are pure and testable with fixed inputs; only
`intelligence` is learned; only `mcp` and `razorpay` do I/O.

## Rules that are not style preferences

1. **A fact cites its evidence.** `derive()` raises rather than return a state no event
   supports. If you add a state, add the events that justify it.
2. **The model advises, it never authorises.** Anything in `intelligence/` may move a
   decision toward ESCALATE or DENY and never toward ALLOW (ADR-006).
3. **Write-ahead before you act.** An intent is durable before the API call, never after.
4. **Every number has an experiment.** No metric ships without its dataset, split, baseline
   and method (ADR-007). `make bench` fails the build if the model stops beating baselines.
5. **Concede what exists.** Razorpay ships idempotency keys; AP2 ships signed mandates.
   Claims of novelty that ignore them are wrong and will be corrected (ADR-008).

## Tests

Assert-based, pytest, no mocking framework. Name the test after the behaviour it protects,
not the function it calls: `test_processed_without_arn_leaves_the_obligation_open`, not
`test_derive_2`. Every test passes `now` explicitly -- nothing reads the clock.
