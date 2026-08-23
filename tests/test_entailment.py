"""The entailment estimator, and the one property that justifies it existing at all.

If a cart could be judged without knowing what was asked for, a rule would do and no model
is warranted. So the load-bearing test here is that the SAME cart scores high under one
purpose and low under another -- the Gate analogue of one refund reason scoring 0.951 in one
context and 0.042 in another.
"""

from __future__ import annotations

import pytest
from kavach.gate.envelope import Envelope
from kavach.gate.mandate import Cart, CartLine
from kavach.intelligence import entailment as ent
from kavach.intelligence.cart_corpus import generate, temporal_split

T = 1_700_000_000

GIFT_CARD = CartLine(sku="amazon", description="Amazon Pay gift card", category="grocery",
                     unit_amount_minor=90000, quantity=1, liquid=True)
WHISKY = CartLine(sku="glenfiddich", description="Glenfiddich 12 single malt 750ml",
                  category="grocery", unit_amount_minor=385000, quantity=1)


def envelope(purpose: str, cap: int = 200000) -> Envelope:
    return Envelope(mandate_id="mnd_x", principal_id="usr_x", agent_id="agt_x",
                    purpose=purpose, merchant_allowlist=("mrc_store",),
                    categories=("grocery",), per_txn_cap_minor=cap,
                    cumulative_cap_minor=cap * 8, not_before=T - 60, not_after=T + 3600,
                    nonce="n", issued_at=T - 60)


def row(purpose: str, *lines: CartLine, cap: int = 200000) -> dict:
    return {"env": envelope(purpose, cap), "t": T, "label": 0, "family": "adhoc",
            "cart": Cart(cart_id="c", merchant_id="mrc_store", lines=lines)}


@pytest.fixture(scope="module")
def trained():
    train, test = temporal_split(generate(n_mandates=1200, seed=7))
    return ent.fit(train), test


# ────────────────────────────────────────── the property that justifies the model

def test_the_same_cart_scores_differently_under_different_purposes(trained):
    """A gift card is a gift card. Whether it belongs is entirely about what was asked for.

    No cap, allowlist or category rule can separate these two -- they are identical on
    every field a deterministic control can read.
    """
    m, _ = trained
    asked_for = m.score(row("a Diwali gift card for my sister", GIFT_CARD))
    not_asked_for = m.score(row("weekly groceries for the family, nothing fancy", GIFT_CARD))
    assert not_asked_for > asked_for + 0.3, (
        f"gift card scored {not_asked_for:.3f} under a grocery mandate and "
        f"{asked_for:.3f} under a gifting one; the model is ignoring the purpose")


def test_lexical_similarity_cannot_bridge_synonymy(trained):
    """A KNOWN LIMIT, pinned so it stays visible instead of being discovered in a demo.

    "Glenfiddich 12 single malt 750ml" shares no word with "wine and whisky", so the
    purpose-similarity features are identically zero under both an alcohol mandate and an
    office-pantry one, and the same bottle scores the same either way. TF-IDF compares
    strings; it does not know a single malt is a whisky.

    This is the sharpest concrete argument for ADR-017's Phase 2 LLM entailer, and it is
    also why the corpus is harder than it looks: every alcohol cart is invisible to the
    similarity features. If this assertion ever flips to a strict inequality, something has
    started bridging synonymy and the limit section of the evaluation needs rewriting.
    """
    m, _ = trained
    in_scope = m.score(row("pick up wine and whisky for saturday's party", WHISKY, cap=600000))
    off_purpose = m.score(row("top up the office pantry with tea, coffee and biscuits",
                              WHISKY, cap=600000))
    assert in_scope == off_purpose


def test_where_vocabulary_does_overlap_the_purpose_moves_the_score(trained):
    """The complement of the limit above: given any shared vocabulary at all, context wins."""
    m, _ = trained
    tea = CartLine(sku="taj", description="Taj Mahal tea bags 100s", category="grocery",
                   unit_amount_minor=42000, quantity=1)
    asked_for = m.score(row("top up the office pantry with tea, coffee and biscuits", tea))
    not_asked_for = m.score(row("monthly baby supplies - diapers, wipes and formula", tea))
    assert not_asked_for > asked_for


def test_the_purpose_is_never_placed_in_the_text_block(trained):
    """Ten purpose archetypes exist. Reading them directly would let the model memorise
    mandate identity -- a shortcut production, with free-text purposes, would not have."""
    assert "Diwali" not in ent.cart_text(row("a Diwali gift card for my sister", GIFT_CARD))
    assert ent.cart_text(row("anything at all", GIFT_CARD)) == GIFT_CARD.description


