# 08 — Architecture Decision Records

## ADR-001  Transform Kavach v1 rather than keep or kill it
v1 aimed a payer-side UPI recovery product at a merchant-side PA/PG. Four of its eight
canonical states (Deemed, Beneficiary bank down, Reversal pending, much of Credit lagging)
are NPCI/issuer-side and NOT observable from Razorpay's position. Its Vulcan synergy is 3/10
and agentic synergy 3/10 -- both scored before Vulcan existed.
KEEP: payment truth is a delayed, partially-observable, distributed-state problem.
KILL: payer surface, unobservable states, recovery orchestrator, reconciliation copilot.
RE-AIM: the naive consumer of a payment API is now an AI agent, not a human.

## ADR-002  Do not build anything that requires Vulcan
We have no access to the model, its data, its features or its confidence outputs.
Any "Vulcan Shadow / Guard / Regret" prototype measures a simulator we wrote ourselves.
Rejected on evidential grounds, not on interest.

## ADR-003  Canonical states must be observable from Razorpay's position
INITIATED / ACCEPTED / PROCESSING / CONFIRMED / SETTLED / FAILED_TERMINAL / REVERSED / AMBIGUOUS
plus confidence in {DERIVED_CERTAIN, DERIVED_PROBABLE, UNKNOWN}.
NPCI-side conditions are represented as AMBIGUOUS + stated reason, never fabricated.

## ADR-004  LLM placement
Rules -> ML -> decision policy -> LLM. The LLM narrates, investigates and disambiguates
intent. It never determines state, amount, authorisation or duplicate risk.
Mirrors Razorpay's published stance: "judging fails open and rules fail closed."

## ADR-005  Ship as an MCP server that wraps Razorpay MCP
Same tool names, different return type. One config-line swap in the agent. This is both
the deployment vector and the reason the demo is a fair A/B: identical agent, identical
prompt, only the tool layer differs.

## ADR-006  A wrong model may only widen caution
The forecast plane can delay an action or trigger escalation. It can never authorise one.
Model unavailable -> confidence UNKNOWN -> policy floor rises to human approval.

## ADR-007  No metric ships before its experiment
Every number is TBD until the harness produces it, with dataset, split, baseline and method.

## ADR-008  Concede idempotency and AP2 explicitly, in the README's first 200 words
Razorpay ships idempotency keys on refunds, payouts and direct transfers. AP2 ships signed
mandates. Stripe ships restricted keys and Issuing spend caps. A judge WILL raise all three.
Any pitch that implies these do not exist reads as unresearched and loses on the spot.
The concession is also the wedge: all four bound a REPLAY or an AMOUNT. None of them bound
a semantically new intent that is financially a duplicate of an in-flight obligation.
Canonical line: "an idempotency key protects a retried request; nothing protects a
re-decided one."

## ADR-009  TRUTH is the headline. GOVERNOR is the delivery mechanism, not the pitch.
Reversed from the v2 draft. Spend caps / allowlists / approval tiers are being commoditised
right now by AP2, Agent Passport (Apache 2.0), Stripe Issuing and Mastercard Agent Pay.
Building the governor as the headline invites "another fintech already shipped this."
The uncontested claim is the canonical-state-plus-confidence-plus-evidence plane and the
open-object ledger. The governor is what makes that claim actionable — it stays, it is
demoted in the narrative.

## ADR-010  The semantic duplicate-risk model moves to P0 and becomes load-bearing AI
This is a fix for a fatal defect: IMPLEMENTATION_PLAN P0 items 1-9 contain zero AI, ML and
LLM sit in P1/P2, and the ordering rule forbids starting P1 until P0 is done. On a 13-day
clock that ships a non-AI project to an AI hiring programme.
The model scores: given a new agent intent and the set of open financial objects, is this
the same obligation? Features are relational (amount delta, payment/order linkage, customer,
time since open, prior-attempt count) plus an embedding over the free-text reason.
Rules cannot do this and the failure is legible: "refund the duplicate charge from
yesterday" and "refund the shipping fee on that order" name the same payment and different
obligations. Deterministic matching answers both identically and is wrong once.
Placement is unchanged from ADR-004: the model produces a RISK SCORE consumed by the policy
engine. It never determines state, amount or authorisation. ADR-006 still binds — a wrong
model may only widen caution.

