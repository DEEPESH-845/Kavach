# 07 — Evaluation

Two experiments, one per direction. Method first in both, because the method is what makes
the number worth reading.

# Part A — Outbound: is this intent a duplicate?

## What is being measured
Given an agent intent to move money against a payment that already has prior intent history,
is this intent financially the SAME OBLIGATION as one already in flight?

Population: intents with >=1 prior on the same payment. Intents with no history cannot be
duplicates by construction; scoring them hands every system a block of free negatives and
inflates all metrics. An earlier revision included them and the model won by learning
"does this payment have any history at all", which is not the question. See ADR-014.

## Method
- Corpus: `pkg/kavach/intelligence/corpus.py`, seed 7, 2,600 payments -> 5,740 intents, 9.3% duplicates.
- Split: TEMPORAL, then payments appearing in train are dropped from test. Random splitting
  would put a paraphrase in train and its twin in test and leak the label.
- Vectoriser and scaler fit on TRAIN only. Threshold chosen on TRAIN at the review budget
  and frozen before test is touched.
- Budget: every system may escalate at most 20% of eligible intents. Systems are compared at
  EQUAL escalation cost, because "escalate everything" is otherwise optimal and useless.

## Results (test n=925, 154 duplicates, Rs 2,25,311 of duplicate exposure)

| System                    |     P |     R |    AP | escalated | leaked      |
|---------------------------|-------|-------|-------|-----------|-------------|
| B0 escalate everything    | 0.166 | 1.000 | 0.166 |    100.0% | Rs       0  |
| B1 exact text match       | 0.000 | 0.000 | 0.166 |      0.0% | Rs 2,25,311 |
| B2 rule: amt + open + 24h | 0.187 | 0.221 | 0.171 |     19.7% | Rs 1,84,636 |
| B3 learned, no text       | 0.659 | 0.779 | 0.832 |     19.7% | Rs   61,105 |
| B4 learned + reads text   | 0.813 | 0.961 | 0.980 |     19.7% | Rs   14,257 |

B0 and B2 exceed or exhaust the budget; B2 sits at the same 19.7% as the model, so the
headline comparison is like-for-like: **same human review cost, Rs 1,84,636 leaked versus
Rs 14,257 — 13x less money lost for identical operational spend.**

Ablation: removing the text signal (B4 -> B3) costs AP -0.148 and Rs 46,848 in extra leakage
at the same budget. The text is not decoration.

B1 scoring exactly 0.000 is the corpus working as designed: duplicates are paraphrases, so
string equality is worthless and no model is being credited for beating a strawman.

## What the model learned
Top coefficients include `word:second`, `word:unit`, `word:identical` with large NEGATIVE
weight -- it discovered that "second unit in the same order" marks a separate obligation,
not a repeat of one. The same reason string scores 0.951 in one context and 0.042 in
another, so it is conditioning on relational context, not keyword matching.

## Honest limits
- Base rate (12% duplicate) is a STATED ASSUMPTION, not a measurement. No public figure
  exists. Sensitivity sweep is in evals/risk_report.json.
- Corpus is synthetic. It is constructed to be hard (paraphrased duplicates, identical-amount
  hard negatives, amount collisions across obligations) but it is not production traffic.
- Precision 0.813 means ~1 in 5 escalations is a legitimate refund delayed for review.
  That cost is real and is why the system escalates rather than denies (ADR-006).

## Reproduce
    make check        # lint + tests + both benchmarks. No docker, no network.


# Part B — Inbound: does this cart match the mandate's purpose?

## What is being measured
Given a delegated mandate and a cart arriving under it, does the cart satisfy the purpose the
principal stated? Not "is it under the cap" and not "is it in an allowed category" -- those
are already enforced, deterministically, before the model is consulted.

Population: carts arriving under a VALID envelope that pass **every** deterministic check.
A cart the cap-and-scope arithmetic already refuses never reaches the model, so scoring it
would credit the model for work `mandate.py` did. This is ADR-014's structural artifact in
its Gate form, and excluding those carts lowers the headline number -- the correct direction
for a figure that would otherwise be wrong.

## Method
- Corpus: `pkg/kavach/intelligence/cart_corpus.py`, seed 7, 2,000 mandates -> 3,948 carts,
  14.0% out of purpose.
- Split: TEMPORAL, then mandates appearing in train are dropped from test. Carts under one
  mandate share a purpose string and an item catalogue, so a random split leaks the label.
- Vectoriser, scaler and threshold fit on TRAIN only; threshold frozen before test is touched.
- Budget: every system may step up at most **20%** of carts. Compared at equal friction,
  because "step up everything" is otherwise optimal and ships a checkout that asks permission
  for a carton of milk.

