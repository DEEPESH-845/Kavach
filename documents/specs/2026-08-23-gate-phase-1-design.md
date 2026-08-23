# Kavach Gate — Phase 1 Design

    Status    approved, not yet implemented
    Date      23 August 2026
    Deadline  5 September 2026
    Scope     inbound agent admission: the merchant's half of agentic checkout

## 1 · Why this phase

Rail is built: 2,032 lines, 49 tests, a duplicate-risk model that beats four baselines at
equal review cost. Gate is a README promise with no code behind it, and Gate is what makes
the project's central claim — *agents stand on both sides of the counter* — true rather
than rhetorical.

The claim Gate must support is narrow and defensible:

> AP2 mandates, UPI Reserve Pay and Stripe Issuing all bound **how much** a delegated agent
> may spend. None of them bounds **what it may buy**. A mandate that says "weekly groceries
> under ₹2,000" is satisfied, arithmetically, by ₹1,800 of gift cards.

Cap arithmetic is table stakes and is treated as such here. The uncontested part is
entailment: does this cart satisfy the purpose the principal actually delegated?

## 2 · Goals and non-goals

**Goals.** Verify a delegation envelope cryptographically. Enforce caps, scope and
revocation deterministically. Score whether a cart entails its mandate's stated purpose.
Select ALLOW / STEP_UP / HOLD / DENY by expected loss. Prove it against baselines,
including the baseline that represents what the industry already ships.

**Non-goals for Phase 1**, deferred and named so the omission is a decision rather than an
oversight: ring detection over an identity graph, goal-drift correlation, injection-span
localisation, cross-session scope creep, velocity and regularity features, the WhatsApp
step-up channel, the web UI, the Adversary Lab, and the hash-chained proof plane.

**Explicitly out of scope forever in this repo:** anything requiring Vulcan (ADR-002), and
any payer-side surface (ADR-001).

## 3 · Architecture

Gate mirrors Rail's layering exactly. That symmetry is the readability argument: a reader
who understands one understands the other, and the Proof plane later wraps one event log
rather than reconciling two.

    ┌────────────────────────── eventlog.py ──────────────────────────┐
    │            append-only evidence spine, shared by both            │
    └─────────────────────────────────────────────────────────────────┘
      INBOUND · Gate                          OUTBOUND · Rail  (built)
      gate/envelope.py    signature, replay   truth.py      rail vs obligation
      gate/mandate.py     caps, scope         ledger.py     open obligations
      intelligence/entailment.py  purpose⊨cart  intelligence/model.py  duplicate risk
      gate/admission.py   expected loss       governor.py   authority ladder
    ┌────────────────────────── mcp/server.py ────────────────────────┐
    │                  the tool surface an agent sees                  │
    └─────────────────────────────────────────────────────────────────┘

The layering rule is unchanged and still enforced socially (CONTRIBUTING.md): nothing below
a layer may import anything above it. The order is also the determinism gradient —
deterministic modules first, the learned component second-to-last, policy last.

### Trust boundaries

| Input | Trust | Control |
|---|---|---|
| Delegation envelope | **untrusted** — supplied by the arriving agent | Ed25519 over raw bytes, nonce replay table, validity window, principal binding |
| Cart | **merchant-supplied** — comes from the storefront, not the agent | none needed; it is the merchant's own catalogue |
| Issuer public key | **configured** — out-of-band | key id → key map, unknown issuer is a typed failure, never a skip |

Stating this matters because it is the difference between a real control and a decoration.
Category and liquidity flags are trusted precisely because the *merchant* sets them; if the
agent could set them, the scope check would be self-certified and worthless.

## 4 · Modules

### 4.1 `gate/envelope.py` — cryptographic admission

    verify(conn, raw: bytes, signature: bytes, *, key_id: str, now: int,
           expected_principal: str | None) -> tuple[Envelope | None, list[Failure]]

`Envelope` is a frozen dataclass: `mandate_id · principal_id · agent_id · purpose ·
merchant_allowlist · categories · per_txn_cap_minor · cumulative_cap_minor · not_before ·
not_after · nonce · issued_at`.

Four decisions carry the weight:

- **Signature is verified over the raw bytes, before parsing.** Identical reasoning to
  `verify_webhook`: a re-serialised dict has different key order from what was signed, so
  verifying a round-tripped structure fails every time and invites someone to "fix" it by
  weakening the check. Parse only after the bytes are proven.
- **Every failure is a distinct typed reason**, never a bare `False`: `BAD_SIGNATURE ·
  UNKNOWN_ISSUER · EXPIRED · NOT_YET_VALID · REPLAYED_NONCE · PRINCIPAL_MISMATCH ·
  MALFORMED · REVOKED`. A boolean cannot be audited and cannot be explained to a merchant.
