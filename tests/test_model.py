"""The estimator carries its own feature names and its own feature builder.

Entailment (Phase 1) reuses this Model with different features. Names alone would make the
tuple portable while score() and explain() still built duplicate-risk features, so the wrong
model would load without complaint and then score the wrong thing. These tests pin both
halves of that decoupling.
"""

from __future__ import annotations

import pickle

import pytest
from kavach.intelligence.corpus import generate, temporal_split
from kavach.intelligence.features import FEATURES, eligible
from kavach.intelligence.model import design, fit, load, save


@pytest.fixture(scope="module")
def trained():
    train, _ = temporal_split(generate(n_payments=300, seed=7))
    rows = eligible(train)
    return fit(rows), rows


def test_fit_records_the_feature_names(trained):
    model, _ = trained
    assert model.names == tuple(FEATURES)


def test_names_survive_a_round_trip(trained, tmp_path):
    model, _ = trained
    path = tmp_path / "m.pkl"
    save(model, path)
    assert load(path).names == model.names


def test_design_fn_is_not_persisted_and_comes_from_the_caller(trained, tmp_path):
    model, _ = trained
    path = tmp_path / "m.pkl"
    save(model._replace(design_fn=design), path)
    assert load(path).design_fn is None
    assert load(path, design_fn=design).design_fn is design


def test_score_uses_design_fn_when_one_is_given(trained):
    model, rows = trained
    seen = []

    def spy(batch, vec, scaler):
        seen.append(batch)
        return design(batch, vec, scaler)

    model._replace(design_fn=spy).score(rows[0])
    assert seen, "score() called the module-level design() instead of design_fn"


def test_explain_labels_come_from_names_not_from_the_features_module(trained):
    model, rows = trained
    renamed = model._replace(names=tuple(f"X_{n}" for n in FEATURES))
    labels = [f.split("=")[0] for f in renamed.explain(rows[0], k=500)]
    assert any(name.startswith("X_") for name in labels)
    assert not any(name in FEATURES for name in labels), "explain() ignored self.names"


def test_an_artefact_without_names_is_rejected_rather_than_guessed(tmp_path):
    """Defaulting to FEATURES would silently mislabel a foreign model's attribution."""
    path = tmp_path / "old.pkl"
    path.write_bytes(pickle.dumps({"vec": 1, "scaler": 2, "clf": 3, "threshold": 0.5}))
    with pytest.raises(ValueError, match="make bench"):
        load(path)
