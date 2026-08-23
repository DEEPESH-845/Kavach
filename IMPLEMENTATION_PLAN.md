# Kavach — Implementation Plan

    Phase 0  repository and Rail core          DONE   17 commits, 49 tests, benchmark green
    Phase 1  Gate: inbound agent admission     THIS   10 commits, spec below
    Phase 2  Proof: audit chain, UI, demo      LATER  not planned until Phase 1 lands

Spec: [`documents/specs/2026-08-23-gate-phase-1-design.md`](documents/specs/2026-08-23-gate-phase-1-design.md).
This file maps that spec to commits. Where they disagree, the spec wins.

## Ground rules

All work on `main`, no feature branches. Every commit leaves `make check` green.
Line budgets are ceilings, not targets — coming in under is the win.
Nothing gets built because it might be needed; §2 of the spec lists what is cut and why.

## Phase 1

| # | Commit | Files | ≤LOC |
|---|---|---|---|
| 1 | `refactor(intelligence): parameterise the estimator's names and artefact path` | `intelligence/model.py`, `intelligence/evaluate.py`, `tests/test_model.py` | 60 |
| 2 | `feat(gate): delegation envelope verification` | `gate/__init__.py`, `gate/envelope.py`, `tests/test_envelope.py`, `pyproject.toml` | 230 |
| 3 | `feat(gate): mandate scope and cap arithmetic` | `gate/mandate.py`, `tests/test_mandate.py` | 220 |
| 4 | `feat(intelligence): seeded cart corpus with liquidity and overlap attacks` | `intelligence/cart_corpus.py` | 190 |
| 5 | `feat(intelligence): intent-cart entailment estimator` | `intelligence/entailment.py` | 130 |
| 6 | `feat(gate): expected-loss admission verdict` | `gate/admission.py`, `tests/test_admission.py` | 240 |
| 7 | `feat(gate): benchmark entailment against four baselines` | `intelligence/evaluate_gate.py`, `cmd/gate_benchmark.py`, `Makefile`, `.github/workflows/ci.yml` | 190 |
| 8 | `feat(mcp): inbound admission tools` | `mcp/server.py` | 70 |
| 9 | `docs: gate architecture, threat model, ADR-016..018` | `documents/05`, `06`, `07`, `08` | — |
| 10 | `docs: trim the feature catalogue to what the tree contains` | `README.md` | — |

### 1 · Estimator refactor

`Model` gains `names: tuple[str, ...]` and `design_fn: Callable | None = None`.
`score()` and `explain()` call `(self.design_fn or design)(...)`; `explain()` labels from
`self.names` instead of importing `FEATURES`. `save()`/`load()` take a path, defaulting to
today's `MODEL_PATH`.

`design_fn` is **not** persisted — a pickled callable binds the artefact to an import path
for no gain. `load(path, design_fn=...)` takes it from the caller, who knows which estimator
they asked for. `names` is persisted, because attribution is meaningless without it.

*Check:* `tests/test_model.py` — save/load round-trips `names`, and a Model with a custom
`design_fn` calls it rather than the duplicate-risk `design`. Existing benchmark must
reproduce its committed numbers exactly; a refactor that moves AP is not a refactor.

### 2 · Envelope

```
verify(conn, raw: bytes, sig: bytes, *, keys: dict[str, bytes], now: int,
       expected_principal: str | None = None) -> tuple[Envelope | None, list[Failure]]
```

Ed25519 over `raw`, **before** parsing — same reasoning as `verify_webhook`, and the parse
only runs on bytes that are already proven. `keys` is a plain dict passed in; a key-registry
class would be one implementation of one thing.

Nonce replay is `INSERT OR IGNORE` into `gate_nonces` reading `rowcount`, the idiom
`eventlog.append` already uses. Revocation is a table read at call time, never cached.

`Failure` is a `StrEnum`: `BAD_SIGNATURE · UNKNOWN_ISSUER · EXPIRED · NOT_YET_VALID ·
REPLAYED_NONCE · PRINCIPAL_MISMATCH · MALFORMED · REVOKED`. `verify` returns every failure
it finds, not the first — a merchant debugging an integration should not need eight
round-trips to learn eight things.

`cryptography` promoted to an explicit dependency (already present transitively via `mcp`).

*Check:* `tests/test_envelope.py`, adversarial by construction — tampered payload, truncated
signature, unknown key id, expired, not-yet-valid, replayed nonce, principal mismatch,
revoked between issue and use. A signature check tested only on valid input is untested.

### 3 · Mandate

```
admissible(conn, env, cart, *, now) -> list[Violation]
spent(conn, mandate_id, now) -> int
record_admission(conn, env, cart, *, now) -> int
```

