"""API keys: minted once, stored hashed, scoped, revocable."""

from __future__ import annotations

import pytest
from kavach import auth, migrations

T = 1_700_000_000


@pytest.fixture
def db(conn):
    migrations.apply(conn)
    return conn


def test_create_returns_plaintext_once_and_stores_only_a_hash(db):
    out = auth.create(db, name="ops", scope="operator", now=T)
    assert out["key"].startswith("kv_operator_") and len(out["key"]) > 40
    row = db.execute("SELECT * FROM api_keys").fetchone()
    assert out["key"] not in str(dict(row)) and row["key_hash"] and row["name"] == "ops"
    assert "key" not in auth.listing(db)[0]


def test_verify_accepts_the_key_and_touches_last_used(db):
    out = auth.create(db, name="a", scope="agent", now=T)
    k = auth.verify(db, out["key"], now=T + 5)
    assert k and k.scope == "agent" and k.name == "a"
    assert db.execute("SELECT last_used_at FROM api_keys").fetchone()["last_used_at"] == T + 5


def test_verify_rejects_garbage_and_revoked(db):
    assert auth.verify(db, "kv_operator_nope", now=T) is None
    assert auth.verify(db, "", now=T) is None
    out = auth.create(db, name="x", scope="readonly", now=T)
    assert auth.revoke(db, out["key_id"], now=T + 1) is True
    assert auth.verify(db, out["key"], now=T + 2) is None
    assert auth.revoke(db, out["key_id"], now=T + 3) is False


def test_scope_lattice():
    assert auth.allows("operator", "readonly") and auth.allows("agent", "agent")
    assert not auth.allows("readonly", "agent") and not auth.allows("agent", "operator")
    with pytest.raises(ValueError):
        auth.create(None, name="x", scope="root", now=T)


def test_mode_defaults_follow_demo(monkeypatch):
    monkeypatch.delenv("KAVACH_AUTH", raising=False)
    monkeypatch.setenv("KAVACH_DEMO", "1")
    assert auth.mode() == "off"
    monkeypatch.setenv("KAVACH_DEMO", "0")
    assert auth.mode() == "required"
    monkeypatch.setenv("KAVACH_AUTH", "off")
    assert auth.mode() == "off"
    monkeypatch.setenv("KAVACH_DEMO", "1")
    monkeypatch.setenv("KAVACH_AUTH", "required")
    assert auth.mode() == "required"
