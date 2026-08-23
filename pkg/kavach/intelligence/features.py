"""Feature extraction for the duplicate-risk model.

Kept separate from the estimator so the feature contract can be reviewed on its own. Every
feature here is derived from the intent under consideration and the intents that preceded it
on the same payment -- nothing reaches forward in time, because at decision time nothing
later exists.
"""

from __future__ import annotations

import math

from sklearn.feature_extraction.text import TfidfVectorizer

FEATURES = ["max_text_sim", "dup_evidence", "min_amount_delta", "amount_exact_match",
            "log_time_gap", "frac_diff_session", "n_prior", "open_ratio",
            "open_count", "any_result_unknown", "amount_share"]

# The task is only defined where a duplicate is POSSIBLE: at least one prior intent on the
# same payment. Scoring first-ever intents too would hand every system a large block of
# free negatives and inflate all metrics equally -- and it let an earlier version of this
# model win by learning "does this payment have any history", which is not the question.
def eligible(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r["prior"]]


def _sim(vec: TfidfVectorizer, a: str, bs: list[str]) -> list[float]:
    if not bs:
        return []
    m = vec.transform([a] + bs)
    q = m[0]
    return [float(q.multiply(m[i + 1]).sum()) for i in range(len(bs))]


def relational(row: dict, vec: TfidfVectorizer) -> list[float]:
    prior = row["prior"]
    amt, pay_amt = row["amount"], max(1, row["payment_amount"])
    sims = _sim(vec, row["reason"], [p["reason"] for p in prior])

    deltas, gaps, diff_sess, evidence = [], [], [], []
    for p, s in zip(prior, sims, strict=True):
        d = abs(amt - p["amount"]) / max(amt, p["amount"], 1)
        deltas.append(d)
        gaps.append(max(1, row["t"] - p["t"]))
        diff_sess.append(1.0 if p["session_id"] != row["session_id"] else 0.0)
        # high text similarity AND near-identical amount is the duplicate signature
        evidence.append(s * (1.0 - d))

    return [
        max(sims, default=0.0),
        max(evidence, default=0.0),
        min(deltas, default=1.0),
        1.0 if any(p["amount"] == amt for p in prior) else 0.0,
        math.log1p(min(gaps, default=10 ** 6)),
        (sum(diff_sess) / len(diff_sess)) if diff_sess else 0.0,
        float(len(prior)),
        row["open_amount"] / pay_amt,
        float(row["open_count"]),
        1.0 if any(not p["result_known"] for p in prior) else 0.0,
        amt / pay_amt,
    ]
