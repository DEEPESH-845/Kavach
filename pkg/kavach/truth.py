"""TRUTH plane: events -> FinancialFact. Deterministic, zero AI.

The whole project turns on one refusal: a rail state and an obligation state are not the
same thing and must never be collapsed into one field.

    Razorpay says refund rfnd_A is "processed".
    Rail state:       PROCESSING -> the gateway accepted and dispatched it.
    Obligation state: OPEN       -> the customer has not been credited and may not be
                                    for 5-10 business days.

Razorpay's own docs: "Usually, Razorpay moves a refund to the processed state before
receiving the ARN/RRN from the Gateway." A single `status` field cannot carry that, so an
agent reading `status == "processed"` reports "done" and is wrong. We return both, plus the
events that justify them, and we never emit a state no event supports.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from .eventlog import Event


class Rail(StrEnum):
    """Observable from Razorpay's position only. NPCI/issuer-side conditions are AMBIGUOUS."""
    INITIATED = "INITIATED"
    ACCEPTED = "ACCEPTED"
    PROCESSING = "PROCESSING"
    CONFIRMED = "CONFIRMED"
    SETTLED = "SETTLED"
    FAILED_TERMINAL = "FAILED_TERMINAL"
    REVERSED = "REVERSED"
    AMBIGUOUS = "AMBIGUOUS"


class Confidence(StrEnum):
    DERIVED_CERTAIN = "DERIVED_CERTAIN"    # a signature-verified event states this directly
    DERIVED_PROBABLE = "DERIVED_PROBABLE"  # inferred, or from an unverified source
    UNKNOWN = "UNKNOWN"                    # contradicted, or stale past tolerance


# Rank exists only to detect regression. A later event that ranks lower than an earlier one
# is a contradiction, not an update, and contradictions collapse to AMBIGUOUS.
_RANK = {Rail.INITIATED: 0, Rail.ACCEPTED: 1, Rail.PROCESSING: 2,
         Rail.CONFIRMED: 3, Rail.SETTLED: 4}

_REFUND = {"created": Rail.ACCEPTED, "pending": Rail.PROCESSING,
           "processed": Rail.PROCESSING, "failed": Rail.FAILED_TERMINAL}

_PAYMENT = {"created": Rail.INITIATED, "authorized": Rail.ACCEPTED,
            "captured": Rail.CONFIRMED, "refunded": Rail.REVERSED,
            "failed": Rail.FAILED_TERMINAL}

# Past this with no new event, a non-terminal entity stops being "in progress" and starts
# being "we do not know". Deliberately short for refunds: the demo must show the transition.
# ponytail: fixed tolerance; replace with the P80 of the survival model (P1) when it lands.
_STALE_SECONDS = {"refund": 6 * 3600, "payment": 15 * 60}

# A state nothing further is expected from. Silence after one of these is the end of the
# story, not evidence that we have lost track.
#
# CONFIRMED belongs here and its absence was a live bug: a captured payment stopped being
# CONFIRMED fifteen minutes after capture and became AMBIGUOUS, so governor.decide read
# `payment_captured=False` and DENIED every refund against any payment older than that.
# Capture is not an in-flight state waiting for news -- it is the news.
_TERMINAL = {Rail.FAILED_TERMINAL, Rail.REVERSED, Rail.SETTLED, Rail.CONFIRMED}


@dataclass(frozen=True)
class FinancialFact:
    entity_type: str
    entity_id: str
    rail_state: Rail
    confidence: Confidence
    obligation_open: bool          # is money still owed / in flight?
    amount_minor: int
    currency: str
    reason: str                    # why we believe this, in one sentence
    evidence: list[int] = field(default_factory=list)   # event seqs, never empty
    as_of: int = 0
    unresolved_for: int = 0        # seconds since the last state-changing event
    arn: str | None = None         # bank reference; strongest credit signal we can observe

    def to_agent(self) -> dict:
        """The shape an agent sees. No field here can be read as 'done' when it is not."""
        return {
            "entity": f"{self.entity_type}:{self.entity_id}",
            "rail_state": self.rail_state.value,
            "obligation": "OPEN" if self.obligation_open else "CLOSED",
            "confidence": self.confidence.value,
            "amount": self.amount_minor / 100,
            "currency": self.currency,
            "settled_to_customer": bool(self.arn) and not self.obligation_open,
            "because": self.reason,
            "evidence_events": self.evidence,
            "unresolved_for_seconds": self.unresolved_for,
        }