Integer minor units throughout; no float touches money. **INR only** — no currency field,
no currency check (spec §4.2).

`spent()` recomputes from the event log rather than reading a counter, because a second copy
of a derived number drifts silently. Admissions append as events with
`entity_type="mandate"`, so every cap decision carries the evidence chain of the exact
admissions it counted.

`Cart` and `CartLine` are frozen dataclasses; `Cart.total_minor` is a property, not a stored
field that can disagree with the lines.

*Check:* `tests/test_mandate.py` — cap boundary is exact at the rupee, cumulative spend
counts prior admissions and only prior admissions, out-of-scope category and non-allowlisted
merchant each produce their own `Violation`, and a cart at exactly the cap is admitted while
one rupee over is not.

### 4 · Cart corpus

Stdlib only, seeded, `generate(seed=7)` + `temporal_split()`. Mirrors `corpus.py` so the two
read alike.

Four attack families, each present because a cap cannot see it:
liquidity substitution (gift cards inside a grocery mandate) · vocabulary overlap
("office supplies" → an ₹18,000 office chair) · cap-hugging (a compliant-looking cart just
under the limit) · hard positives (in-scope carts worded unlike the mandate, so the model
cannot win by punishing unfamiliar text).

### 5 · Entailment

Relational features — `purpose_sim_max · purpose_sim_mean · uncovered_amount_share ·
liquid_share · max_line_share · category_match_rate · cap_utilisation · n_lines · log_total`
— plus TF-IDF of the cart text, because the model has to *read* the cart and not merely
compare it (the `model.py` argument, unchanged).

Reuses `model.Model`, `model.save`, `model.fit` via commit 1. No new estimator machinery.
No LLM: TF-IDF over short strings, per ADR-013, with `llm_entailment.py` as a Phase 2
sibling behind a one-line selector.

### 6 · Admission

```
decide(conn, env, cart, *, now, costs, risk) -> Admission   # ALLOW | STEP_UP | HOLD | DENY
```

Authority strongest-first, mirroring `governor.decide`: envelope failures → DENY; scope or
cap violations → DENY; only then does expected loss choose among the remaining three.

    EL(ALLOW)   = p·L
    EL(STEP_UP) = c_step + p·(1−r_step)·L
    EL(HOLD)    = c_hold + p·(1−r_hold)·L
    EL(DENY)    = (1−p)·m

`r_step` and `r_hold` are stated assumptions with no public source, live on `Costs` with
documented defaults, and get a sensitivity sweep in the report — the discipline ADR-014
forced on the 12% base rate.

*Check:* `tests/test_admission.py` — a deterministic violation outranks any risk score, a
confident model cannot turn a DENY into an ALLOW, a missing model (`risk=None`) floors at
STEP_UP rather than ALLOW, and each verdict is reachable by moving only the costs.

### 7 · Benchmark — the gate on the whole thesis

G0 step-up-everything · G1 keyword overlap · **G2 category allowlist + amount cap** ·
G3 learned no-text · G4 learned + reads text.

Population is carts under a **valid** envelope only; including invalid ones would credit the
model for signature arithmetic (ADR-014's error, in its Gate form). Temporal split, mandates
in train dropped from test, threshold frozen on train, equal step-up budget, leaked rupees
as the headline.

**G2 is what AP2, Reserve Pay and Stripe Issuing already ship.** If G4 does not beat it by a
margin that survives the sensitivity sweep, the claim in spec §1 is wrong. This runs at
commit 7 of 10 so that answer arrives around 29 Aug, while it is still actionable — not on
4 Sep, when it is not. **If G2 wins, I stop and report rather than continue to commits 8-10.**

Wired into `make check` and CI as a build-failing step, like the Rail benchmark.

### 8 · MCP tools

`verify_agent(envelope_b64, signature_b64, key_id)` and `admit_cart(mandate_id, cart)`.
Both annotated read-only: admission moves no money.

### 9-10 · Documents

`05-architecture.md` and `06-threat-model.md` replace their three-line stubs. `07-evals.md`
gains the Gate section in the same shape as the Rail one. ADR-016 (one event log),
ADR-017 (no LLM, degradation raises the floor), ADR-018 (curated initial history, disclosed).

The README's feature catalogue is cut to what the tree implements. Everything removed moves
to a "Not built" list rather than vanishing, because a promise quietly deleted is worse than
one never made.

## Blocking dependencies

**None for Phase 1.** Razorpay test keys are needed for live mode only; replay covers the
whole build and the whole evaluation. No LLM key is required — the spec's degraded design is
the design, not a workaround.

## Definition of done

`make check` green · Gate benchmark passing in CI on 3.11–3.13 · results and honest limits
in `documents/07-evals.md` · README claiming nothing the tree lacks · ten commits on `main`.
