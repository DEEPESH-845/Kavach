"""Outside a demo, a principal signs their own mandate and the server only verifies it."""

from __future__ import annotations

import base64
import importlib
import json

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from fastapi.testclient import TestClient
from kavach import auth, migrations
from kavach.eventlog import connect

T = 1_700_000_000


@pytest.fixture(scope="module")
def env(tmp_path_factory):
    with pytest.MonkeyPatch.context() as mp:
        db = str(tmp_path_factory.mktemp("mand") / "m.db")
        mp.setenv("KAVACH_DB", db)
        mp.setenv("KAVACH_DEMO", "0")
        mp.delenv("KAVACH_AUTH", raising=False)
        mp.delenv("KAVACH_MODE", raising=False)
        mp.delenv("KAVACH_POLICY", raising=False)
        c = connect(db)
        migrations.apply(c)
        op = auth.create(c, name="ops", scope="operator", now=1)["key"]
        c.close()
        import apps.api_server as api
        api = importlib.reload(api)
        # Without the entailment model every deterministic pass floors at STEP_UP, which is
        # what the step-up test needs; the signature path is the same either way.
        api._models["entailment"] = None
        with TestClient(api.app) as client:
            client.headers["Authorization"] = f"Bearer {op}"
            client.db_path = db  # type: ignore[attr-defined]
            client.get("/api/health")   # first request creates the tables
            yield client
        importlib.reload(api)


@pytest.fixture(scope="module")
def principal():
    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return priv, base64.b64encode(pub).decode()


def _mandate(nonce: str, now: int) -> dict:
    return {"mandate_id": f"m_{nonce}", "principal_id": "priya", "agent_id": "shopbot",
            "purpose": "weekly groceries for the house", "merchant_allowlist": ["bazaar"],
            "categories": ["grocery"], "per_txn_cap_minor": 500_000,
            "cumulative_cap_minor": 2_000_000, "not_before": now - 60,
            "not_after": now + 3600, "nonce": nonce, "issued_at": now - 60}


def _signed(priv: Ed25519PrivateKey, body: dict, key_id: str) -> dict:
    raw = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    return {"raw_b64": base64.b64encode(raw).decode(),
            "signature_b64": base64.b64encode(priv.sign(raw)).decode(), "key_id": key_id}


LINES = [{"sku": "milk", "description": "Amul Gold milk 1L", "category": "grocery",
          "unit_amount_minor": 7_000, "quantity": 2, "liquid": False}]


def test_demo_issuer_is_not_registered_outside_demo(env):
    c = connect(env.db_path)
    rows = c.execute("SELECT key_id FROM gate_issuers").fetchall()
    c.close()
    assert [r["key_id"] for r in rows] == []


def test_server_signed_mandate_form_is_refused_outside_demo(env):
    import time
    body = {"mandate": _mandate("n0", int(time.time())), "cart_id": "c0",
            "merchant_id": "bazaar", "lines": LINES}
    r = env.post("/api/gate/admit", json=body)
    assert r.status_code == 403 and r.json()["error"]["code"] == "demo_signing_disabled"
    r = env.post("/api/gate/inspect", json=body["mandate"])
    assert r.status_code == 403


def test_register_issuer_sign_and_admit(env, principal):
    import time
    priv, pub_b64 = principal
    r = env.post("/api/issuers", json={"key_id": "priya-phone", "public_key_b64": pub_b64})
    assert r.status_code == 201, r.text
    assert [i["key_id"] for i in env.get("/api/issuers").json()["items"]] == ["priya-phone"]

    now = int(time.time())
    env_ = _signed(priv, _mandate("n1", now), "priya-phone")
    r = env.post("/api/gate/inspect", json={"envelope": env_})
    assert r.status_code == 200 and r.json()["valid"] is True, r.text
    assert r.json()["issuer"] == {"key_id": "priya-phone", "simulated": False}

    r = env.post("/api/gate/admit", json={"envelope": env_, "cart_id": "c1",
                                          "merchant_id": "bazaar", "lines": LINES,
                                          "commit": True})
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["verdict"] == "STEP_UP" and a["envelope_failures"] == []
    assert a["issuer"]["simulated"] is False

    # STEP_UP leaves the nonce unspent (the principal's approval spends it), so the same
    # envelope can be presented again; only an ALLOW or an approval claims it.
    r = env.post("/api/gate/admit", json={"envelope": env_, "cart_id": "c1b",
                                          "merchant_id": "bazaar", "lines": LINES,
                                          "commit": True})
    assert r.json()["verdict"] == "STEP_UP" and r.json()["envelope_failures"] == []


