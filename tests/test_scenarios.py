"""The adversary lab asserts itself.

The lab is only worth showing a judge if it can fail. These tests are what make that true
in CI rather than only on screen: every scenario declares an expected verdict, and a
backend change that alters one shows up here as a red test.

Scenarios that need a trained estimator are skipped when the artefact is absent rather than
passed. `make check` runs the suite before the benchmarks, so a fresh checkout legitimately
has no model, and quietly counting an unrun defence as a pass is the failure mode this whole
project exists to argue against.
"""

from __future__ import annotations

import pytest
from kavach.services import scenarios

DETERMINISTIC = {
    "outbound-over-refund",
    "outbound-unknown-state",
    "inbound-category",
    "inbound-cap",
    "inbound-expired",
    "inbound-forged",
    "inbound-revoked",
}


@pytest.fixture(scope="module")
def models():
    return scenarios.models()


def test_the_catalogue_is_not_empty_and_every_entry_is_runnable():
    cat = scenarios.catalogue()
    assert cat, "the lab advertises no scenarios"
    for spec in cat:
        assert spec["expect"], f"{spec['id']} declares no expected verdict"
        assert spec["plane"] in {"inbound", "outbound"}
        assert "run" not in spec, "the callable must not cross the API boundary"


@pytest.mark.parametrize("scenario_id", sorted(DETERMINISTIC))
def test_deterministic_defences_hold_without_any_model(scenario_id):
    """These are refused by arithmetic or by cryptography, so no model can be credited for
    them and none is needed to run them."""
    result = scenarios.run(scenario_id)
    why = (result.get("decision") or result.get("admission") or {}).get("reasons")
    assert result["outcome"] == "HELD", (
        f"{scenario_id}: expected {result['expected']}, got {result['actual']}\n  {why}")


def test_every_scenario_holds_when_the_models_are_present(models):
    risk, entailment = models
    if risk is None or entailment is None:
        pytest.skip("estimators are not trained here; run `make bench` and `make gate-bench`")

    broken = [r for r in scenarios.run_all() if r["outcome"] != "HELD"]
    assert not broken, "scenarios that did not hold: " + ", ".join(
        f"{r['id']} (expected {r['expected']}, got {r['actual']})" for r in broken)


def test_a_scenario_is_reproducible():
    """Two runs of the same scenario must agree. A lab whose verdict moves between runs
    cannot be used to reproduce anything."""
    a = scenarios.run("inbound-forged")
    b = scenarios.run("inbound-forged")
    assert a["actual"] == b["actual"]
    assert a["admission"]["envelope_failures"] == b["admission"]["envelope_failures"]


def test_the_sandbox_does_not_touch_the_operator_ledger(tmp_path, monkeypatch):
    """Every scenario builds its own in-memory database. If one ever reached the configured
    database, the lab could inflate the numbers on the command centre."""
    db = tmp_path / "should_stay_empty.db"
    monkeypatch.setenv("KAVACH_DB", str(db))

    scenarios.run("inbound-cap")
    scenarios.run("outbound-over-refund")

    assert not db.exists(), "a scenario wrote to the configured database"


def test_an_unknown_scenario_is_a_key_error_not_a_silent_pass():
    with pytest.raises(KeyError):
        scenarios.run("no-such-scenario")
