"""Adversarial tests for delegation-envelope verification.

A signature check exercised only on valid input is untested: it passes identically whether
it verifies anything or returns True. So the happy path is one test here and the attacks are
the rest -- forged, tampered, truncated, expired, replayed, revoked and malformed.
"""

from __future__ import annotations

import json

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from kavach.gate.envelope import Failure, register_issuer, revoke, verify

T = 1_700_000_000
KEY_ID = "principal-key-1"
PRINCIPAL = "usr_priya"


@pytest.fixture
def issuer(conn):
    key = Ed25519PrivateKey.generate()
    register_issuer(conn, KEY_ID, key.public_key().public_bytes_raw())
    return key


def body(**overrides) -> bytes:
    d = {"mandate_id": "mnd_1", "principal_id": PRINCIPAL, "agent_id": "agt_shopper",
         "purpose": "weekly groceries under Rs 2,000",
         "merchant_allowlist": ["mrc_bigbasket"], "categories": ["grocery"],
         "per_txn_cap_minor": 200000, "cumulative_cap_minor": 800000,
         "not_before": T - 60, "not_after": T + 3600,
         "nonce": "nonce-1", "issued_at": T - 60}
    d.update(overrides)
    return json.dumps(d).encode()


def signed(key, **overrides) -> tuple[bytes, bytes]:
    raw = body(**overrides)
    return raw, key.sign(raw)


def check(conn, raw, sig, *, now=T, principal=None):
    return verify(conn, raw, sig, key_id=KEY_ID, now=now, expected_principal=principal)


# ─────────────────────────────────────────────────────────── the one valid case

def test_a_correctly_signed_envelope_verifies(conn, issuer):
    env, failures = check(conn, *signed(issuer), principal=PRINCIPAL)
    assert failures == []
    assert env is not None
    assert env.purpose == "weekly groceries under Rs 2,000"
    assert env.per_txn_cap_minor == 200000
    assert env.merchant_allowlist == ("mrc_bigbasket",)


# ─────────────────────────────────────────────────────────── forgery

def test_a_tampered_payload_fails(conn, issuer):
    """Raise the cap after signing. The bytes no longer match the signature."""
    raw, sig = signed(issuer)
    tampered = raw.replace(b'"per_txn_cap_minor": 200000', b'"per_txn_cap_minor": 900000')
    assert tampered != raw
    assert check(conn, tampered, sig) == (None, [Failure.BAD_SIGNATURE])


def test_a_truncated_signature_fails(conn, issuer):
    raw, sig = signed(issuer)
    assert check(conn, raw, sig[:-1]) == (None, [Failure.BAD_SIGNATURE])


def test_an_empty_signature_fails(conn, issuer):
    raw, _ = signed(issuer)
    assert check(conn, raw, b"") == (None, [Failure.BAD_SIGNATURE])


def test_a_signature_from_a_different_key_fails(conn, issuer):
    """A valid Ed25519 signature over the exact bytes -- by the wrong principal."""
    raw = body()
    assert check(conn, raw, Ed25519PrivateKey.generate().sign(raw)) == (
        None, [Failure.BAD_SIGNATURE])


def test_an_unknown_issuer_is_refused_rather_than_skipped(conn, issuer):
    raw, sig = signed(issuer)
    assert verify(conn, raw, sig, key_id="not-configured", now=T) == (
        None, [Failure.UNKNOWN_ISSUER])


# ─────────────────────────────────────────────────────────── validity window

def test_an_expired_envelope_fails(conn, issuer):
    assert check(conn, *signed(issuer), now=T + 7200) == (None, [Failure.EXPIRED])


def test_an_envelope_used_before_its_window_fails(conn, issuer):
    assert check(conn, *signed(issuer), now=T - 600) == (None, [Failure.NOT_YET_VALID])


def test_the_window_boundaries_are_inclusive(conn, issuer):
    raw, sig = signed(issuer)
    assert check(conn, raw, sig, now=T - 60)[1] == []
    raw2, sig2 = signed(issuer, nonce="nonce-2")
    assert check(conn, raw2, sig2, now=T + 3600)[1] == []


# ─────────────────────────────────────────────────────────── binding and revocation

def test_a_mandate_for_another_principal_fails(conn, issuer):
    assert check(conn, *signed(issuer), principal="usr_someone_else") == (
        None, [Failure.PRINCIPAL_MISMATCH])


def test_revocation_landing_between_issue_and_use_is_honoured(conn, issuer):
    revoke(conn, "mnd_1", at=T - 1, reason="principal revoked from the app")
    assert check(conn, *signed(issuer)) == (None, [Failure.REVOKED])


