"""Duplicate-risk estimator. THE load-bearing AI (ADR-010).

Question it answers, which no gate in the current agentic-payments stack asks:

    Is this new intent financially the SAME OBLIGATION as something already in flight?

Not "is it under the cap" (Stripe Issuing, Agent Passport), not "did a human authorise it"
(AP2 mandates), not "have I seen this exact request" (idempotency keys). Those all pass a
second Rs 5,000 refund inside a Rs 50,000 daily cap.

Per ADR-004/ADR-006 this outputs a RISK SCORE only. It never decides state, amount or
authorisation, and it may only cause the governor to be MORE cautious, never less.
"""

from __future__ import annotations

import pickle
from pathlib import Path
from typing import NamedTuple

import numpy as np
import scipy.sparse as sp
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from .features import FEATURES, relational

MODEL_PATH = Path("data/risk_model.pkl")

class Model(NamedTuple):
    vec: TfidfVectorizer
    scaler: StandardScaler
    clf: LogisticRegression
    threshold: float = 0.5

    def score(self, row: dict) -> float:
        return float(self.clf.predict_proba(design([row], self.vec, self.scaler))[0, 1])

    def explain(self, row: dict, k: int = 4) -> list[str]:
        """Per-decision attribution, in comparable units.

        Features are standardised before the model sees them, so a contribution here means
        "this feature, relative to its typical value, pushed the decision this far" rather
        than "this feature happened to be a big number". Without scaling log_time_gap sits
        near 9 for every row and swamps the attribution while explaining nothing.
        """
        words = [f"word:{w}" for w in self.vec.get_feature_names_out()]
        names = list(FEATURES) + words
        x = design([row], self.vec, self.scaler).toarray()[0]
        contrib = zip(names, np.asarray(self.clf.coef_)[0] * x, strict=True)
        c = sorted(contrib, key=lambda t: -abs(t[1]))
        return [f"{n}={v:+.2f}" for n, v in c[:k] if abs(v) > 1e-6]


def design(rows: list[dict], vec: TfidfVectorizer, scaler: StandardScaler | None = None,
           *, text: bool = True):
    """Relational features, plus the TF-IDF of the reason itself when text is enabled.

    Similarity-to-priors alone is not enough: "item arrived damaged" and "item arrived
    damaged - second unit in the same order" are highly similar to each other AND to the
    prior, yet one is a duplicate and one is a separate obligation. The distinction lives in
    the words the current reason adds, so the model has to read it, not just compare it.
    """
    R = np.array([relational(r, vec) for r in rows])
    if not text:
        keep = [i for i, f in enumerate(FEATURES) if f not in ("max_text_sim", "dup_evidence")]
        R = R[:, keep]
    if scaler is not None:
        R = scaler.transform(R)
    R = sp.csr_matrix(R)
    if not text:
        return R
    return sp.hstack([R, vec.transform([r["reason"] for r in rows])]).tocsr()


def save(m: Model) -> None:
    """Persist the parts, not the class.

    Pickling the Model NamedTuple directly binds it to whatever module trained it, which is
    __main__ when this file is run as a script -- so every other importer gets
    AttributeError. Storing a plain dict keeps the artefact loadable from anywhere.
    """
    MODEL_PATH.parent.mkdir(exist_ok=True)
    MODEL_PATH.write_bytes(pickle.dumps(
        {"vec": m.vec, "scaler": m.scaler, "clf": m.clf, "threshold": m.threshold}))


def load(path: Path = MODEL_PATH) -> Model:
    d = pickle.loads(Path(path).read_bytes())
    return Model(d["vec"], d["scaler"], d["clf"], d["threshold"])


def fit(train: list[dict]) -> Model:
    # Fit the vectoriser on TRAIN text only -- fitting on everything leaks test vocabulary.
    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True)
    vec.fit([r["reason"] for r in train] + [p["reason"] for r in train for p in r["prior"]])
    scaler = StandardScaler().fit(np.array([relational(r, vec) for r in train]))
    clf = LogisticRegression(max_iter=4000, class_weight="balanced")
    clf.fit(design(train, vec, scaler), np.array([r["label"] for r in train]))
    return Model(vec, scaler, clf)