def _entity_body(e: Event) -> dict:
    """Razorpay webhooks nest as payload.<entity>.entity; API responses are already flat."""
    p = e.payload
    inner = p.get("payload")
    if isinstance(inner, dict):
        for v in inner.values():
            if isinstance(v, dict) and isinstance(v.get("entity"), dict):
                return v["entity"]
    return p if isinstance(p, dict) else {}


def derive(events: list[Event], *, now: int) -> FinancialFact:
    """Fold events into one fact. Pure: same events + same now => same fact, always."""
    if not events:
        raise ValueError("no events: refusing to state a fact with no evidence")

    entity_type, entity_id = events[0].entity_type, events[0].entity_id
    table = _REFUND if entity_type == "refund" else _PAYMENT

    state = Rail.INITIATED
    conf = Confidence.UNKNOWN
    amount, currency, arn = 0, "INR", None
    evidence: list[int] = []
    contradiction: str | None = None
    last_change = events[0].occurred_at

    for e in events:
        body = _entity_body(e)
        status = body.get("status")
        if status is None:
            continue
        mapped = table.get(status)
        if mapped is None:
            contradiction = f"unrecognised {entity_type} status {status!r}"
            evidence.append(e.seq)
            continue

        prev = state
        if mapped in _RANK and state in _RANK and _RANK[mapped] < _RANK[state]:
            contradiction = (f"{entity_type} regressed {state.value} -> {mapped.value} "
                             f"at event {e.seq}")
        state = mapped
        evidence.append(e.seq)
        if mapped != prev:
            last_change = e.occurred_at

        amount = body.get("amount", amount) or amount
        currency = body.get("currency", currency) or currency
        arn = body.get("acquirer_data", {}).get("arn") or body.get("arn") or arn
        # A signature-verified webhook is the strongest thing we get. Everything else,
        # including our own polling, is probable.
        conf = Confidence.DERIVED_CERTAIN if e.sig_verified else Confidence.DERIVED_PROBABLE

    if not evidence:
        raise ValueError(f"{entity_type}:{entity_id} has events but none carry a status")

    unresolved = max(0, now - last_change)
    stale = unresolved > _STALE_SECONDS.get(entity_type, 3600)

    if contradiction:
        return FinancialFact(
            entity_type, entity_id, Rail.AMBIGUOUS, Confidence.UNKNOWN, True, amount,
            currency, f"contradictory evidence: {contradiction}", evidence, now,
            unresolved, arn)

    # A refund carrying a bank reference has been credited. Its rail status is still
    # 'processed' -- Razorpay never sends a further event -- so it is only recognised as
    # settled below, after the staleness check would already have called it AMBIGUOUS and
    # re-opened a closed obligation. Recognise it here instead, or open exposure grows
    # forever as credited refunds age out.
    credited = entity_type == "refund" and state is Rail.PROCESSING and bool(arn)

    if state not in _TERMINAL and not credited and stale:
        return FinancialFact(
            entity_type, entity_id, Rail.AMBIGUOUS, Confidence.UNKNOWN, True, amount,
            currency,
            f"last observation was {unresolved}s ago in {state.value}; beyond tolerance, so "
            f"the current state is unknown rather than assumed unchanged",
            evidence, now, unresolved, arn)

    # The load-bearing judgement. A refund is only closed once a bank reference exists.
    # 'processed' without an ARN is dispatch, not credit.
    if entity_type == "refund":
        obligation_open = not (state == Rail.PROCESSING and arn)
        if state == Rail.FAILED_TERMINAL:
            obligation_open = False
            reason = "refund failed terminally; no credit will occur on this refund"
        elif obligation_open:
            reason = ("gateway accepted the refund but no ARN/RRN has been received, so the "
                      "customer is not yet credited")
        else:
            reason = f"ARN {arn} received; the bank has a reference for this credit"
            state = Rail.CONFIRMED
    else:
        obligation_open = state in {Rail.INITIATED, Rail.ACCEPTED}
        reason = {
            Rail.INITIATED: "payment created but not authorised",
            Rail.ACCEPTED: "authorised and held; not captured, so funds are not yours yet",
            Rail.CONFIRMED: "captured",
            Rail.REVERSED: "refunded",
            Rail.FAILED_TERMINAL: "payment failed terminally",
        }.get(state, state.value)

    return FinancialFact(entity_type, entity_id, state, conf, obligation_open, amount,
                         currency, reason, evidence, now, unresolved, arn)
