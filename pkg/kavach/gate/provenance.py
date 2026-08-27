"""Goal drift detection over untrusted context.

This plane answers: did the objective mutate immediately after the agent read a product review
or an injected span of hostile text?
"""

from __future__ import annotations


def score_drift(mandate_purpose: str, cart_text: str, untrusted_context: str) -> float:
    """Returns a drift score [0.0, 1.0].
    
    A high score indicates the agent's intent drifted towards the untrusted text and away 
    from the mandate's purpose.
    """
    if not untrusted_context or not cart_text:
        return 0.0

    # Extremely naive heuristic for demonstration:
    # Measure word overlap between the cart and the untrusted context,
    # weighted against words in the mandate.
    
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