- **Nonce replay** uses a `gate_nonces` table with the nonce as primary key and
  `INSERT OR IGNORE`, reading `rowcount` — the same idiom `eventlog.append` already uses for
  idempotent ingestion. One established pattern, used twice, rather than two inventions.
- **Revocation is read at decision time, never cached.** A cached revocation list is a
  revocation that does not work, which is worse than none because it is believed.

Ed25519 comes from `cryptography`, already present transitively via `mcp`; Phase 1 promotes
it to an explicit dependency because the code imports it directly.

### 4.2 `gate/mandate.py` — scope and cap arithmetic

    admissible(conn, env: Envelope, cart: Cart, *, now: int) -> list[Violation]

All arithmetic in integer minor units — no floats touch money, anywhere. Checks: merchant in
allowlist, every line's category within mandate scope, cart total within per-transaction cap,
and cumulative spend plus this cart within the cumulative cap.

Phase 1 is **INR only**. The `Envelope` carries no currency field and no currency check is
performed, because a check against a field that does not exist is theatre. Multi-currency
mandates need a currency on the envelope, per-currency caps and a rate source; none of that
is in scope, and adding a comparison now would only look like it was.

Cumulative spend is **recomputed from the event log** on each call rather than kept in a
counter column. `ledger.open_against_payment` already takes this position for the same
reason: a second copy of a derived number is a number that can drift, and the drift is
silent. Admissions are appended as events (`entity_type="mandate"`), so every cap decision
carries an evidence chain of the exact prior admissions it counted.

### 4.3 `intelligence/entailment.py` — the load-bearing AI of Gate

    score(row) -> float          # P(cart violates the mandate's stated purpose)
    explain(row, k=4) -> list[str]

Relational features, all computed from the mandate and the cart and nothing else:
`purpose_sim_max · purpose_sim_mean · uncovered_amount_share · liquid_share ·
max_line_share · category_match_rate · cap_utilisation · n_lines · log_total`.

`uncovered_amount_share` — the fraction of cart value in lines with no textual support from
the purpose — is the feature the attack has to defeat, and it is the one a cap cannot see.

The model **also reads** the cart text via TF-IDF, for the reason `model.py` already
established: similarity to the purpose cannot separate "office supplies" from "office
chair, ₹18,000". Both are similar to the purpose; one is in scope and one is a laptop's
worth of furniture. The distinction lives in the words, so the model has to read them.

**No LLM.** TF-IDF character and word n-grams over short strings is a defensible choice, not
a placeholder — ADR-013 already argues it against embeddings for this size of text. When a
key is available, `intelligence/llm_entailment.py` becomes a second scorer behind a one-line
selector. No protocol, no factory, no interface with a single implementation.

Per ADR-004 and ADR-006, unchanged: the score is advisory. It never authorises. A model that
is unavailable or unconfident **raises** the floor.

### 4.4 `gate/admission.py` — expected-loss verdict

    decide(...) -> Admission   # ALLOW | STEP_UP | HOLD | DENY

Authority runs strongest-first, exactly as `governor.decide` does:

1. Envelope failures → **DENY**. Deterministic, above the model, not appealable here.
2. Scope or cap violations → **DENY**. Deterministic.
3. Entailment risk + merchant costs → argmin expected loss over the remaining three.

With `p` the entailment risk and `L` the cart value at risk:

    EL(ALLOW)   = p · L
    EL(STEP_UP) = c_step + p · (1 − r_step) · L
    EL(HOLD)    = c_hold + p · (1 − r_hold) · L
    EL(DENY)    = (1 − p) · m          m = margin lost on a good cart wrongly refused

`r_step` and `r_hold` — the fraction of bad carts each intervention actually catches — are
**stated assumptions with no public source**, and are recorded as such in the results table
alongside a sensitivity sweep. The same discipline ADR-014 applied to the 12% duplicate base
rate applies here; an unsourced constant presented as a measurement is the failure mode.

### 4.5 `mcp/server.py` — two new tools

`verify_agent(envelope_b64, signature_b64, key_id)` and `admit_cart(mandate_id, cart)`.
Read-only annotations on both: admission moves no money, so neither is destructive.

## 5 · Evaluation

Mirrors `documents/07-evals.md` in structure, because the method is what makes the number
worth reading.

**Population.** Carts arriving under a **valid** envelope. Carts with invalid envelopes are
decided deterministically and including them would let the model take credit for signature
arithmetic — the same structural artifact ADR-014 removed from the Rail evaluation, in its
Gate form.

**Split.** Temporal, with mandates appearing in train dropped from test. Vectoriser, scaler
and threshold fit on train only; threshold frozen before test is touched.

**Budget.** Every system may step up at most a fixed share of carts. Compared at equal
friction, because "step up everything" is otherwise optimal and operationally useless.

**Baselines.**

