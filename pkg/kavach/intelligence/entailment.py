"""Does this cart satisfy the purpose the principal actually delegated?

THE load-bearing AI of Gate, and the question no shipped agentic-payments control asks. AP2
mandates, UPI Reserve Pay and Stripe Issuing all bound HOW MUCH a delegated agent may spend.
None of them bounds WHAT IT MAY BUY. A mandate reading "weekly groceries under Rs 2,000" is
satisfied, arithmetically and to the rupee, by Rs 1,800 of gift cards.

Everything deterministic has already run by the time this is called: the envelope verified,
the merchant allowlisted, every line in scope, both caps respected. So this model never sees
a cart a rule could have refused, and it is never credited for one (ADR-014, Gate form).

The model READS the cart rather than only comparing it, for the reason model.py already
established on refund reasons: similarity alone cannot separate a gift card bought under
"a Diwali gift card for my sister" from the same gift card bought under "weekly groceries".
Both are gift cards. The difference is entirely in what was asked for.

Deliberately excluded from the text block: the purpose string itself. Only ten purpose
archetypes exist in the corpus, so letting the model read purposes directly would let it
memorise mandate identity -- a shortcut no production system with free-text purposes would
have. All purpose interaction is forced through the relational similarity features instead.

Per ADR-004 and ADR-006 this emits a risk score and nothing else. It never authorises, and
a wrong or missing model may only widen caution.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import scipy.sparse as sp
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from . import model
from .model import Model

MODEL_PATH = Path("data/entailment_model.pkl")

# `category_match_rate` from the design sketch is absent on purpose. Every cart reaching
# this model has already passed gate.mandate.admissible(), so every line is in scope by
# construction and the feature is the constant 1.0 -- a column of no information, and a
# misleading one to show a merchant in an explanation.
FEATURES = ["purpose_sim_max", "purpose_sim_mean", "purpose_sim_value_weighted",
            "unsupported_value_share", "liquid_value_share", "max_line_share",
            "cap_utilisation", "max_quantity", "n_lines", "log_total"]

# The similarity features are the ones that require reading text at all, so they are what
# the no-text ablation removes. Without them the model still sees every amount and shape
# signal -- which is exactly the comparison worth reporting.
_TEXT_DERIVED = {"purpose_sim_max", "purpose_sim_mean", "purpose_sim_value_weighted",
                 "unsupported_value_share"}


def cart_text(row: dict) -> str:
    return " ".join(line.description for line in row["cart"].lines)


def _similarities(vec: TfidfVectorizer, purpose: str, descriptions: list[str]) -> list[float]:
    if not descriptions:
        return []
    m = vec.transform([purpose] + descriptions)
    q = m[0]
    return [float(q.multiply(m[i + 1]).sum()) for i in range(len(descriptions))]


def relational(row: dict, vec: TfidfVectorizer) -> list[float]:
    """Features of the cart against its mandate. Nothing here reads the label or the future."""
    env, cart = row["env"], row["cart"]
    lines = cart.lines
    total = max(1, cart.total_minor)
    sims = _similarities(vec, env.purpose, [line.description for line in lines])
    shares = [line.total_minor / total for line in lines]

    return [
        max(sims, default=0.0),
        (sum(sims) / len(sims)) if sims else 0.0,
        # Value-weighted similarity. The plain mean treats a Rs 75 milk carton and a
        # Rs 1,800 gift card as equals; this asks where the MONEY sits relative to the
        # purpose, which is what an attacker is actually moving.
        sum(s * w for s, w in zip(sims, shares, strict=True)),
        # Share of cart value with no lexical support at all from the purpose. Deliberately
        # a hard zero rather than a tuned threshold: zero is the only non-arbitrary cut, and
        # it is high for legitimate carts too (N1 exists precisely to ensure that), so it
        # informs without deciding.
        sum(w for s, w in zip(sims, shares, strict=True) if s == 0.0),
        sum(line.total_minor for line in lines if line.liquid) / total,
        max((line.total_minor for line in lines), default=0) / total,
        cart.total_minor / max(1, env.per_txn_cap_minor),
        float(max((line.quantity for line in lines), default=0)),
        float(len(lines)),
        math.log1p(cart.total_minor),
    ]


def design(rows: list[dict], vec: TfidfVectorizer, scaler: StandardScaler | None = None,
           *, text: bool = True):
    """Relational features, plus TF-IDF over the cart's own text when text is enabled.

    Signature matches model.design so it can be handed to Model.design_fn directly.
    """
    matrix = np.array([relational(r, vec) for r in rows])
    if not text:
        keep = [i for i, f in enumerate(FEATURES) if f not in _TEXT_DERIVED]
        matrix = matrix[:, keep]
    if scaler is not None:
        matrix = scaler.transform(matrix)
    sparse = sp.csr_matrix(matrix)
    if not text:
        return sparse
    return sp.hstack([sparse, vec.transform([cart_text(r) for r in rows])]).tocsr()


def fit(train: list[dict]) -> Model:
    # Fit on TRAIN text only. Fitting the vectoriser on everything leaks test vocabulary
    # into the representation even though no label crosses over.
    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True)
    vec.fit([r["env"].purpose for r in train]
            + [line.description for r in train for line in r["cart"].lines])
    scaler = StandardScaler().fit(np.array([relational(r, vec) for r in train]))
    clf = LogisticRegression(max_iter=4000, class_weight="balanced")
    clf.fit(design(train, vec, scaler), np.array([r["label"] for r in train]))
    return Model(vec, scaler, clf, names=tuple(FEATURES), design_fn=design)


def save(m: Model, path: Path = MODEL_PATH) -> None:
    model.save(m, path)


def load(path: Path = MODEL_PATH) -> Model:
    """Reattach this module's feature builder -- the artefact never carries it (commit 1)."""
    return model.load(path, design_fn=design)
