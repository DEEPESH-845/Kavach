"""The corpus is the evaluation. These tests are what stop it from flattering the model.

A synthetic corpus can be made to produce any number you like. The properties asserted here
are the ones that decide whether commit 7's benchmark means anything: that no deterministic
rule could have won, that the model cannot succeed lexically, and that every cart in the
population is one the deterministic layer would actually have passed through.
"""

from __future__ import annotations

from collections import Counter
from random import Random

import pytest
from kavach.gate.mandate import admissible
from kavach.intelligence.cart_corpus import (
    ATTACKS,
    NEGATIVES,
    VIOLATION_RATE,
    generate,
    temporal_split,
)
from sklearn.metrics import roc_auc_score

T = 1_700_000_000


@pytest.fixture(scope="module")
def rows():
    return generate(n_mandates=800, seed=7)


def descriptions(rows, label):
    return {line.description for r in rows if r["label"] == label for line in r["cart"].lines}


# ─────────────────────────────────────────── the population invariant (ADR-014, Gate form)

def test_every_cart_would_have_passed_the_deterministic_layer(conn, rows):
    """A cart the cap-and-scope arithmetic already refuses must never reach the model.

    Scoring those would credit the model for work mandate.py did, which is precisely the
    structural artifact ADR-014 removed from the Rail evaluation.
    """
    for r in rows:
        assert admissible(conn, r["env"], r["cart"], now=r["t"]) == [], (
            f'{r["family"]} cart {r["cart"].cart_id} is refused before the model sees it')


def test_no_cart_is_empty_or_over_its_cap(rows):
    for r in rows:
        assert r["cart"].lines
        assert 0 < r["cart"].total_minor <= r["env"].per_txn_cap_minor


# ─────────────────────────────────────────── the model must not be able to win lexically

def test_every_attack_item_also_appears_in_a_legitimate_cart(rows):
    """Otherwise the model learns 'whisky implies attack' and nothing about context.

    The same item has to be label 0 under one purpose and label 1 under another, exactly as
    one refund reason scores 0.951 in one context and 0.042 in another.
    """
    attack_only = descriptions(rows, 1) - descriptions(rows, 0)
    assert attack_only == set(), f"items seen only in attacks: {sorted(attack_only)}"


def test_no_single_feature_solves_the_task(rows):
    """Every obvious scalar is checked. If one of these ever separates the classes on its
    own, the benchmark is measuring that feature and not entailment."""
    y = [r["label"] for r in rows]
    features = {
        "cap_utilisation": [r["cart"].total_minor / r["env"].per_txn_cap_minor for r in rows],
        "total_minor": [r["cart"].total_minor for r in rows],
        "n_lines": [len(r["cart"].lines) for r in rows],
        "any_liquid": [float(any(x.liquid for x in r["cart"].lines)) for r in rows],
        "max_quantity": [max(x.quantity for x in r["cart"].lines) for r in rows],
    }
    for name, values in features.items():
        auc = roc_auc_score(y, values)
        assert 0.35 < auc < 0.65, f"{name} alone reaches AUC {auc:.3f}; the corpus is too easy"


@pytest.mark.parametrize("signature,holds", [
    ("stored value", lambda r: any(x.liquid for x in r["cart"].lines)),
    ("a cart filling its mandate",
     lambda r: r["cart"].total_minor >= 0.7 * r["env"].per_txn_cap_minor),
    ("more than one of something", lambda r: max(x.quantity for x in r["cart"].lines) > 1),
    ("many lines", lambda r: len(r["cart"].lines) >= 5),
])
def test_every_attack_signature_also_occurs_legitimately(rows, signature, holds):
    """Not just every attack ITEM -- every attack SHAPE.

    An earlier revision gave every legitimate cart a quantity of exactly one, so the model
    learned that buying two litres of milk was suspicious and scored it 0.769. The item
    overlap test did not catch it, because the item was fine and the shape was not. Any
    signature present only in attacks is a shortcut the model will take.
    """
    seen = Counter(r["label"] for r in rows if holds(r))
    assert seen[0] > 0, f"{signature} never occurs in a legitimate cart"
    assert seen[1] > 0, f"{signature} never occurs in an attack"


# ─────────────────────────────────────────── composition

def test_both_labels_and_every_family_are_represented(rows):
    families = Counter(r["family"] for r in rows)
    assert set(families) == set(ATTACKS) | set(NEGATIVES)
    assert all(families[f] > 0 for f in ATTACKS + NEGATIVES)


def test_the_violation_rate_matches_the_stated_assumption(rows):
    """Pinned to a literal, not to the constant that drives it.

    Comparing the drawn rate against VIOLATION_RATE passes for any value of
    VIOLATION_RATE, so it would not have noticed the assumption being quietly changed --
    and that assumption is quoted in the evaluation as a stated limit.
    """
    assert VIOLATION_RATE == 0.15, "the stated assumption changed; update documents/07-evals.md"
    rate = sum(r["label"] for r in rows) / len(rows)
    assert 0.11 < rate < 0.19, f"drew {rate:.3f}"


def test_attack_families_are_labelled_one_and_negatives_zero(rows):
    for r in rows:
        assert r["label"] == int(r["family"] in ATTACKS)


# ─────────────────────────────────────────── reproducibility and split

def test_the_same_seed_gives_the_same_corpus():
    a, b = generate(n_mandates=200, seed=7), generate(n_mandates=200, seed=7)
    assert [(r["cart"].cart_id, r["label"], r["family"]) for r in a] == \
           [(r["cart"].cart_id, r["label"], r["family"]) for r in b]


def test_a_different_seed_gives_a_different_corpus():
    a, b = generate(n_mandates=200, seed=7), generate(n_mandates=200, seed=8)
    assert [r["family"] for r in a] != [r["family"] for r in b]


def test_the_split_is_temporal_and_leaks_no_mandate(rows):
    """A random split would put one cart of a mandate in train and its sibling in test.
    They share a purpose string and an item catalogue, so the label leaks.

    Input is shuffled first: generate() already emits rows in time order, so passing it
    straight through would exercise nothing and pass even if the sort were deleted.
    """
    train, test = temporal_split(Random(11).sample(rows, len(rows)))
    assert train and test
    assert max(r["t"] for r in train) <= min(r["t"] for r in test)
    assert not ({r["env"].mandate_id for r in train} & {r["env"].mandate_id for r in test})


def test_both_labels_survive_the_split(rows):
    train, test = temporal_split(rows)
    for part in (train, test):
        labels = Counter(r["label"] for r in part)
        assert labels[0] > 0 and labels[1] > 0
