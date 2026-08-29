"""Inbound admission, reachable over HTTP.

Everything here is a thin, typed shell around gate.admission. No admission logic lives in
this module and none should: the moment an HTTP handler can reach a second decision path,
the demo and the product start disagreeing about what the system does.

WHAT THE DEMO KEY IS AND IS NOT
-------------------------------
A delegation envelope is signed by the PRINCIPAL -- the human delegating -- with a key the
merchant never holds. There is no such human here, so `demo_principal_key()` derives one
deterministically from a fixed label and registers its public half as a trusted issuer.

That makes the signature check real: `envelope.verify()` performs a genuine Ed25519
verification, a tampered envelope genuinely fails, and the adversary scenarios genuinely
have to produce a valid signature to get past it. What it does NOT do is prove the mandate
came from a real person -- we minted it. The distinction is reported to the caller in every
response (`issuer.simulated`) rather than left for someone to assume the wrong way.

The private key is derived, never stored: a key on disk is a key that gets committed.
"""

from __future__ import annotations

import json
import sqlite3
from hashlib import sha256
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from ..gate import admission, envelope, mandate
from ..intelligence.model import Model

DEMO_KEY_ID = "kavach-demo-principal"
_DEMO_SEED = b"kavach/demo-principal/v1"


def demo_principal_key() -> Ed25519PrivateKey:
    """Deterministic, so a judge replaying a scenario gets byte-identical envelopes."""
    return Ed25519PrivateKey.from_private_bytes(sha256(_DEMO_SEED).digest())


def register_demo_issuer(conn: sqlite3.Connection) -> str:
    """Trust the demo principal's public key. Idempotent."""
    from cryptography.hazmat.primitives.serialization import (
        Encoding,
        PublicFormat,
    )
    pub = demo_principal_key().public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    envelope.register_issuer(conn, DEMO_KEY_ID, pub)
    return DEMO_KEY_ID


def sign(envelope_body: dict[str, Any]) -> tuple[bytes, bytes]:
    """Serialise and sign. Returns the EXACT bytes signed, which is what verify() checks.

    The raw bytes travel with the signature for the reason envelope.py states: re-serialising
    on the far side would make key order load-bearing, and the fix someone reaches for when
    that breaks is to weaken the check.
    """
    raw = json.dumps(envelope_body, sort_keys=True, separators=(",", ":")).encode()
    return raw, demo_principal_key().sign(raw)


def build_cart(cart_id: str, merchant_id: str, lines: list[dict[str, Any]]) -> mandate.Cart:
    """Cart from validated line dicts. Amounts are integer minor units, never floats."""
    return mandate.Cart(
        cart_id=cart_id, merchant_id=merchant_id,
        lines=tuple(mandate.CartLine(
            sku=str(x["sku"]), description=str(x["description"]),
            category=str(x["category"]), unit_amount_minor=int(x["unit_amount_minor"]),
            quantity=int(x.get("quantity", 1)), liquid=bool(x.get("liquid", False)))
            for x in lines))


def _stages(result: admission.Admission, env_ok: bool) -> list[dict[str, Any]]:
    """The admission ladder, as the UI draws it.

    Derived from what the decision actually produced -- never a fixed list of ticks played
    back on a timer. A stage this run never reached says so; it does not claim to have
    passed.
    """
    failures = {f.value for f in result.failures}
    violations = {v.value for v in result.violations}
    deterministic_ok = env_ok and not violations

    def stage(key: str, label: str, detail: str, state: str) -> dict[str, Any]:
        return {"key": key, "label": label, "detail": detail, "state": state}

    def env_stage(key: str, label: str, bad: set[str], detail_ok: str) -> dict[str, Any]:
        hit = sorted(bad & failures)
        if hit:
            return stage(key, label, ", ".join(hit), "FAIL")
        # A signature failure short-circuits parsing, so later envelope checks genuinely
        # did not run. Reporting them as passed would be the exact lie this replaces.
        if failures and not env_ok:
            return stage(key, label, "not reached", "SKIPPED")
        return stage(key, label, detail_ok, "PASS")

    def scope_stage(key: str, label: str, bad: set[str], detail_ok: str) -> dict[str, Any]:
        if not env_ok:
            return stage(key, label, "not reached", "SKIPPED")
        hit = sorted(bad & violations)
        if hit:
            return stage(key, label, ", ".join(hit), "FAIL")
        return stage(key, label, detail_ok, "PASS")

    out = [
        env_stage("signature", "Signature", {"BAD_SIGNATURE", "MALFORMED"},
                  "Ed25519 verified over the raw envelope bytes"),
        env_stage("issuer", "Issuer", {"UNKNOWN_ISSUER"}, "key id is a trusted issuer"),
        env_stage("validity", "Validity window", {"EXPIRED", "NOT_YET_VALID"},
                  "mandate is inside its not_before/not_after window"),
        env_stage("binding", "Principal binding", {"PRINCIPAL_MISMATCH"},
                  "envelope is bound to the expected principal"),
        env_stage("revocation", "Revocation", {"REVOKED"}, "mandate is not revoked"),
        env_stage("replay", "Replay", {"REPLAYED_NONCE"}, "nonce is unspent"),
        scope_stage("merchant", "Merchant", {"MERCHANT_NOT_ALLOWED"},
                    "merchant is on the mandate allowlist"),
        scope_stage("category", "Category scope", {"CATEGORY_OUT_OF_SCOPE", "EMPTY_CART"},
                    "every line sits inside the delegated categories"),
        scope_stage("caps", "Caps",
                    {"PER_TXN_CAP_EXCEEDED", "CUMULATIVE_CAP_EXCEEDED"},
                    "cart fits both the per-transaction and cumulative caps"),
    ]

    if not deterministic_ok:
        out.append(stage("purpose", "Semantic purpose", "not reached", "SKIPPED"))
    elif result.risk is None:
        out.append(stage("purpose", "Semantic purpose",
                         "no entailment model available; caution widened to STEP_UP",
                         "UNAVAILABLE"))
    else:
        out.append(stage("purpose", "Semantic purpose",
                         f"purpose-mismatch risk {result.risk:.2f}",
                         "PASS" if result.verdict is admission.Verdict.ALLOW else "FLAG"))

    out.append(stage("admission", "Admission", result.verdict.value,
                     "PASS" if result.verdict is admission.Verdict.ALLOW else "FAIL"))
    return out


