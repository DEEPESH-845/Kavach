"""`python -m kavach`: the operator commands that need no running server."""

from __future__ import annotations

import json
import subprocess
import sys


def _run(*args, db):
    return subprocess.run([sys.executable, "-m", "kavach", "--db", db, *args],
                          capture_output=True, text=True, check=False)


def test_keys_create_list_revoke(tmp_path):
    db = str(tmp_path / "k.db")
    out = _run("keys", "create", "--name", "ops", "--scope", "operator", db=db)
    assert out.returncode == 0, out.stderr
    created = json.loads(out.stdout)
    assert created["key"].startswith("kv_operator_")
    assert "not shown again" in out.stderr
    listed = json.loads(_run("keys", "list", db=db).stdout)
    assert listed[0]["key_id"] == created["key_id"] and "key" not in listed[0]
    assert _run("keys", "revoke", created["key_id"], db=db).returncode == 0
    assert json.loads(_run("keys", "list", db=db).stdout)[0]["revoked_at"]
    assert _run("keys", "revoke", created["key_id"], db=db).returncode == 1
    assert _run("keys", "create", "--name", "x", "--scope", "root", db=db).returncode == 2


def test_principal_keygen_sign_and_issuers_round_trip(tmp_path):
    import base64

    from kavach.eventlog import connect
    from kavach.gate import envelope

    db = str(tmp_path / "p.db")
    out = _run("principal", "keygen", db=db)
    assert out.returncode == 0, out.stderr
    kp = json.loads(out.stdout)
    assert kp["key_id"].startswith("prin_")
    assert len(base64.b64decode(kp["public_key_b64"])) == 32

    add = _run("issuers", "add", "--key-id", kp["key_id"], "--public-key",
               kp["public_key_b64"], db=db)
    assert add.returncode == 0, add.stderr
    listed = json.loads(_run("issuers", "list", db=db).stdout)
    assert [i["key_id"] for i in listed] == [kp["key_id"]]

    mandate = tmp_path / "mandate.json"
    mandate.write_text(json.dumps({
        "mandate_id": "m1", "principal_id": "priya", "agent_id": "bot",
        "purpose": "groceries", "merchant_allowlist": ["bazaar"], "categories": ["grocery"],
        "per_txn_cap_minor": 1000, "cumulative_cap_minor": 5000, "not_before": 1,
        "not_after": 10**10, "nonce": "n1", "issued_at": 1}))
    sig = _run("principal", "sign", "--private-key", kp["private_key_b64"],
               "--key-id", kp["key_id"], str(mandate), db=db)
    assert sig.returncode == 0, sig.stderr
    env = json.loads(sig.stdout)
    assert set(env) == {"raw_b64", "signature_b64", "key_id"}

    c = connect(db)
    envelope.init(c)
    got, failures = envelope.verify(c, base64.b64decode(env["raw_b64"]),
                                    base64.b64decode(env["signature_b64"]),
                                    key_id=env["key_id"], now=5)
    assert failures == [] and got is not None and got.mandate_id == "m1"
    assert _run("issuers", "remove", kp["key_id"], db=db).returncode == 0
    assert _run("issuers", "remove", kp["key_id"], db=db).returncode == 1


def test_migrate_is_idempotent(tmp_path):
    db = str(tmp_path / "m.db")
    first = json.loads(_run("migrate", db=db).stdout)
    assert first["applied"]
    assert json.loads(_run("migrate", db=db).stdout)["applied"] == []


def test_backup_copies_a_sqlite_ledger(tmp_path):
    db = str(tmp_path / "live.db")
    _run("keys", "create", "--name", "a", "--scope", "readonly", db=db)
    dest = tmp_path / "copy.db"
    out = _run("backup", str(dest), db=db)
    assert out.returncode == 0, out.stderr
    from kavach.eventlog import connect
    assert connect(str(dest)).execute("SELECT COUNT(*) c FROM api_keys").fetchone()["c"] == 1
    assert _run("backup", str(dest), db=db).returncode == 1   # refuses to overwrite


def test_reconcile_once_runs_without_a_provider(tmp_path):
    db = str(tmp_path / "r.db")
    out = _run("reconcile", "--once", db=db)
    assert out.returncode == 0, out.stderr
    assert json.loads(out.stdout)["settled"] == 0
