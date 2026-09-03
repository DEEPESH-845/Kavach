"""The Bazaar's agent plans deterministically, and every scenario it advertises is a verdict
the REAL gate returns. A scenario list that promises DENY and gets ALLOW is a slide, not a
demo, so the promise is asserted against the trained model here."""

from __future__ import annotations

import pytest
from kavach.intelligence import entailment
from kavach.services import gate as gate_service
from kavach.services import storefront

T = 1_700_000_000


@pytest.fixture
def mandate():
    return storefront.default_mandate(T)


def test_every_mode_plans_a_non_empty_cart_from_the_catalogue(mandate):
    skus = {p["sku"] for p in storefront.CATALOGUE}
    for mode in storefront.MODES:
        out = storefront.plan(mandate, mode)
        assert out["lines"], mode
        assert {ln["sku"] for ln in out["lines"]} <= skus
        assert out["total_minor"] == sum(
            ln["unit_amount_minor"] * ln["quantity"] for ln in out["lines"])
        assert out["trace"], "the agent must say what it did"


def test_the_honest_plan_fits_the_mandate(mandate):
    out = storefront.plan(mandate, "legit")
    assert {ln["category"] for ln in out["lines"]} <= set(mandate["categories"])
    assert out["total_minor"] <= mandate["per_txn_cap_minor"]
    assert not any(ln["liquid"] for ln in out["lines"])


def test_attack_modes_perturb_the_plan_the_way_their_family_does(mandate):
    cap = storefront.plan(mandate, "cap")
    assert cap["total_minor"] > mandate["per_txn_cap_minor"]
    scope = storefront.plan(mandate, "scope")
    assert any(ln["category"] not in mandate["categories"] for ln in scope["lines"])
    liquid = storefront.plan(mandate, "liquid")
    assert any(ln["liquid"] for ln in liquid["lines"])
    drift = storefront.plan(mandate, "drift")
    assert drift["untrusted_context"], "goal drift needs the text the agent read"


def test_planning_is_deterministic(mandate):
    for mode in storefront.MODES:
        assert storefront.plan(mandate, mode) == storefront.plan(mandate, mode)


def test_unknown_mode_is_refused(mandate):
    with pytest.raises(KeyError):
        storefront.plan(mandate, "yolo")


def test_the_catalogue_is_what_the_storefront_renders():
    c = storefront.catalogue()
    assert len(c["products"]) == len(storefront.CATALOGUE)
    assert c["merchant_id"] == storefront.MERCHANT
    assert {s["id"] for s in c["scenarios"]} == set(storefront.MODES)


@pytest.mark.parametrize("mode", storefront.MODES)
def test_every_advertised_verdict_is_the_verdict_the_gate_returns(conn, mandate, mode):
    """The scenario bar promises a verdict family per mode. The promise is checked against
    the real admission path with the trained entailment model, in a sandbox."""
    if not entailment.MODEL_PATH.exists():
        pytest.skip("entailment model not trained here; run `make gate-bench`")
    model = entailment.load()
    gate_service.register_demo_issuer(conn)
    p = storefront.plan(mandate, mode)
    out = gate_service.admit(
        conn, envelope_body={**mandate, "nonce": f"nonce_{mode}"}, cart_id=f"cart_{mode}",
        merchant_id=p["merchant_id"], lines=p["lines"], now=T,
        expected_principal=mandate["principal_id"],
        untrusted_context=p["untrusted_context"], model=model, charge=False)
    assert out["verdict"] in p["expects"], (
        f"{mode}: advertised {p['expects']}, the gate returned {out['verdict']}: "
        f"{out['reasons']}")
