# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Append-only event log with idempotent ingestion scoped to `(source, external_id)`.
- Truth plane: canonical state machine separating rail state from obligation state.
- Open-object ledger with write-ahead intent log and exposure accounting.
- Duplicate-risk model: relational features plus TF-IDF over the intent reason.
- Governor with a fixed authority order; the model may only widen caution.
- Razorpay client with live/replay modes and HMAC webhook verification.
- MCP server exposing 7 tools with Razorpay-compatible names.
- Benchmark harness comparing the model against four baselines at equal escalation cost.

### Fixed
- `exposure()` double-counted an executed intent whose resulting refund had already closed.
- Evaluation scored intents with no prior history, letting the model win on a structural
  artifact rather than the task (ADR-014).
- Cost-weighted comparison made "escalate everything" optimal; replaced with fixed-budget
  comparison (ADR-014).
- Model artefact pickled a class bound to `__main__` and was unloadable elsewhere.
- `Razorpay(key="", secret="")` fell through to environment credentials via `or`. An
  explicitly blank credential now means no credential, so a harness that deliberately
  supplies none can no longer end up authenticated from ambient state.
- Tests depended on ambient `RAZORPAY_*` environment variables; an autouse fixture now
  clears them, so the suite behaves identically bare and under `make check`.