def test_tampered_bytes_and_unknown_keys_are_refused(env, principal):
    import time
    priv, _ = principal
    now = int(time.time())
    good = _signed(priv, _mandate("n2", now), "priya-phone")
    raw = json.loads(base64.b64decode(good["raw_b64"]))
    raw["per_txn_cap_minor"] = 50_000_000
    forged = {**good, "raw_b64": base64.b64encode(
        json.dumps(raw, sort_keys=True, separators=(",", ":")).encode()).decode()}
    r = env.post("/api/gate/admit", json={"envelope": forged, "cart_id": "c2",
                                          "merchant_id": "bazaar", "lines": LINES})
    assert r.json()["verdict"] == "DENY" and "BAD_SIGNATURE" in r.json()["envelope_failures"]

    r = env.post("/api/gate/admit", json={"envelope": {**good, "key_id": "nobody"},
                                          "cart_id": "c3", "merchant_id": "bazaar",
                                          "lines": LINES})
    assert "UNKNOWN_ISSUER" in r.json()["envelope_failures"]

    r = env.post("/api/gate/admit", json={"envelope": {**good, "signature_b64": "!!"},
                                          "cart_id": "c4", "merchant_id": "bazaar",
                                          "lines": LINES})
    assert r.status_code == 422


def test_exactly_one_of_mandate_or_envelope(env, principal):
    r = env.post("/api/gate/admit", json={"cart_id": "c5", "merchant_id": "bazaar",
                                          "lines": LINES})
    assert r.status_code == 422
    assert "mandate" in r.json()["error"]["message"]


def test_step_up_with_a_signed_envelope_re_runs_admission_on_approve(env, principal):
    import time
    priv, _ = principal
    now = int(time.time())
    env_ = _signed(priv, _mandate("n3", now), "priya-phone")
    # no entailment model in this process => every deterministic pass floors at STEP_UP
    r = env.post("/api/stepup", json={"envelope": env_, "cart_id": "c6",
                                      "merchant_id": "bazaar", "lines": LINES})
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    v = env.get(f"/api/stepup/{tok}").json()
    assert v["purpose"] == "weekly groceries for the house" and v["status"] == "PENDING"
    r = env.post(f"/api/stepup/{tok}/resolve", json={"action": "approve"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "APPROVED" and r.json()["charged"] is True
    # approval spent the nonce: the same envelope is now a replay
    r = env.post("/api/gate/admit", json={"envelope": env_, "cart_id": "c6b",
                                          "merchant_id": "bazaar", "lines": LINES})
    assert "REPLAYED_NONCE" in r.json()["envelope_failures"]


def test_removing_an_issuer_makes_its_mandates_unknown(env, principal):
    import time
    priv, _ = principal
    assert env.delete("/api/issuers/priya-phone").status_code == 200
    env_ = _signed(priv, _mandate("n4", int(time.time())), "priya-phone")
    r = env.post("/api/gate/admit", json={"envelope": env_, "cart_id": "c7",
                                          "merchant_id": "bazaar", "lines": LINES})
    assert "UNKNOWN_ISSUER" in r.json()["envelope_failures"]
    assert env.delete("/api/issuers/priya-phone").status_code == 404
