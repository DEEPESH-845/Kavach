"""The duel: one attack sequence, two lanes, same inputs.

LEFT LANE, "ungoverned": the governance boundary is bypassed. Every cart the agent builds is
accepted and every refund it requests executes. That is not a strawman -- it is raw entity
passthrough, which is exactly what `razorpay-mcp-server` plus a capable agent does when
nothing sits between them. Its exposure is DERIVED: the sum of the amounts that executed.

RIGHT LANE, "kavach": the identical carts and the identical refund intent run through
services/gate.admit and services/decisions.evaluate, verbatim. Exposure counts only what
Kavach allowed.

The legitimate cart passes in BOTH lanes. If it did not, the left lane would be a caricature
and the right lane would be refusing everything, which is the useless control ADR-014 warns
about. The gap between the lanes is therefore entirely the attacks.

Deterministic: fixed epoch, fresh in-memory sandbox, the same numbers every run.
"""

from __future__ import annotations

import time
from typing import Any

from .. import governor, ledger
from . import decisions, storefront
from . import gate as gate_service
from .scenarios import T, _payment, _refund, _sandbox, models

#: Inbound steps, in the order the story tells them: what should pass first, then the four
#: attacks the four planes each catch differently.
INBOUND = ("legit", "cap", "scope", "liquid", "drift")


def _refused_by(admission: dict[str, Any]) -> str:
    if admission["envelope_failures"]:
        return "① credential: " + ", ".join(admission["envelope_failures"])
    if admission["scope_violations"]:
        return "① mandate arithmetic: " + ", ".join(admission["scope_violations"])
    factors = admission.get("risk_factors") or []
    if any("drift" in f or "correlation" in f for f in factors):
        return "③ provenance drift + ② entailment"
    if admission["verdict"] == "ALLOW":
        return ""
    return "② entailment model, priced by expected loss"


def run() -> dict[str, Any]:
    conn = _sandbox()
    risk, ent = models()
    mandate = storefront.default_mandate(T)
    steps: list[dict[str, Any]] = []
    ungoverned_total = kavach_total = 0
    ungoverned_bad = kavach_bad = protected = 0

    for n, mode in enumerate(INBOUND, start=1):
        p = storefront.plan(mandate, mode)
        body = {**mandate, "nonce": f"duel_{mode}"}
        out = gate_service.admit(
            conn, envelope_body=body, cart_id=f"duel_cart_{mode}",
            merchant_id=p["merchant_id"], lines=p["lines"], now=T + n * 60,
            expected_principal=mandate["principal_id"],
            untrusted_context=p["untrusted_context"], model=ent, charge=True)
        amount = p["total_minor"]
        allowed = out["verdict"] == "ALLOW"

        ungoverned_total += amount
        if p["attack"]:
            ungoverned_bad += amount
        if allowed:
            kavach_total += amount
            if p["attack"]:
                kavach_bad += amount
        elif p["attack"]:
            protected += amount

        steps.append({
            "n": n, "kind": "inbound", "mode": mode, "title": p["title"],
            "question": p["question"], "attack": p["attack"], "amount_minor": amount,
            "lines": p["lines"],
            "ungoverned": {"executed": True, "amount_minor": amount,
                           "note": "no boundary: the cart is accepted as presented"},
            "kavach": {"verdict": out["verdict"], "reasons": out["reasons"],
                       "refused_by": _refused_by(out), "stages": out["stages"],
                       "purpose_risk": out["purpose_risk"],
                       "executed_minor": amount if allowed else 0},
            "cumulative": _cum(ungoverned_total, kavach_total, ungoverned_bad, kavach_bad,
                               protected),
        })

    # The outbound half: the same obligation refunded twice, mirroring the seeded ledger.
    at = T + 10 * 60
    _payment(conn, "pay_DUEL7742", 849_900, at - 7_200)
    first = governor.new_intent("agent_cx_tier1", "sess_morning", "pay_DUEL7742", 84_900,
                                "Order never arrived, courier marked it delivered in error",
                                at - 2_100)
    policy = governor.Policy(risk_threshold=risk.threshold) if risk else governor.Policy()
    d1, _ = decisions.evaluate(conn, first, now=at - 2_100, policy=policy, model=risk)
    decisions.record(conn, first, d1, now=at - 2_100)
    ledger.settle(conn, first.intent_id, decisions.EXECUTED, result_id="rfnd_DUEL7742A")
    _refund(conn, "rfnd_DUEL7742A", "pay_DUEL7742", 84_900, at - 2_040)

    second = governor.new_intent("agent_cx_tier2", "sess_afternoon", "pay_DUEL7742", 84_900,
                                 "Customer says the package was never delivered, issuing a "
                                 "refund", at)
    d2, truth = decisions.evaluate(conn, second, now=at, policy=policy, model=risk)
    conn.close()

    for n, (intent, d, attack) in enumerate(((first, d1, False), (second, d2, True)),
                                            start=len(steps) + 1):
        allowed = d.action is governor.Action.ALLOW
        ungoverned_total += intent.amount_minor
        if attack:
            ungoverned_bad += intent.amount_minor
        if allowed:
            kavach_total += intent.amount_minor
            if attack:
                kavach_bad += intent.amount_minor
        elif attack:
            protected += intent.amount_minor
        steps.append({
            "n": n, "kind": "outbound", "mode": "duplicate" if attack else "refund",
            "title": ("The same obligation, refunded again from a new session" if attack
                      else "A legitimate refund: order never arrived"),
            "question": ("Is this new intent the same obligation as one already in flight?"
                         if attack else "Does the governor release what it should?"),
            "attack": attack, "amount_minor": intent.amount_minor,
            "reason_text": intent.reason_text, "agent_id": intent.agent_id,
            "session_id": intent.session_id,
            "ungoverned": {"executed": True, "amount_minor": intent.amount_minor,
                           "note": "raw create_refund: the API returns 'processed' and the "
                                   "agent reports success"},
            "kavach": {"verdict": d.action.value, "reasons": d.reasons,
                       "refused_by": ("⑥ obligation ledger + ⑦ duplicate-risk estimator"
                                      if attack and not allowed else ""),
                       "duplicate_risk": d.risk_score, "risk_factors": d.risk_explain,
                       "executed_minor": intent.amount_minor if allowed else 0,
                       "truth": truth if attack else None},
            "cumulative": _cum(ungoverned_total, kavach_total, ungoverned_bad, kavach_bad,
                               protected),
        })

    return {
        "steps": steps,
        "totals": _cum(ungoverned_total, kavach_total, ungoverned_bad, kavach_bad, protected),
        "model_used": {"entailment": ent is not None, "duplicate_risk": risk is not None},
        "sandbox": {"isolated": True, "epoch": T,
                    "note": "both lanes run in one fresh in-memory database seeded at a "
                            "fixed epoch; the operator ledger is untouched and reruns are "
                            "identical"},
        "lanes": {
            "ungoverned": "raw entity passthrough: no mandate check, no obligation "
                          "ledger, no duplicate scoring -- every action executes",
            "kavach": "services/gate.admit and services/decisions.evaluate, verbatim",
        },
        "generated_at": int(time.time()),
    }


def _cum(ug_total: int, kv_total: int, ug_bad: int, kv_bad: int, protected: int) -> dict:
    return {"ungoverned_minor": ug_total, "kavach_minor": kv_total,
            "ungoverned_unauthorised_minor": ug_bad, "kavach_unauthorised_minor": kv_bad,
            "protected_minor": protected}
