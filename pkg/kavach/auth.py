"""API keys: who is calling, and what they may do.

Three scopes, ordered: readonly < agent < operator. A key is minted once, shown once, and
stored only as a SHA-256 hash -- the table of keys must not itself be a credential store
worth stealing. Verification hashes the presented token and looks the hash up; the hash is
the index rather than something compared byte by byte, so there is no timing channel.

KAVACH_AUTH decides whether the API demands a key. It defaults to `required`, except that a
deployment which explicitly says KAVACH_DEMO=1 defaults to `off` -- a demo a judge opens
from a link cannot ask them for a key. Either default can be overridden.
"""

from __future__ import annotations

import hashlib
import os
import secrets
from dataclasses import dataclass

from . import db

SCHEMA = """
CREATE TABLE IF NOT EXISTS api_keys (
    key_id       TEXT PRIMARY KEY,
    key_hash     TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    scope        TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    revoked_at   INTEGER,
    last_used_at INTEGER
);
"""

SCOPES: tuple[str, ...] = ("readonly", "agent", "operator")


@dataclass(frozen=True)
class Key:
    key_id: str
    name: str
    scope: str


def allows(held: str, needed: str) -> bool:
    return SCOPES.index(held) >= SCOPES.index(needed)


def mode() -> str:
    """`required` or `off`. See the module docstring for the defaults."""
    explicit = os.environ.get("KAVACH_AUTH", "").strip().lower()
    if explicit in {"required", "off"}:
        return explicit
    demo = os.environ.get("KAVACH_DEMO", "").strip().lower() in {"1", "true", "on"}
    return "off" if demo else "required"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create(conn: db.Connection, *, name: str, scope: str, now: int) -> dict:
    """Mint a key. The plaintext is in the result and nowhere else, ever."""
    if scope not in SCOPES:
        raise ValueError(f"scope must be one of {', '.join(SCOPES)}")
    if not name or len(name) > 64:
        raise ValueError("name must be 1-64 characters")
    token = f"kv_{scope}_{secrets.token_urlsafe(24)}"
    key_id = f"key_{secrets.token_hex(6)}"
    conn.execute("INSERT INTO api_keys (key_id, key_hash, name, scope, created_at) "
                 "VALUES (?,?,?,?,?)", (key_id, _hash(token), name, scope, now))
    return {"key": token, "key_id": key_id, "name": name, "scope": scope, "created_at": now}


def verify(conn: db.Connection, token: str, *, now: int) -> Key | None:
    if not token or not token.startswith("kv_"):
        return None
    row = conn.execute("SELECT key_id, name, scope FROM api_keys WHERE key_hash=? "
                       "AND revoked_at IS NULL", (_hash(token),)).fetchone()
    if row is None:
        return None
    conn.execute("UPDATE api_keys SET last_used_at=? WHERE key_id=?", (now, row["key_id"]))
    return Key(row["key_id"], row["name"], row["scope"])


def listing(conn: db.Connection) -> list[dict]:
    rows = conn.execute("SELECT key_id, name, scope, created_at, revoked_at, last_used_at "
                        "FROM api_keys ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def revoke(conn: db.Connection, key_id: str, *, now: int) -> bool:
    cur = conn.execute("UPDATE api_keys SET revoked_at=? WHERE key_id=? "
                       "AND revoked_at IS NULL", (now, key_id))
    return cur.rowcount == 1