def test_revocation_is_read_at_decision_time_not_cached(conn, issuer):
    """The same mandate verifies, then stops verifying, with no reload in between."""
    assert check(conn, *signed(issuer))[1] == []
    revoke(conn, "mnd_1", at=T)
    raw, sig = signed(issuer, nonce="nonce-2")
    assert check(conn, raw, sig) == (None, [Failure.REVOKED])


# ─────────────────────────────────────────────────────────── replay

def test_a_nonce_cannot_be_claimed_twice(conn, issuer):
    raw, sig = signed(issuer)
    assert check(conn, raw, sig)[1] == []
    assert check(conn, raw, sig) == (None, [Failure.REPLAYED_NONCE])


def test_a_rejected_envelope_does_not_burn_its_nonce(conn, issuer):
    """Otherwise anyone could disable a mandate by presenting it with a wrong principal."""
    raw, sig = signed(issuer)
    assert check(conn, raw, sig, principal="usr_wrong")[1] == [Failure.PRINCIPAL_MISMATCH]
    assert check(conn, raw, sig, principal=PRINCIPAL)[1] == []


def test_an_unsigned_payload_cannot_burn_a_nonce(conn, issuer):
    """Signature is checked first, so garbage never reaches the nonce table."""
    raw, sig = signed(issuer)
    assert check(conn, raw, b"x" * 64)[1] == [Failure.BAD_SIGNATURE]
    assert check(conn, raw, sig)[1] == []


# ─────────────────────────────────────────────────────────── malformed input

@pytest.mark.parametrize("raw", [b"{not json", b'"a string"', b"[]", b"{}"])
def test_unparseable_bodies_are_malformed(conn, issuer, raw):
    assert check(conn, raw, issuer.sign(raw)) == (None, [Failure.MALFORMED])


@pytest.mark.parametrize("cap", [1500.5, "200000", True, -1, None])
def test_a_cap_that_is_not_a_whole_number_of_minor_units_is_malformed(conn, issuer, cap):
    """True is here deliberately: bool subclasses int, so an unguarded check reads it as 1."""
    assert check(conn, *signed(issuer, per_txn_cap_minor=cap)) == (None, [Failure.MALFORMED])


def test_a_missing_field_is_malformed_not_a_default(conn, issuer):
    raw = json.dumps({"mandate_id": "mnd_1"}).encode()
    assert check(conn, raw, issuer.sign(raw)) == (None, [Failure.MALFORMED])


# ─────────────────────────────────────────────────────────── reporting

def test_independent_failures_are_reported_together(conn, issuer):
    """One round-trip should tell a merchant everything wrong that could be known at once."""
    revoke(conn, "mnd_1", at=T)
    _, failures = check(conn, *signed(issuer), now=T + 7200, principal="usr_wrong")
    assert set(failures) == {Failure.EXPIRED, Failure.PRINCIPAL_MISMATCH, Failure.REVOKED}


def test_a_rejected_envelope_is_never_returned(conn, issuer):
    for kwargs in ({"now": T + 7200}, {"principal": "usr_wrong"}):
        env, failures = check(conn, *signed(issuer), **kwargs)
        assert env is None and failures


# ─────────────────────────────────────────────────────────── inspection mode

def test_inspection_does_not_consume_the_mandate(conn, issuer):
    """An agent asking 'is my mandate good?' must not spend it answering.

    Without this the introspection tool and the admission tool cannot both exist: the
    first call would burn the nonce and the second would fail as a replay.
    """
    raw, sig = signed(issuer)
    env, failures = verify(conn, raw, sig, key_id=KEY_ID, now=T, claim_nonce=False)
    assert env is not None and failures == []
    assert check(conn, raw, sig)[1] == [], "inspection consumed the nonce"


@pytest.mark.parametrize("kwargs,expected", [
    ({"now": T + 7200}, Failure.EXPIRED),
    ({"now": T - 600}, Failure.NOT_YET_VALID),
    ({"expected_principal": "usr_wrong"}, Failure.PRINCIPAL_MISMATCH),
])
def test_inspection_still_enforces_every_other_check(conn, issuer, kwargs, expected):
    """Only replay protection is relaxed. Everything else still refuses."""
    raw, sig = signed(issuer)
    kwargs.setdefault("now", T)
    env, failures = verify(conn, raw, sig, key_id=KEY_ID, claim_nonce=False, **kwargs)
    assert env is None and expected in failures


def test_inspection_cannot_be_used_to_launder_a_bad_signature(conn, issuer):
    raw, _ = signed(issuer)
    assert verify(conn, raw, b"forged", key_id=KEY_ID, now=T, claim_nonce=False) == (
        None, [Failure.BAD_SIGNATURE])
