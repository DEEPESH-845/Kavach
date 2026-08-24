"""Does entailment beat the controls the industry already ships? Method before results.

Population: carts arriving under a VALID envelope that already pass every deterministic
check. Carts a rule refuses never reach the model, so scoring them would credit it for
arithmetic mandate.py performed -- ADR-014's structural artifact in its Gate form.

Comparison is at a FIXED STEP-UP BUDGET. Every system may interrupt at most the same share
of carts, and is then judged on the rupees of out-of-purpose spend it let through. Without
an equal-friction constraint "step up everything" wins every comparison and ships a checkout
that asks permission for a carton of milk.

G2 deserves its own note. It is a category-allowlist-plus-cap rule -- AP2, UPI Reserve Pay
and Stripe Issuing, reduced to what they actually enforce -- and by construction it flags
NOTHING here, because every cart in the population already satisfies it. That is not a
strawman, it is the finding: those controls bound how much may be spent and cannot express
what may be bought. G3 exists so the comparison is not only against that. It is the best
rule a competent engineer would write from the same non-text signals, and ADR-011 applies --
beating a baseline nobody would ship proves nothing.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from sklearn.preprocessing import StandardScaler

from . import entailment as ent
from .cart_corpus import VIOLATION_RATE, generate, temporal_split
from .evaluate import threshold_for_budget

STEP_UP_BUDGET = 0.20
REPORT_PATH = Path("evals/gate_report.json")


def g0_step_up_everything(rows):
    return [1.0] * len(rows)


def g1_lexical_overlap(rows):
    """Flag the carts whose words least resemble the purpose. If entailment were a string
    problem this would win, and N1 exists to make sure it cannot."""
    out = []
    for r in rows:
        purpose = set(r["env"].purpose.lower().replace(",", " ").split())
        cart = set(ent.cart_text(r).lower().split())
        out.append(1.0 - len(purpose & cart) / max(1, len(cart)))
    return out


def g2_category_and_cap(rows):
    """AP2 / Reserve Pay / Stripe Issuing, reduced to what they enforce.

    Returns zero for every row, and the zero is the point: each cart is inside its cap and
    inside its category scope, so a control built from those two fields has nothing to say.
    """
    return [0.0 if r["cart"].total_minor <= r["env"].per_txn_cap_minor
            and all(x.category in r["env"].categories for x in r["cart"].lines)
            else 1.0 for r in rows]


def g3_hand_written_rule(rows):
    """The strong deterministic baseline: stored value, bulk quantity, or a cart that fills
    its mandate. These are the red flags an engineer reaches for without a model."""
    out = []
    for r in rows:
        cart, total = r["cart"], max(1, r["cart"].total_minor)
        liquid = sum(x.total_minor for x in cart.lines if x.liquid) / total
        bulk = max(x.quantity for x in cart.lines) >= 5
        full = total / max(1, r["env"].per_txn_cap_minor) >= 0.9
        out.append(max(liquid, 1.0 if bulk else 0.0, 0.6 if full else 0.0))
    return out


def g4_learned_no_text(train, test):
    """Same estimator, blinded to the cart's words. Isolates what reading is worth."""
    vec = ent.fit(train).vec
    keep_matrix = ent.design(train, vec, text=False).toarray()
    scaler = StandardScaler().fit(keep_matrix)
    clf = LogisticRegression(max_iter=4000, class_weight="balanced")
    clf.fit(scaler.transform(keep_matrix), np.array([r["label"] for r in train]))
    def scores(rows):
        matrix = scaler.transform(ent.design(rows, vec, text=False).toarray())
        return clf.predict_proba(matrix)[:, 1]

    return scores(train), scores(test)


def report(name: str, rows, scores, threshold: float, *, tunable: bool) -> dict:
    y = [r["label"] for r in rows]
    flagged = [1 if s >= threshold else 0 for s in scores]
    hits = sum(1 for a, f in zip(y, flagged, strict=True) if a == 1 and f == 1)
    leaked = sum(r["cart"].total_minor for r, a, f in zip(rows, y, flagged, strict=True)
                 if a == 1 and f == 0)
    rate = sum(flagged) / len(rows)
    return {"name": name, "precision": hits / max(1, sum(flagged)),
            "recall": hits / max(1, sum(y)), "ap": average_precision_score(y, scores),
            "step_up_rate": rate, "leaked_minor": leaked,
            "within_budget": rate <= STEP_UP_BUDGET + 1e-9, "tunable": tunable}


def per_family_recall(rows, scores, threshold: float) -> dict[str, dict]:
    caught: dict[str, list[int]] = defaultdict(list)
    for r, s in zip(rows, scores, strict=True):
        if r["label"] == 1:
            caught[r["family"]].append(int(s >= threshold))
    return {f: {"n": len(v), "recall": sum(v) / len(v)} for f, v in sorted(caught.items())}