def admit(conn: sqlite3.Connection, *, envelope_body: dict[str, Any], cart_id: str,
          merchant_id: str, lines: list[dict[str, Any]], now: int,
          expected_principal: str | None = None, untrusted_context: str = "",
          model: Model | None = None, charge: bool = True,
          tamper: bool = False) -> dict[str, Any]:
    """Sign this envelope as the demo principal, then run real admission against the cart.

    `tamper=True` signs the envelope and then mutates it, so the bytes on the wire no longer
    match the signature. That is how the forged-mandate scenario is genuinely forged rather
    than asserted: the same verification path that admits a good envelope refuses this one.
    """
    raw, sig = sign(envelope_body)
    if tamper:
        mutated = dict(envelope_body)
        mutated["per_txn_cap_minor"] = int(mutated.get("per_txn_cap_minor", 0)) * 100
        raw = json.dumps(mutated, sort_keys=True, separators=(",", ":")).encode()

    cart = build_cart(cart_id, merchant_id, lines)
    run = admission.admit if charge else admission.decide
    result = run(conn, raw, sig, cart, key_id=DEMO_KEY_ID, now=now,
                 expected_principal=expected_principal or None,
                 untrusted_context=untrusted_context, model=model)

    return {
        **result.to_dict(),
        "cart": {"cart_id": cart.cart_id, "merchant_id": cart.merchant_id,
                 "total_minor": cart.total_minor,
                 "lines": [{"sku": ln.sku, "description": ln.description,
                            "category": ln.category, "quantity": ln.quantity,
                            "unit_amount_minor": ln.unit_amount_minor,
                            "total_minor": ln.total_minor, "liquid": ln.liquid}
                           for ln in cart.lines]},
        "stages": _stages(result, result.envelope is not None),
        "charged_to_mandate": bool(charge and result.verdict is admission.Verdict.ALLOW),
        "entailment_model": model is not None,
        "issuer": {"key_id": DEMO_KEY_ID, "simulated": True,
                   "note": "the principal's signing key is derived locally for this "
                           "environment; the signature check itself is real"},
    }


def inspect(conn: sqlite3.Connection, *, envelope_body: dict[str, Any], now: int,
            expected_principal: str | None = None) -> dict[str, Any]:
    """Is this mandate good, and what does it permit? Does NOT spend the nonce."""
    raw, sig = sign(envelope_body)
    env, failures = envelope.verify(conn, raw, sig, key_id=DEMO_KEY_ID, now=now,
                                    expected_principal=expected_principal or None,
                                    claim_nonce=False)
    if env is None:
        return {"valid": False, "failures": [f.value for f in failures], "mandate": None}

    already = mandate.spent(conn, env.mandate_id)
    return {
        "valid": True, "failures": [],
        "mandate": {
            "mandate_id": env.mandate_id, "principal_id": env.principal_id,
            "agent_id": env.agent_id, "purpose": env.purpose,
            "merchant_allowlist": list(env.merchant_allowlist),
            "categories": list(env.categories),
            "per_txn_cap_minor": env.per_txn_cap_minor,
            "cumulative_cap_minor": env.cumulative_cap_minor,
            "spent_minor": already,
            "remaining_minor": max(0, env.cumulative_cap_minor - already),
            "not_before": env.not_before, "not_after": env.not_after,
            "issued_at": env.issued_at, "nonce": env.nonce,
        },
        "admissions": [{"seq": e.seq, "at": e.occurred_at, "cart_id": e.payload["cart_id"],
                        "total_minor": e.payload["total_minor"],
                        "event_hash": e.event_hash}
                       for e in mandate.prior_admissions(conn, env.mandate_id)],
        "issuer": {"key_id": DEMO_KEY_ID, "simulated": True},
    }
