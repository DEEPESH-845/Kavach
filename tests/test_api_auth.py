"""KAVACH_DEMO=0: every private route wants a key; lab surfaces are gone."""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient
from kavach import auth, migrations
from kavach.eventlog import connect


@pytest.fixture(scope="module")
def env(tmp_path_factory):
    with pytest.MonkeyPatch.context() as mp:
        db = str(tmp_path_factory.mktemp("auth") / "auth.db")
        mp.setenv("KAVACH_DB", db)
        mp.setenv("KAVACH_DEMO", "0")
        mp.delenv("KAVACH_AUTH", raising=False)
        mp.delenv("KAVACH_MODE", raising=False)
        mp.setenv("KAVACH_RATE_LIMIT", "1000")
        c = connect(db)
        migrations.apply(c)
        keys = {s: auth.create(c, name=s, scope=s, now=1)["key"] for s in auth.SCOPES}
        c.close()
        import apps.api_server as api
        api = importlib.reload(api)
        with TestClient(api.app) as client:
            client.db_path = db  # type: ignore[attr-defined]
            yield client, keys
        importlib.reload(api)


def _h(key):
    return {"Authorization": f"Bearer {key}"}


def test_health_is_public_and_says_auth_is_required(env):
    client, _ = env
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["auth"]["mode"] == "required"
    assert r.json()["demo"]["reset_enabled"] is False


def test_private_routes_need_a_key(env):
    client, keys = env
    r = client.get("/api/overview")
    assert r.status_code == 401 and r.json()["error"]["code"] == "missing_key"
    r = client.get("/api/overview", headers=_h("kv_readonly_bad"))
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_key"
    assert client.get("/api/overview", headers=_h(keys["readonly"])).status_code == 200


def test_scopes_are_enforced(env):
    client, keys = env
    body = {"agent_id": "a", "session_id": "s", "target_id": "pay_none",
            "amount_minor": 100, "reason_text": "x"}
    r = client.post("/api/governor/evaluate", json=body, headers=_h(keys["readonly"]))
    assert r.status_code == 403 and r.json()["error"]["code"] == "insufficient_scope"
    assert client.post("/api/governor/evaluate", json=body,
                       headers=_h(keys["agent"])).status_code == 200
    assert client.get("/api/keys", headers=_h(keys["agent"])).status_code == 403
    assert client.get("/api/keys", headers=_h(keys["operator"])).status_code == 200


def test_demo_surfaces_are_absent(env):
    client, keys = env
    for path in ("/api/storefront", "/api/duel", "/api/scenarios", "/api/mcp/tools",
                 "/api/checkout/latest"):
        r = client.get(path, headers=_h(keys["operator"]))
        assert r.status_code == 404 and r.json()["error"]["code"] == "demo_disabled", path
    assert client.post("/api/demo/reset", headers=_h(keys["operator"])).status_code == 404
    r = client.post("/api/proof/tamper", json={}, headers=_h(keys["operator"]))
    assert r.status_code == 404 and r.json()["error"]["code"] == "demo_disabled"
    r = client.post("/api/mcp/check_refund", json={"args": {}}, headers=_h(keys["operator"]))
    assert r.status_code == 404 and r.json()["error"]["code"] == "demo_disabled"


def test_keys_can_be_minted_and_revoked_over_http(env):
    client, keys = env
    r = client.post("/api/keys", json={"name": "ci", "scope": "readonly"},
                    headers=_h(keys["operator"]))
    assert r.status_code == 201 and r.json()["key"].startswith("kv_readonly_")
    new = r.json()
    assert client.get("/api/overview", headers=_h(new["key"])).status_code == 200
    r = client.delete(f"/api/keys/{new['key_id']}", headers=_h(keys["operator"]))
    assert r.status_code == 200 and r.json()["revoked"] is True
    assert client.get("/api/overview", headers=_h(new["key"])).status_code == 401
    assert client.delete("/api/keys/key_000000000000",
                         headers=_h(keys["operator"])).status_code == 404


def test_reviewer_is_the_key_name_not_the_body(env, monkeypatch):
    """With the kill switch on, a committed intent escalates; the operator who reviews it
    is recorded by their key's name whatever the body claims."""
    client, keys = env
    monkeypatch.setenv("KAVACH_KILL_SWITCH", "1")
    # the payment must be captured for the invariant to pass: seed one directly
    from kavach.eventlog import append
    c = connect(client.db_path)
    append(c, source="webhook", external_id="pay_R1:captured", entity_type="payment",
           entity_id="pay_R1", event_type="payment.captured",
           payload={"payload": {"payment": {"entity": {
               "id": "pay_R1", "status": "captured", "amount": 50_000, "currency": "INR"}}}},
           occurred_at=1, received_at=1, sig_verified=True)
    c.close()
    r = client.post("/api/governor/evaluate", headers=_h(keys["agent"]), json={
        "agent_id": "a", "session_id": "s", "target_id": "pay_R1", "amount_minor": 100,
        "reason_text": "x", "commit": True})
    assert r.status_code == 200 and r.json()["decision"]["action"] == "ESCALATE", r.text
    intent_id = r.json()["intent_id"]
    r = client.post(f"/api/review/{intent_id}", headers=_h(keys["operator"]),
                    json={"action": "reject", "reviewer": "mallory", "note": "no"})
    assert r.status_code == 200, r.text
    assert r.json()["reviewer"] == "operator"


def test_webhook_and_stepup_token_routes_stay_public(env):
    client, _ = env
    assert client.post("/api/webhooks/razorpay", content=b"{}").status_code == 401  # HMAC
    r = client.get("/api/stepup/AAAAAAAAAAAAAAAAAAAAAAAA")
    assert r.status_code == 404 and r.json()["error"]["code"] not in ("missing_key",
                                                                        "demo_disabled")
    r = client.get("/api/checkout/order_none")
    assert r.status_code in (404, 409, 503) and r.json()["error"]["code"] != "missing_key"


def test_metrics_can_be_locked_with_its_own_key(env, monkeypatch):
    client, _ = env
    assert client.get("/api/metrics").status_code == 200
    monkeypatch.setenv("KAVACH_METRICS_KEY", "scrape-me")
    assert client.get("/api/metrics").status_code == 401
    assert client.get("/api/metrics", headers=_h("scrape-me")).status_code == 200
    assert client.get("/api/metrics?key=scrape-me").status_code == 200
