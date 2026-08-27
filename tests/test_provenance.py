from __future__ import annotations

from kavach.gate import provenance


def test_score_drift_no_untrusted_context():
    score = provenance.score_drift("buy shoes", "nike shoes", "")
    assert score == 0.0


def test_score_drift_no_overlap():
    score = provenance.score_drift("buy shoes", "nike shoes", "this is a review about hats")
    assert score == 0.0


def test_score_drift_high_overlap():
    score = provenance.score_drift(
        "buy shoes", "nike shoes and sneakers", "buy some sneakers instead"
    )
    assert score > 0.0


def test_explain_drift():
    assert len(provenance.explain_drift(0.1)) == 0
    assert "minor" in provenance.explain_drift(0.3)[0]
    assert "high" in provenance.explain_drift(0.8)[0]