## ADR-011  The baseline agent must be a strong agent, or the evaluation is worthless
The A/B must hold model, prompt and scenario fixed and vary only the tool layer. The control
arm gets stock Razorpay MCP INCLUDING fetch_payment / fetch_refund, and a system prompt that
explicitly instructs it to verify status before retrying — the instruction a competent
engineer would actually write. Beating a strawman agent that was never told to check proves
nothing and a panel will say so. If Kavach cannot beat a well-prompted agent on stock
tools, the thesis is wrong and we want to know before submission, not during.

## ADR-012  Submit to Track 05 (Open), written in Track 01's quality-bar vocabulary
Track 01's objective is revenue growth; Kavach does not grow revenue and would score zero
against that objective. But Track 01's stated quality bar — every money action explainable,
bounded and gated, with an audit trail and one failure handled gracefully — is a near-exact
restatement of what Kavach is. Open Track's criteria (real problem, meaningful AI, working
product, measurable value, reliability, depth) fit without distortion.
So: file under Open, and open the README with Track 01's bar language so the judges' existing
rubric transfers rather than having to be constructed.

## ADR-013  SQLite over Postgres+Redis+Docker; no torch; no React
The dev machine has no Docker daemon. More importantly a judge cloning the repo at 11pm
should not need one. sqlite3 is stdlib, ACID, zero-setup, and at demo scale (thousands of
events) indistinguishable in behaviour from Postgres for everything we assert.
Redis had no job that a table does not do. torch was only wanted for sentence embeddings
over short refund-reason strings, where TF-IDF character n-grams are competitive and 2GB
lighter. React was only wanted for one page.
Ceiling, stated honestly rather than hidden: SQLite is single-writer, so this does not
survive production ingest volume. The event log is written behind one append() call and
the schema is plain SQL, so the swap is a connection string and a migration, not a rewrite.
What we lose is throughput. What we buy is that the evaluation actually gets run by whoever
is grading it. On a 13-day clock that trade is not close.

## ADR-014  Evaluate only where a duplicate is possible, at a fixed review budget
Two methodology errors found by running the harness rather than by reasoning about it.
(1) Scoring intents with no prior history let the model win by learning "does this payment
have history", a structural artifact: every duplicate has a prior, most negatives did not.
Restricting to intents with >=1 prior removed the artifact and dropped headline AP, which is
the correct direction for a number that was wrong.
(2) Cost-weighted comparison made "escalate everything" the cheapest system at Rs 50 a
review. That is arithmetically true and operationally absurd -- an agent escalating 100% of
its work is a ticket queue. Fixed-budget comparison replaces it: equal escalation rate, then
count leaked rupees. It also disqualifies systems honestly instead of pricing them.

## ADR-015  Repository layout mirrors razorpay/razorpay-mcp-server, not a Go transliteration
Razorpay's internal conventions are not public and inventing them would be worse than
having none. What IS public is four Razorpay repositories, so the layout is taken from
those and each choice is traceable to one:
  - `apps/` + `pkg/` + `Makefile`     razorpay/razorpay-mcp-server (their MCP server, the
                                     closest analogue to this project)
  - `documents/` rather than `docs/` razorpay-mcp-server, razorpay-python, razorpay-go and
                                     razorpay-node all use `documents/`
  - `tests/` outside the package     razorpay-python
  - domain-named packages            razorpay-go (`errors/`, `resources/`, `requests/`)
  - SECURITY / CONTRIBUTING /
    CHANGELOG / .editorconfig / CI   present across their repos
