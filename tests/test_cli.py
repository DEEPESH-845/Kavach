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