# ────────────────────────────────────────── the estimator contract

def test_the_model_carries_its_own_feature_names(trained):
    m, _ = trained
    assert m.names == tuple(ent.FEATURES)
    assert m.design_fn is ent.design


def test_no_feature_is_degenerate(trained):
    """category_match_rate was dropped because every cart is in scope by construction.
    Any remaining constant column is the same mistake, unnoticed."""
    m, test = trained
    columns = list(zip(*[ent.relational(r, m.vec) for r in test[:400]], strict=True))
    for name, values in zip(ent.FEATURES, columns, strict=True):
        assert len(set(values)) > 1, f"{name} is constant; it carries no information"


def test_scores_are_probabilities(trained):
    m, test = trained
    assert all(0.0 <= m.score(r) <= 1.0 for r in test[:100])


def test_explanations_are_labelled_from_this_model_not_the_duplicate_risk_one(trained):
    m, test = trained
    labels = {f.split("=")[0] for r in test[:50] for f in m.explain(r, k=200)}
    assert labels & set(ent.FEATURES)
    assert not (labels & {"max_text_sim", "dup_evidence", "n_prior", "open_ratio"})


# ────────────────────────────────────────── ablation and persistence

def test_dropping_text_removes_exactly_the_similarity_features(trained):
    """Pinned to literals. Comparing against _TEXT_DERIVED would pass even if it were
    emptied, which is the ablation silently becoming a no-op."""
    m, test = trained
    expected = {"purpose_sim_max", "purpose_sim_mean", "purpose_sim_value_weighted",
                "unsupported_value_share"}
    assert set(ent._TEXT_DERIVED) == expected
    narrow = ent.design(test[:20], m.vec, text=False)
    assert narrow.shape[1] == 6
    assert ent.design(test[:20], m.vec, text=True).shape[1] > narrow.shape[1]


def test_value_weighting_tracks_where_the_money_sits(trained):
    """The plain mean treats a Rs 420 tea box and a Rs 900 gift card as equals. Only the
    weighted form asks where the MONEY is relative to the purpose, which is what an
    attacker actually moves. Same two items in both carts, so the unweighted mean is
    identical by construction and any difference is the weighting alone.
    """
    m, _ = trained
    pantry = "top up the office pantry with tea, coffee and biscuits"
    tea = CartLine(sku="taj", description="Taj Mahal tea bags 100s", category="grocery",
                   unit_amount_minor=42000, quantity=5)
    tea_light = CartLine(**{**tea.__dict__, "quantity": 1})
    gift_heavy = CartLine(**{**GIFT_CARD.__dict__, "quantity": 2})

    mostly_on_purpose = ent.relational(row(pantry, tea, GIFT_CARD, cap=300000), m.vec)
    mostly_off_purpose = ent.relational(row(pantry, tea_light, gift_heavy, cap=300000), m.vec)
    mean_i = ent.FEATURES.index("purpose_sim_mean")
    weighted_i = ent.FEATURES.index("purpose_sim_value_weighted")

    assert mostly_on_purpose[mean_i] == pytest.approx(mostly_off_purpose[mean_i])
    assert mostly_on_purpose[weighted_i] > mostly_off_purpose[weighted_i]


def test_the_relational_block_is_standardised_before_attribution(trained):
    """Unscaled, log_total sits near 12 on every row and swamps every explanation while
    explaining nothing -- the lesson model.py already paid for."""
    m, test = trained
    block = ent.design(test[:300], m.vec, m.scaler).toarray()[:, :len(ent.FEATURES)]
    assert abs(block.mean()) < 0.5, "relational features are not centred; scaler skipped"
    assert 0.3 < block.std() < 3.0


def test_a_round_trip_reattaches_the_feature_builder_and_reproduces_scores(trained, tmp_path):
    """The artefact never stores design_fn, so load() must put this module's back."""
    m, test = trained
    path = tmp_path / "ent.pkl"
    ent.save(m, path)
    reloaded = ent.load(path)
    assert reloaded.design_fn is ent.design
    assert reloaded.names == m.names
    assert [reloaded.score(r) for r in test[:25]] == [m.score(r) for r in test[:25]]


def test_the_model_separates_held_out_carts_far_better_than_chance(trained):
    """A floor, not the benchmark. Commit 7 does the real comparison against baselines."""
    from sklearn.metrics import average_precision_score
    m, test = trained
    y = [r["label"] for r in test]
    ap = average_precision_score(y, [m.score(r) for r in test])
    assert ap > 3 * (sum(y) / len(y)), f"AP {ap:.3f} is not clearly above the base rate"