Deliberately NOT copied: Go's `internal/` and hyphenated `apps/<binary>/` directories. Those
are Go visibility and build conventions with no meaning in Python -- a hyphenated directory
is not even importable. Transliterating them would signal cargo-culting to the first
reviewer who opened the tree, which is the opposite of the intent.
The layering rule is enforced socially in CONTRIBUTING.md rather than mechanically: eventlog
-> truth -> ledger -> intelligence -> governor -> mcp, no upward imports. The same ordering
is the determinism gradient, which is why it is worth keeping legible.

## ADR-016  Gate reuses the event log as its evidence spine rather than owning a store
Inbound admission could have kept its own tables for mandates and spend. It does not. Every
admission is appended to the same append-only log the truth plane derives from, and
cumulative spend is RECOMPUTED from that log on every cap decision rather than kept in a
counter column.
Two things are bought. One evidence chain: a cap decision cites the exact event sequence
numbers it counted, the same way a FinancialFact cites the events behind it, so the proof
plane later wraps one log instead of reconciling two. And no drift: a counter is a second
copy of a derived number, and when it disagrees with the log the cap is enforcing a figure
nobody can reconstruct. ledger.py already takes this position for open obligations.
Ceiling, stated rather than hidden: this is a scan per decision. At demo scale it is free;
above it, the counter becomes correct and the recompute becomes a nightly reconciliation
instead. The trade is deliberate and it is the wrong one at production volume.

## ADR-017  Entailment ships without an LLM, and a missing model raises the floor
The obvious implementation of "does this cart match the stated purpose" is an LLM. Kavach
ships TF-IDF over relational features instead, for the reason ADR-013 already gave: on
strings this short, character and word n-grams are competitive, and the evaluation must run
on a judge's laptop with no API key and no network.
It is a real choice, not a placeholder, and it is measured: reading the cart is worth
AP +0.351 over the same model blinded to text, and the system beats every rule baseline
including the best hand-written one. The LLM path stays open as a sibling module behind a
one-line selector, and Part B of the evaluation names exactly what it would buy -- purpose
drift is caught 0.550 of the time, and lexical similarity cannot bridge "single malt" to
"whisky". That is an evidence-backed argument for the upgrade rather than an aspirational one.
The degradation rule is unchanged from ADR-006 and is enforced structurally: with no model
loaded there is no ALLOW at all. Admission floors at STEP_UP, because the deterministic layer
cannot tell whether an in-scope, in-budget cart is what the principal asked for -- which is
the entire reason the plane exists. A missing model raises the floor; it never opens the gate.

## ADR-018  The initial sixteen commits are a curated history, and say so
This repository's first sixteen commits were authored in one sitting from an existing tree
and then ordered by dependency: scaffold, event log, truth, ledger, client, intelligence,
governor, MCP, documents, CI. They are not a transcript of the editing sequence.
What IS true of them, and was verified rather than asserted: each commit was exported to a
clean tree and its own tests run there, so every one builds and passes standing alone, and
each third-party dependency is introduced by the commit that first imports it.
Recording this matters because the alternative is a history that quietly implies a working
order that did not happen. A curated history is normal practice and a better artefact to read
than one squashed commit; presenting it as a transcript would not be. Everything from
commit seventeen onward is written in the order it appears.

## ADR-019  The landing page is a Next.js app; ADR-013's "no React" clause is narrowed
ADR-013 rejected React because it "was only wanted for one page" and because a judge cloning
the repo at 11pm should not need a daemon. The first half no longer holds: the page now
carries the governor's authority ladder, the expected-loss argmin, a seeded replay of the
corpus and a per-plane inspector, and those are components with state rather than one page.
The second half is conceded rather than argued away. `web/` is a Next.js static export, so
`make site` needs Node and a build, and `out/index.html` no longer opens straight off disk --
Next serves its chunks as ES modules and `file://` blocks them. What survives is that the
build is static: no server-side runtime, no database, nothing to deploy but a directory.
The Python tree is untouched by this. `make check` and CI still run on Python alone, and
`tests/test_site.py` reads the TypeScript as text, so the drift guard costs CI no Node.
Scope of the narrowing: React is admitted for `web/` and nowhere else. Nothing in `pkg/`
gains a JavaScript dependency, and the MCP server remains the product surface.

