"""Goal drift detection over untrusted context.

This plane answers: did the objective mutate immediately after the agent read a product review
or an injected span of hostile text?

MECHANISM, stated exactly: set overlap between the cart's words and the untrusted span,
discounting anything the mandate's own purpose already said. It is lexical, not learned,
and the benchmark reports what that costs -- family F2 (goal drift) recall 0.550, the
weakest of the four families and the one named as weakest in the README rather than averaged
into a headline. The upgrade path is a trained scorer over the same three inputs, evaluated
on the same held-out families; until that is measured, this ships as what it is.

It is safe to ship a weak scorer here and nowhere else, because the score is advisory: it
may raise the admission floor and can never authorise a cart (ADR-004/006). A drift score of
0.0 does not admit anything the deterministic rungs above it refuse.
"""

from __future__ import annotations


def score_drift(mandate_purpose: str, cart_text: str, untrusted_context: str) -> float:
    """Returns a drift score [0.0, 1.0].
    
    A high score indicates the agent's intent drifted towards the untrusted text and away 
    from the mandate's purpose.
    """
    if not untrusted_context or not cart_text:
        return 0.0

    # Word overlap between the cart and the untrusted context, discounted by the mandate's
    # own vocabulary. Lexical by design: see the module docstring for the measured ceiling.
    
    def words(t: str) -> set[str]:
        return {w.lower() for w in t.split() if len(w) > 3}

    cart_words = words(cart_text)
    context_words = words(untrusted_context)
    mandate_words = words(mandate_purpose)
    
    if not cart_words:
        return 0.0

    # How much of the cart came exclusively from the untrusted text, NOT the mandate?
    hostile_overlap = (cart_words & context_words) - mandate_words
    
    # 0.0 if no overlap, approaches 1.0 if the cart matches the context
    return min(1.0, len(hostile_overlap) / max(1, len(cart_words)))


def explain_drift(drift_score: float) -> list[str]:
    """Returns reasons for a given drift score."""
    if drift_score < 0.2:
        return []
    elif drift_score < 0.6:
        return ["minor correlation between cart items and untrusted context"]
    else:
        return [
            "high correlation between cart items and untrusted context: goal drift detected"
        ]
