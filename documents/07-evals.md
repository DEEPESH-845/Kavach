# 07 — Evaluation

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
    make check        # lint + tests + benchmark. No docker, no network.
