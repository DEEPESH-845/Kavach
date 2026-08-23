"""Benchmark harness: the model against every baseline that could replace it.

Run this and the model has to earn its existence on the numbers, or the asserts fail.
See documents/07-evals.md for the method and ADR-014 for why the comparison is
fixed-budget rather than cost-weighted.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, precision_recall_fscore_support
from sklearn.preprocessing import StandardScaler

from .corpus import generate, temporal_split
from .features import FEATURES, eligible, relational
from .model import MODEL_PATH, design, fit, save

# ---------------------------------------------------------------- baselines
# ---------------------------------------------------------------- baselines

def b_always(rows): return [1.0] * len(rows)


def b_exact_text(rows):
    return [1.0 if any(p["reason"] == r["reason"] for p in r["prior"]) else 0.0 for r in rows]


def b_rule(rows):
    """The rule a competent engineer writes: same amount, open, within 24h."""
    out = []
    for r in rows:
        hit = any(p["amount"] == r["amount"] and not p["result_known"]
                  and (r["t"] - p["t"]) < 86400 for p in r["prior"])
        out.append(1.0 if hit else 0.0)
    return out


def b_relational(train, test):
    """Same learner, text signal removed -- isolates exactly what semantics buys."""
    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=2).fit([r["reason"] for r in train])
    keep = [i for i, f in enumerate(FEATURES) if f not in ("max_text_sim", "dup_evidence")]
    sc = StandardScaler().fit(np.array([relational(r, vec) for r in train])[:, keep])
    clf = LogisticRegression(max_iter=4000, class_weight="balanced")
    clf.fit(design(train, vec, sc, text=False), np.array([r["label"] for r in train]))
    return list(clf.predict_proba(design(test, vec, sc, text=False))[:, 1])



# ---------------------------------------------------------------- evaluation

# "Why not escalate everything to a human?" is the correct question and it has an answer.
# Escalation is not free at Rs 50 a look: every escalation is an agent that failed to
# complete a task autonomously. Past a small fraction the merchant has bought an expensive
# ticket queue instead of an agent. So the comparison is fixed-budget: each system may
# escalate at most REVIEW_BUDGET of intents, and we ask how many duplicate rupees it lets
# through. A system that cannot operate inside the budget is not cheaper, it is disqualified.
# 20% of ELIGIBLE intents (those with at least one prior on the same payment). Eligible is
# ~54% of all intents, so this is ~11% of agent traffic escalated. Chosen from the sweep in
# evals/risk_report.json, not picked first: 10% caps recall at 60% arithmetically and leaves
# Rs 1.2L on the table, while 30% doubles escalations to buy 2% more recall.
REVIEW_BUDGET = 0.20


def threshold_for_budget(scores: list[float], budget: float) -> float:
    """Chosen on TRAIN only, then frozen. Picking it on test is how benchmarks lie."""
    if not scores:
        return 0.5
    return float(np.quantile(np.array(scores), 1.0 - budget))


def report(name: str, y, p, rows, thr, *, tunable: bool) -> dict:
    yhat = [1 if s >= thr else 0 for s in p]
    pr, rc, f1, _ = precision_recall_fscore_support(
        y, yhat, average="binary", zero_division=0)
    leaked = sum(r["amount"] for r, t, h in zip(rows, y, yhat, strict=True)
                 if t == 1 and h == 0)
    reviews = sum(yhat)
    rate = reviews / max(1, len(rows))
    ap = average_precision_score(y, p) if len(set(y)) > 1 else float("nan")
    ok = "" if rate <= REVIEW_BUDGET + 1e-9 else "  OVER BUDGET"
    print(f"  {name:<24} P={pr:.3f} R={rc:.3f} AP={ap:.3f} "
          f"escalated={rate:5.1%} leaked=Rs{leaked/100:>9,.0f}{ok}")
    return {"name": name, "precision": pr, "recall": rc, "f1": f1, "ap": ap,
            "leaked_minor": leaked, "reviews": reviews, "review_rate": rate,
            "within_budget": rate <= REVIEW_BUDGET + 1e-9, "tunable": tunable}


def main() -> None:
    rows = generate()
    train, test = temporal_split(rows)
    train, test = eligible(train), eligible(test)
    y = [r["label"] for r in test]
    exposed = sum(r["amount"] for r in test if r["label"] == 1)

    model = fit(train)
    p_model = [model.score(r) for r in test]
    thr = threshold_for_budget([model.score(r) for r in train], REVIEW_BUDGET)

    p_rel_tr = b_relational(train, train)
    p_rel = b_relational(train, test)
    thr_rel = threshold_for_budget(p_rel_tr, REVIEW_BUDGET)

    print(f"\neligible test n={len(test)} (>=1 prior intent) positives={sum(y)}")
    print(f"duplicate exposure on the table = Rs{exposed/100:,.0f}")
    print(f"review budget = {REVIEW_BUDGET:.0%} of intents; thresholds fixed on train\n")

    results = [
        report("B0 escalate everything", y, b_always(test), test, 0.5, tunable=False),
        report("B1 exact text match", y, b_exact_text(test), test, 0.5, tunable=False),
        report("B2 rule: amt+open+24h", y, b_rule(test), test, 0.5, tunable=False),
        report("B3 learned, no text", y, p_rel, test, thr_rel, tunable=True),
        report("B4 learned + reads text", y, p_model, test, thr, tunable=True),
    ]
    rel, full = results[3], results[4]
    feasible = [r for r in results[:3] if r["within_budget"]]
    best_other = min((r["leaked_minor"] for r in feasible), default=None)

    # A fixed budget caps recall arithmetically: you cannot catch more duplicates than you
    # are allowed to escalate. Quoting recall without this ceiling flatters or slanders the
    # model depending on the base rate, so both are reported.
    ceiling = min(1.0, (REVIEW_BUDGET * len(test)) / max(1, sum(y)))
    prevented = exposed - full["leaked_minor"]
    reached = full["recall"] / ceiling
    print(f"\n  recall ceiling at this budget = {ceiling:.1%}; "
          f"model reached {full['recall']:.1%} ({reached:.0%} of achievable)")
    print(f"  duplicate rupees prevented = Rs{prevented/100:,.0f} of Rs{exposed/100:,.0f}")
    print(f"  at {full['review_rate']:.1%} escalation and {full['precision']:.0%} precision")

    print("\n  budget sweep (threshold refit on train at each budget):")
    sweep = []
    tr_scores = [model.score(r) for r in train]
    for b in (0.05, 0.10, 0.20, 0.30):
        t = float(np.quantile(np.array(tr_scores), 1.0 - b))
        yh = [1 if v >= t else 0 for v in p_model]
        lk = sum(r["amount"] for r, a, h in zip(test, y, yh, strict=True) if a == 1 and h == 0)
        rate = sum(yh) / len(test)
        rec = sum(1 for a, h in zip(y, yh, strict=True) if a == 1 and h == 1) / max(1, sum(y))
        prec = sum(1 for a, h in zip(y, yh, strict=True) if a == 1 and h == 1) / max(1, sum(yh))
        sweep.append({"budget": b, "escalated": rate, "recall": rec, "precision": prec,
                      "leaked_minor": lk, "prevented_minor": exposed - lk})
        print(f"    budget={b:4.0%}  escalated={rate:5.1%}  R={rec:.3f}  P={prec:.3f}  "
              f"prevented=Rs{(exposed-lk)/100:>9,.0f}")

    verdict = ("none - all disqualified" if best_other is None
               else f"Rs{best_other/100:,.0f} leaked")
    print(f"\n  best non-learned system inside budget: {verdict}")
    print(f"  text signal (B4 vs B3): AP {full['ap'] - rel['ap']:+.3f}, "
          f"Rs{(rel['leaked_minor'] - full['leaked_minor'])/100:+,.0f} leaked, "
          f"recall {full['recall'] - rel['recall']:+.3f}")

    names = list(model.names) + [f"word:{w}" for w in model.vec.get_feature_names_out()]
    coefs = zip(names, np.asarray(model.clf.coef_)[0], strict=True)
    top = sorted(coefs, key=lambda t: -abs(t[1]))[:8]
    print("  top coefficients: " + ", ".join(f"{n}={c:+.2f}" for n, c in top))

    assert full["within_budget"], "model must operate inside the review budget"
    assert full["ap"] > 0.75, f"AP too low to justify a model: {full['ap']:.3f}"
    if best_other is not None:
        assert full["leaked_minor"] < best_other, "model must beat every feasible baseline"
    assert full["recall"] > rel["recall"] or full["ap"] > rel["ap"] + 0.01, (
        "text must earn its place at equal budget, or this should be a rules engine")

    MODEL_PATH.parent.mkdir(exist_ok=True)
    save(model._replace(threshold=thr))
    Path("evals").mkdir(exist_ok=True)
    Path("evals/risk_report.json").write_text(json.dumps(
        {"review_budget": REVIEW_BUDGET, "threshold": thr, "exposure_minor": exposed,
         "recall_ceiling": ceiling, "prevented_minor": prevented,
         "duplicate_rate_assumption": 0.12, "results": results, "budget_sweep": sweep},
        indent=2, default=float))
    print(f"\nbenchmark complete -> {MODEL_PATH}, evals/risk_report.json")


if __name__ == "__main__":
    main()