## Results (test n=1,185, 177 violations, Rs 2,62,532 of out-of-purpose exposure)

| System                       |     P |     R |    AP | stepped | leaked      |
|------------------------------|-------|-------|-------|---------|-------------|
| G0 step up everything        | 0.149 | 1.000 | 0.149 |  100.0% | Rs       0  |
| G1 lexical overlap           | 0.151 | 0.695 | 0.154 |   68.8% | Rs   98,482 |
| G2 category + cap rule       | 0.000 | 0.000 | 0.149 |    0.0% | Rs 2,62,532 |
| G3 hand-written red flags    | 0.189 | 0.469 | 0.207 |   37.1% | Rs 1,07,924 |
| G4 learned, no text          | 0.310 | 0.418 | 0.393 |   20.2% | Rs 1,46,293 |
| G5 learned + reads cart      | 0.549 | 0.723 | 0.744 |   19.7% | Rs   59,898 |

**G2 is the result.** It is AP2, UPI Reserve Pay and Stripe Issuing reduced to what they
actually enforce, and it flags nothing: every cart in the population is already inside its
cap and inside its category scope. It spends no friction because it can see nothing to spend
it on, and it leaks the entire exposure. That zero is not a strawman -- it is the finding.
Those controls bound how much may be spent and cannot express what may be bought.

G3 exists because ADR-011 says beating a baseline nobody would ship proves nothing. It is the
best rule available from the same non-text signals -- stored value, bulk quantity, a cart
filling its mandate -- and it still leaks **Rs 1,07,924 while interrupting 37.1% of
checkouts**. G5 leaks 44% less at half the friction.

Ablation: removing the text signal (G5 -> G4) costs AP -0.351 and Rs 86,395 in extra leakage
at the same budget. Reading the cart is worth more here than it was on the Rail model.

G1 and G3 exceed the budget for a structural reason, stated rather than hidden: a rule with a
handful of distinct output values cannot be tuned to an arbitrary step-up rate, because the
quantile threshold lands on a tied score and flags every cart sharing it.

## Per-family recall, at the 20% budget

| Family | n | recall |
|---|---|---|
| F1 liquidity substitution — a gift card inside a grocery mandate | 18 | 1.000 |
| F3 quantity anomaly — twelve of a thing a household buys one of | 29 | 1.000 |
| F4 cap-hugging — the intended item plus filler to just under the cap | 70 | 0.686 |
| F2 purpose drift — in-category, in-budget, not what was asked for | 60 | 0.550 |

The weakest family is the most interesting one. Drift is where lexical similarity has least
to work with, and it is the family an LLM entailer would help most -- which is what makes
ADR-017 evidence-backed rather than aspirational.

## Budget sweep

| budget | stepped | recall | prevented |
|---|---|---|---|
| 5%  |  4.6% | 0.305 | Rs   88,954 |
| 10% |  9.4% | 0.514 | Rs 1,47,815 |
| 20% | 19.7% | 0.723 | Rs 2,02,634 |
| 30% | 32.5% | 0.853 | Rs 2,37,790 |

## Honest limits

- **Lexical similarity cannot bridge synonymy.** "Glenfiddich 12 single malt 750ml" shares no
  word with "wine and whisky", so the purpose-similarity features are identically zero under
  an alcohol mandate and an office-pantry one, and the same bottle scores the same either
  way. Pinned as a passing test in `tests/test_entailment.py` so it stays visible.
- **A legitimate cart with no lexical overlap gets stepped up.** "Amul Gold full cream milk
  1L" against "weekly groceries" shares nothing, and such carts sit around the 91st
  percentile of legitimate scores. Same root cause as above.
- **Precision 0.549 means roughly one in two step-ups interrupts a legitimate checkout.**
  That cost is real. It is why the system steps up rather than denies, and why `Costs` prices
  refusal instead of treating it as free.
- **The 15% out-of-purpose rate is a STATED ASSUMPTION.** No public figure exists.
- **`step_up_catch_rate` (0.70) and `hold_catch_rate` (0.95) are stated assumptions too.**
  No public figure exists for how often a re-consent or a review actually stops a bad cart.
- **The corpus is synthetic.** It is built to be hard -- every attack item and every attack
  signature also occurs legitimately, and no single feature exceeds 0.59 AUC -- but it is not
  production traffic.
- **An earlier revision was easier than this one.** Every legitimate cart had a quantity of
  exactly one, so the model learned that buying two litres of milk was suspicious. Fixing it
  dropped AP from 0.826 to 0.744. The lower number is the honest one.

## Reproduce

    make check        # lint + tests + both benchmarks. No docker, no network.