def main() -> None:
    train, test = temporal_split(generate())
    y = [r["label"] for r in test]
    exposed = sum(r["cart"].total_minor for r in test if r["label"] == 1)

    model = ent.fit(train)
    p_train = [model.score(r) for r in train]
    p_model = [model.score(r) for r in test]
    thr = threshold_for_budget(p_train, STEP_UP_BUDGET)

    no_text_train, no_text_test = g4_learned_no_text(train, test)
    thr_no_text = threshold_for_budget(list(no_text_train), STEP_UP_BUDGET)
    thr_g1 = threshold_for_budget(g1_lexical_overlap(train), STEP_UP_BUDGET)
    thr_g3 = threshold_for_budget(g3_hand_written_rule(train), STEP_UP_BUDGET)

    print(f"\neligible test n={len(test)} (valid envelope, passes every rule) "
          f"violations={sum(y)}")
    print(f"out-of-purpose exposure on the table = Rs{exposed / 100:,.0f}")
    print(f"step-up budget = {STEP_UP_BUDGET:.0%} of carts; thresholds fixed on train\n")

    results = [
        report("G0 step up everything", test, g0_step_up_everything(test), 0.5, tunable=False),
        report("G1 lexical overlap", test, g1_lexical_overlap(test), thr_g1, tunable=True),
        report("G2 category + cap rule", test, g2_category_and_cap(test), 0.5, tunable=False),
        report("G3 hand-written red flags", test, g3_hand_written_rule(test), thr_g3,
               tunable=True),
        report("G4 learned, no text", test, list(no_text_test), thr_no_text, tunable=True),
        report("G5 learned + reads cart", test, p_model, thr, tunable=True),
    ]
    print(f"{'system':<28}{'P':>7}{'R':>7}{'AP':>7}{'stepped':>10}{'leaked':>14}")
    for r in results:
        flag = "" if r["within_budget"] else "  OVER BUDGET"
        print(f"{r['name']:<28}{r['precision']:>7.3f}{r['recall']:>7.3f}{r['ap']:>7.3f}"
              f"{r['step_up_rate']:>9.1%}{'  Rs' + format(r['leaked_minor'] / 100, ',.0f'):>14}"
              f"{flag}")

    no_text, full = results[4], results[5]
    feasible = [r for r in results[:5] if r["within_budget"]]
    best_other = min((r["leaked_minor"] for r in feasible), default=None)

    families = per_family_recall(test, p_model, thr)
    print("\n  per-family recall (G5):")
    for family, stat in families.items():
        print(f"    {family:<18} n={stat['n']:>4}  R={stat['recall']:.3f}")

    print("\n  budget sweep (threshold refit on train at each budget):")
    sweep = []
    for b in (0.05, 0.10, 0.20, 0.30):
        t = threshold_for_budget(p_train, b)
        flagged = [1 if s >= t else 0 for s in p_model]
        leaked = sum(r["cart"].total_minor for r, a, f in zip(test, y, flagged, strict=True)
                     if a == 1 and f == 0)
        hits = sum(1 for a, f in zip(y, flagged, strict=True) if a == 1 and f == 1)
        rec = hits / max(1, sum(y))
        sweep.append({"budget": b, "stepped": sum(flagged) / len(test), "recall": rec,
                      "leaked_minor": leaked, "prevented_minor": exposed - leaked})
        print(f"    budget={b:4.0%}  stepped={sum(flagged) / len(test):5.1%}  R={rec:.3f}  "
              f"prevented=Rs{(exposed - leaked) / 100:>9,.0f}")

    print("\n  note: G1 and G3 exceed the budget because a rule with a handful of distinct\n"
          "  output values cannot be tuned to an arbitrary step-up rate -- the quantile\n"
          "  threshold lands on a tied score and flags every cart sharing it. That is a\n"
          "  property of coarse rules, not a handicap imposed on them here.")

    verdict = ("none - all disqualified" if best_other is None
               else f"Rs{best_other / 100:,.0f} leaked")
    print(f"\n  best non-G5 system inside budget: {verdict}")
    print(f"  reading the cart (G5 vs G4): AP {full['ap'] - no_text['ap']:+.3f}, "
          f"Rs{(no_text['leaked_minor'] - full['leaked_minor']) / 100:+,.0f} leaked")

    assert full["within_budget"], "model must operate inside the step-up budget"
    assert full["ap"] > 0.60, f"AP too low to justify a model: {full['ap']:.3f}"
    if best_other is not None:
        assert full["leaked_minor"] < best_other, (
            "model must beat every feasible baseline, including the hand-written rule; "
            "if it cannot, the claim that purpose cannot be enforced by rules is wrong")
    assert full["ap"] > no_text["ap"] + 0.05, (
        "reading the cart must earn its place at equal budget, or this should be a rules "
        "engine")

    ent.save(model._replace(threshold=thr))
    REPORT_PATH.parent.mkdir(exist_ok=True)
    REPORT_PATH.write_text(json.dumps(
        {"step_up_budget": STEP_UP_BUDGET, "threshold": thr, "exposure_minor": exposed,
         "violation_rate_assumption": VIOLATION_RATE, "results": results,
         "per_family_recall": families, "budget_sweep": sweep}, indent=2, default=float))
    print(f"\ngate benchmark complete -> {ent.MODEL_PATH}, {REPORT_PATH}")


if __name__ == "__main__":
    main()
