"""Delegation envelope: is this agent allowed to be standing here at all?

An agent arrives at checkout holding a mandate its principal signed. Everything downstream
-- caps, scope, entailment -- is arithmetic on fields inside that mandate, so if the mandate
itself is forged, replayed or revoked, none of the arithmetic means anything. This module is
the only thing between an attacker's JSON and the rest of Gate.

Two properties are worth stating because they are easy to lose in a refactor.

The signature is checked over the RAW BYTES, before the JSON is parsed. Verifying a
round-tripped structure instead would fail whenever key order differed from what the issuer
signed -- which invites someone to "fix" it by relaxing the check, and that is how a
signature check becomes a decoration. Parse only what is already proven.

A nonce is claimed only by an envelope that passes every other check. Claiming earlier would
let anyone burn a legitimate mandate's nonce by submitting it with a wrong clock or a wrong
principal, turning replay protection into a denial-of-service primitive.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from enum import StrEnum

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

SCHEMA = """
CREATE TABLE IF NOT EXISTS gate_issuers (
    key_id      TEXT PRIMARY KEY,
    public_key  BLOB NOT NULL          -- raw 32-byte Ed25519 public key
);
CREATE TABLE IF NOT EXISTS gate_nonces (
    nonce       TEXT PRIMARY KEY,      -- claimed once, by one envelope, forever
    mandate_id  TEXT NOT NULL,
    claimed_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gate_revocations (
    mandate_id  TEXT PRIMARY KEY,
    revoked_at  INTEGER NOT NULL,
    reason      TEXT NOT NULL DEFAULT ''
);
"""


class Failure(StrEnum):
    """Why an envelope was refused.

    A bare False cannot be audited, cannot be explained to a merchant, and cannot be
    counted in an eval. Every refusal names itself.
    """

    BAD_SIGNATURE = "BAD_SIGNATURE"
    UNKNOWN_ISSUER = "UNKNOWN_ISSUER"
    EXPIRED = "EXPIRED"
    NOT_YET_VALID = "NOT_YET_VALID"
    REPLAYED_NONCE = "REPLAYED_NONCE"
    PRINCIPAL_MISMATCH = "PRINCIPAL_MISMATCH"
    MALFORMED = "MALFORMED"
    REVOKED = "REVOKED"


@dataclass(frozen=True)
class Envelope:
    mandate_id: str
    principal_id: str            # the human who delegated
    agent_id: str                # the agent acting on their behalf
    purpose: str                 # free text; what entailment is scored against
    merchant_allowlist: tuple[str, ...]
    categories: tuple[str, ...]
    per_txn_cap_minor: int
    cumulative_cap_minor: int
    not_before: int
    not_after: int
    nonce: str
    issued_at: int


def init(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def register_issuer(conn: sqlite3.Connection, key_id: str, public_key: bytes) -> None:
    """Trust a principal's signing key. Configured out of band, never self-asserted.

    A key the envelope carries about itself proves nothing, so the key is looked up by id
    from what the merchant already trusts and an unrecognised id is a typed failure.
    """
    conn.execute("INSERT OR REPLACE INTO gate_issuers (key_id, public_key) VALUES (?,?)",
                 (key_id, public_key))


def revoke(conn: sqlite3.Connection, mandate_id: str, *, at: int, reason: str = "") -> None:
    conn.execute("INSERT OR REPLACE INTO gate_revocations "
                 "(mandate_id, revoked_at, reason) VALUES (?,?,?)", (mandate_id, at, reason))


def is_revoked(conn: sqlite3.Connection, mandate_id: str) -> bool:
    """Read at decision time, never cached. A cached revocation list is a revocation that
    does not work, which is worse than none because it is believed."""
    return conn.execute("SELECT 1 FROM gate_revocations WHERE mandate_id=?",
                        (mandate_id,)).fetchone() is not None


def verify(conn: sqlite3.Connection, raw: bytes, signature: bytes, *, key_id: str,
           now: int, expected_principal: str | None = None, claim_nonce: bool = True
           ) -> tuple[Envelope | None, list[Failure]]:
    """Verify a delegation envelope. Returns (envelope, []) or (None, failures).

    The envelope is returned only when nothing failed. A caller holding a rejected envelope
    is one refactor away from using it, and the failure list already carries everything an
    audit trail or a merchant-facing message needs.

    claim_nonce=False makes this an INSPECTION rather than an admission: the signature,
    window, principal binding and revocation are all still checked, but the nonce is left
    unclaimed so the mandate can still be used. It therefore provides NO replay protection
    and must never gate money. It exists so an agent can ask "is my mandate good and what
    does it permit?" without spending it -- a question that would otherwise cost the very
    envelope it is asking about.
    """
    row = conn.execute("SELECT public_key FROM gate_issuers WHERE key_id=?",
                       (key_id,)).fetchone()
    if row is None:
        return None, [Failure.UNKNOWN_ISSUER]
    try:
        Ed25519PublicKey.from_public_bytes(row["public_key"]).verify(signature, raw)
    except (InvalidSignature, ValueError):
        return None, [Failure.BAD_SIGNATURE]

    try:
        env = _parse(raw)
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None, [Failure.MALFORMED]

    # Everything below is checkable independently, so report all of it at once. A merchant
    # debugging an integration should not need eight round-trips to learn eight things.
    failures: list[Failure] = []
    if now < env.not_before:
        failures.append(Failure.NOT_YET_VALID)
    if now > env.not_after:
        failures.append(Failure.EXPIRED)
    if expected_principal is not None and env.principal_id != expected_principal:
        failures.append(Failure.PRINCIPAL_MISMATCH)
    if is_revoked(conn, env.mandate_id):
        failures.append(Failure.REVOKED)
    if failures:
        return None, failures

    if claim_nonce and not _claim_nonce(conn, env, now):
        return None, [Failure.REPLAYED_NONCE]
    return env, []


def _claim_nonce(conn: sqlite3.Connection, env: Envelope, now: int) -> bool:
    """INSERT OR IGNORE and read rowcount -- the idiom eventlog.append already uses for
    idempotent ingestion. One established pattern, used twice, beats two inventions."""
    cur = conn.execute("INSERT OR IGNORE INTO gate_nonces (nonce, mandate_id, claimed_at) "
                       "VALUES (?,?,?)", (env.nonce, env.mandate_id, now))
    return cur.rowcount == 1


def _minor(value: object) -> int:
    """Money is an integer count of minor units or it is malformed.

    bool is excluded explicitly because it is a subclass of int in Python, and True would
    otherwise sail through as a cap of one paisa.
    """
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"amount must be a non-negative integer of minor units: {value!r}")
    return value


def _parse(raw: bytes) -> Envelope:
    d = json.loads(raw)
    if not isinstance(d, dict):
        raise ValueError("envelope must be a JSON object")
    return Envelope(
        mandate_id=str(d["mandate_id"]),
        principal_id=str(d["principal_id"]),
        agent_id=str(d["agent_id"]),
        purpose=str(d["purpose"]),
        merchant_allowlist=tuple(str(m) for m in d["merchant_allowlist"]),
        categories=tuple(str(c) for c in d["categories"]),
        per_txn_cap_minor=_minor(d["per_txn_cap_minor"]),
        cumulative_cap_minor=_minor(d["cumulative_cap_minor"]),
        not_before=int(d["not_before"]),
        not_after=int(d["not_after"]),
        nonce=str(d["nonce"]),
        issued_at=int(d["issued_at"]),
    )
