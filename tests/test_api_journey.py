"""The HTTP seams the buyer journey rides on, driven end to end in replay mode.

Nothing here reaches Razorpay. What is asserted is the shape of every new endpoint, its
refusals, the error envelope, the demo gate, the rate limit and the request id -- the
contract the storefront, the phone page and the tour are built against.
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient

T_MODEL_FREE_VERDICTS = {"ALLOW", "STEP_UP", "HOLD", "DENY"}


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    with pytest.MonkeyPatch.context() as mp:
        db = tmp_path_factory.mktemp("api") / "api.db"
        mp.setenv("KAVACH_DB", str(db))
        mp.setenv("KAVACH_DEMO", "1")
        mp.setenv("KAVACH_RATE_LIMIT", "1000")
        mp.delenv("KAVACH_MODE", raising=False)
        # The MCP module opens its own connection at import; point it at the same file.
        import kavach.mcp.server as mcp_server
        importlib.reload(mcp_server)
        import apps.api_server as api
        api = importlib.reload(api)
        with TestClient(api.app) as c:
            yield c
        importlib.reload(mcp_server)


def _admit(client, mode: str, *, commit: bool, nonce: str, cart_id: str):
    store = client.get("/api/storefront").json()
    mandate = {**store["mandate"], "nonce": nonce}
    plan = client.post("/api/storefront/plan", json={"mandate": mandate, "mode": mode}).json()
    body = {"mandate": mandate, "cart_id": cart_id, "merchant_id": plan["merchant_id"],
            "lines": [{k: v for k, v in ln.items() if k != "name"} for ln in plan["lines"]],
            "untrusted_context": plan["untrusted_context"], "commit": commit}
    return body, client.post("/api/gate/admit", json=body)


def test_health_names_what_this_environment_is(client):
    h = client.get("/api/health")
    assert h.status_code == 200 and h.headers["X-Request-Id"].startswith("req_")
    d = h.json()
    assert d["razorpay"]["checkout"] is False        # replay: nothing can be paid for
    assert d["webhook"]["configured"] is False
    assert d["demo"]["reset_enabled"] is True
    assert d["mcp"]["available"] is True and d["mcp"]["tools"] >= 10


def test_the_storefront_and_the_agents_plans(client):
    s = client.get("/api/storefront").json()
    assert len(s["products"]) == 14 and len(s["scenarios"]) == 6
    assert s["mandate"]["per_txn_cap_minor"] == 500_000
    cap = client.post("/api/storefront/plan", json={"mandate": s["mandate"], "mode": "cap"})
    assert cap.status_code == 200 and cap.json()["total_minor"] > 500_000
    assert cap.json()["trace"]
    bad = client.post("/api/storefront/plan", json={"mandate": s["mandate"], "mode": "yolo"})
    assert bad.status_code == 404 and bad.json()["error"]["code"] == "unknown_mode"
    shape = client.post("/api/storefront/plan", json={"mandate": {}, "mode": "cap"})
    assert shape.status_code == 422 and shape.json()["error"]["code"] == "invalid_request"


def test_admission_over_http_denies_the_cap_breach_by_arithmetic(client):
    _, r = _admit(client, "cap", commit=False, nonce="n_cap", cart_id="cart_cap")
    assert r.status_code == 200
    a = r.json()
    assert a["verdict"] == "DENY" and "PER_TXN_CAP_EXCEEDED" in a["scope_violations"]
    assert [s["state"] for s in a["stages"] if s["key"] == "caps"] == ["FAIL"]


def test_step_up_is_a_real_cross_device_state_machine(client):
    body, _ = _admit(client, "stepup", commit=False, nonce="n_su", cart_id="cart_su")
    r = client.post("/api/stepup", json=body)
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    assert r.json()["approve_path"] == f"/approve/?t={tok}"
    assert r.json()["admission"]["verdict"] in ("STEP_UP", "HOLD")

    v = client.get(f"/api/stepup/{tok}").json()
    assert v["status"] == "PENDING" and v["amount_minor"] == 250_000
    assert "nonce" not in v

    assert client.get("/api/stepup/not-a-real-token-xxxxxxxx").status_code == 404
    assert client.get("/api/stepup/short").status_code == 404

    bad = client.post(f"/api/stepup/{tok}/resolve", json={"action": "maybe"})
    assert bad.status_code == 422

    deny = client.post(f"/api/stepup/{tok}/resolve", json={"action": "deny"})
    assert deny.status_code == 200 and deny.json()["status"] == "DENIED"
    again = client.post(f"/api/stepup/{tok}/resolve", json={"action": "deny"})
    assert again.status_code == 200 and again.json()["applied"] is False
    flip = client.post(f"/api/stepup/{tok}/resolve", json={"action": "approve"})
    assert flip.status_code == 409 and flip.json()["error"]["code"] == "already_resolved"


def test_a_denied_cart_cannot_open_a_step_up(client):
    body, _ = _admit(client, "cap", commit=False, nonce="n_cap2", cart_id="cart_cap2")
    r = client.post("/api/stepup", json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_step_up"


def test_checkout_refuses_unadmitted_carts_and_is_honest_about_replay_mode(client):
    body, _ = _admit(client, "legit", commit=False, nonce="n_ck", cart_id="cart_ck")
    req = {"cart_id": "cart_ck", "mandate_id": body["mandate"]["mandate_id"]}
    r = client.post("/api/checkout", json=req)
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_admitted"
    assert client.get("/api/checkout/order_nope").status_code == 404
    assert client.get("/api/checkout/latest").json() == {"payment": None}
    assert client.post("/api/checkout/confirm", json={
        "order_id": "order_x", "payment_id": "pay_y", "signature": "zz"}).status_code == 422


def test_the_webhook_route_fails_closed_without_a_secret(client):
    r = client.post("/api/webhooks/razorpay", content=b"{}",
                    headers={"X-Razorpay-Signature": "abc"})
    assert r.status_code == 401
    assert client.post("/api/webhooks/razorpay", content=b"{}").status_code == 401


def test_the_duel_is_served_derived_from_the_sandbox(client):
    d = client.get("/api/duel").json()
    assert len(d["steps"]) == 7 and d["sandbox"]["isolated"] is True
    assert d["totals"]["ungoverned_minor"] == sum(s["amount_minor"] for s in d["steps"])


def test_reset_seeds_and_tamper_breaks_a_copy_only(client):
    r = client.post("/api/demo/reset")
    assert r.status_code == 200 and r.json()["counts"]["events"] > 10
    before = client.get("/api/proof/verify").json()
    assert before["ok"] is True
    t = client.post("/api/proof/tamper", json={}).json()
    assert t["after"]["ok"] is False and t["live"]["untouched"] is True
    assert any(row["is_target"] and not row["verified"] for row in t["rows"])
    assert client.get("/api/proof/verify").json()["ok"] is True
    assert client.post("/api/proof/tamper", json={"seq": 99999}).status_code == 404


def test_reset_is_refused_when_the_demo_gate_is_off(client, monkeypatch):
    monkeypatch.delenv("KAVACH_DEMO", raising=False)
    r = client.post("/api/demo/reset")
    assert r.status_code == 403 and r.json()["error"]["code"] == "demo_disabled"


def test_the_mcp_surface_dispatches_to_the_real_tool_functions(client):
    tools = client.get("/api/mcp/tools").json()
    names = {t["name"] for t in tools["tools"]}
    assert {"check_refund", "create_refund", "admit_cart", "fetch_payment_link"} <= names
    assert tools["seeded_targets"], "the seeded ledger offers targets"
    target = tools["seeded_targets"][0]
    r = client.post("/api/mcp/check_refund", json={"args": {
        "payment_id": target, "amount": "10", "reason": "shipping fee waived"}})
    assert r.status_code == 200, r.text
    assert r.json()["result"]["dry_run"] is True and r.json()["write"] is False
    assert client.post("/api/mcp/nope", json={"args": {}}).status_code == 404
    bad = client.post("/api/mcp/check_refund", json={"args": {"payment_id": target}})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_arguments"
    money = client.post("/api/mcp/check_refund", json={"args": {
        "payment_id": target, "amount": "-5", "reason": "x"}})
    assert money.status_code == 422
    ugly = client.post("/api/mcp/check_refund", json={"args": {"bad key!": 1}})
    assert ugly.status_code == 422
    huge = client.post("/api/mcp/check_refund", json={"args": {"reason": "x" * 30_000}})
    assert huge.status_code == 422 and "20 kB" in huge.json()["error"]["message"]


def test_metrics_is_prometheus_text(client):
    r = client.get("/api/metrics")
    assert r.status_code == 200 and "kavach_events_total" in r.text
    assert "kavach_chain_intact 1" in r.text


def test_an_incoming_request_id_is_echoed_when_it_is_sane(client):
    ok = client.get("/api/health", headers={"X-Request-Id": "trace-42"})
    assert ok.headers["X-Request-Id"] == "trace-42"
    bad = client.get("/api/health", headers={"X-Request-Id": "<script>"})
    assert bad.headers["X-Request-Id"].startswith("req_")


def test_the_rate_limit_answers_429_with_the_error_envelope(client):
    from kavach.services import ratelimit

    from apps import api_server
    saved = api_server._bucket
    api_server._bucket = ratelimit.Bucket(3)
    try:
        codes = [client.get("/api/checkout/latest").status_code for _ in range(5)]
        assert codes[:3] == [200, 200, 200] and 429 in codes[3:]
        r = client.get("/api/checkout/latest")
        assert r.json()["error"]["code"] == "rate_limited"
    finally:
        api_server._bucket = saved