| | System | Why it is here |
|---|---|---|
| G0 | step up everything | the trivial ceiling on recall |
| G1 | keyword overlap threshold | proves the corpus is not solvable by string matching |
| G2 | **category allowlist + amount cap** | **this is AP2 / Reserve Pay / Issuing. The one that matters.** |
| G3 | learned, no text | isolates what reading the cart is worth |
| G4 | learned + reads text | the system |

G2 is the baseline the thesis lives or dies against. If G4 does not beat a category-and-cap
rule by a margin that survives the sensitivity sweep, the claim in §1 is wrong and we want
to know that before submission rather than during it.

**Results table ships empty until the harness fills it.** ADR-007 is not suspended for a
deadline.

## 6 · Degradation

| Failure | Behaviour |
|---|---|
| Entailment model missing or unloadable | risk treated as UNKNOWN, floor rises to STEP_UP. Never a silent ALLOW. |
| Issuer key unknown | `UNKNOWN_ISSUER` → DENY. Never skipped. |
| Event log unreadable | no cumulative spend can be proven → DENY, because an unprovable cap is not a cap. |
| Clock skew beyond tolerance | envelope validity fails closed. |

One rule behind all four, inherited unchanged from ADR-006: **anything that goes wrong may
only widen caution.** There is no failure path in Gate that produces a more permissive
outcome than the healthy path.

## 7 · Testing

One pytest file per module, matching the existing convention. The envelope tests are
adversarial by construction, because a signature check that is only tested on valid input is
untested: tampered payload, truncated signature, wrong issuer key, expired window,
not-yet-valid window, replayed nonce, principal mismatch, and revocation landing between
verification and admission.

`make check` gains the Gate benchmark, and CI runs it as a build-failing step — the same
treatment the Rail benchmark already gets, for the same reason.

## 8 · Small refactor carried by this phase

`intelligence/model.py` currently hardcodes three things that are specific to duplicate
risk: its artefact path, its feature names (read from `features.FEATURES`), and the
`design()` function that `score()` and `explain()` call by name. Entailment needs the
identical `Model` shape with different features, so rather than copy forty lines:

- `Model` gains `names: tuple[str, ...]` — the feature labels `explain()` attributes over.
- `Model` gains `design_fn: Callable | None = None`, and `score()`/`explain()` call
  `(self.design_fn or design)(...)` instead of the module-level `design` directly. Without
  this the tuple is portable but its two methods still build duplicate-risk feature
  matrices, which is the coupling that matters — an entailment model would load fine and
  then score the wrong thing.
- `save()`/`load()` take a path argument, defaulting to today's `MODEL_PATH`.

The `None` default keeps every existing call site working unchanged. Two estimators, one
persistence path, one attribution path, no abstraction invented for it.

Deliberately **not** done: extracting a base estimator class. Two implementations do not
justify one. If a third arrives, revisit.

## 9 · Commit sequence

     1  refactor(intelligence): parameterise the estimator's names and artefact path
     2  feat(gate): delegation envelope verification
     3  feat(gate): mandate scope and cap arithmetic
     4  feat(intelligence): seeded cart corpus with liquidity and overlap attacks
     5  feat(intelligence): intent-cart entailment estimator
     6  feat(gate): expected-loss admission verdict
     7  feat(gate): benchmark entailment against four baselines
     8  feat(mcp): inbound admission tools
     9  docs: gate architecture, threat model, ADR-016..018
    10  docs: trim the feature catalogue to what the tree contains

All on `main`. No feature branches.

## 10 · ADRs added

- **ADR-016** — Gate reuses the event log as its evidence spine rather than owning a store.
  One log means one Proof plane and one replay path; the cost is that cumulative spend is
  recomputed rather than counted, which is correct at demo scale and stated as a ceiling.
- **ADR-017** — Entailment ships without an LLM. TF-IDF over short text is competitive here,
  and a missing model raises the decision floor rather than disabling the check.
- **ADR-018** — The initial 16 commits are a **curated** history in dependency order, not a
  transcript of the editing sequence. Each commit builds and passes its own tests; the
  curation is disclosed rather than implied.

## 11 · Risks

| Risk | Mitigation |
|---|---|
| **G4 fails to beat G2.** The thesis is wrong. | Run the benchmark at commit 7, before any UI or narrative work. Discovering it on 29 Aug is recoverable; discovering it on 4 Sep is not. |
| Synthetic corpus flatters the model. | Hard negatives designed adversarially; G1 exists to prove string matching cannot win; limits stated in the results section as they are for Rail. |
| Scope creep back toward the cut features. | §2 names them. Adding one requires deleting something else from Phase 1. |
| README still overstates the tree. | Commit 10 trims it, in the same phase, not "later". |

## 12 · Definition of done

`make check` green, Gate benchmark passing in CI on 3.11–3.13, results and honest limits
written into `documents/07-evals.md`, README's feature catalogue containing nothing the tree
does not implement, and the ten commits above on `main`.
