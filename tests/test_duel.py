"""The duel is derived, not scripted: both lanes see the same inputs, the legitimate steps
pass in both, and every number is a sum of amounts the real code decided on."""

from __future__ import annotations

import pytest
from kavach.intelligence import entailment
from kavach.intelligence import model as risk_model
from kavach.services import duel


@pytest.fixture(scope="module")
def result():
    return duel.run()


def test_both_lanes_agree_on_the_legitimate_steps(result):
    legit = [s for s in result["steps"] if not s["attack"]]
    assert legit, "a duel with no legitimate step is a caricature"
    for s in legit:
        assert s["ungoverned"]["executed"]
        if s["kind"] == "inbound" and result["model_used"]["entailment"]:
            assert s["kavach"]["verdict"] == "ALLOW", s["kavach"]["reasons"]
        if s["kind"] == "outbound":
            assert s["kavach"]["verdict"] == "ALLOW", s["kavach"]["reasons"]


def test_exposure_is_the_sum_of_what_actually_executed(result):
    steps = result["steps"]
    assert result["totals"]["ungoverned_minor"] == sum(s["amount_minor"] for s in steps)
    assert result["totals"]["kavach_minor"] == sum(s["kavach"]["executed_minor"] for s in steps)
    assert result["totals"]["ungoverned_unauthorised_minor"] == sum(
        s["amount_minor"] for s in steps if s["attack"])
    assert (result["totals"]["kavach_unauthorised_minor"]
            + result["totals"]["protected_minor"]
            == result["totals"]["ungoverned_unauthorised_minor"])


def test_every_attack_is_refused_when_the_models_are_present(result):
    if not (entailment.MODEL_PATH.exists() and risk_model.MODEL_PATH.exists()):
        pytest.skip("estimators not trained here")
    attacks = [s for s in result["steps"] if s["attack"]]
    assert len(attacks) == 5
    for s in attacks:
        assert s["kavach"]["verdict"] != "ALLOW", f"{s['mode']}: {s['kavach']['reasons']}"
        assert s["kavach"]["refused_by"], s["mode"]
    assert result["totals"]["kavach_unauthorised_minor"] == 0
    assert result["totals"]["protected_minor"] > 0


def test_cumulative_counters_are_monotonic_and_end_at_the_totals(result):
    prev = 0
    for s in result["steps"]:
        assert s["cumulative"]["ungoverned_minor"] >= prev
        prev = s["cumulative"]["ungoverned_minor"]
    assert result["steps"][-1]["cumulative"] == result["totals"]


def test_the_duel_is_reproducible():
    a, b = duel.run(), duel.run()
    a.pop("generated_at"), b.pop("generated_at")
    assert a == b
