"""KAVACH_POLICY reaches the decision path: limits, tiers, economics, and /api/policy."""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient
from kavach import config

TOML = """
[limits]
max_auto_refund_minor = 50
daily_cap_minor = 100000

[gate]
step_up_minor = 9999

[agents]
"reporting-bot" = "readonly"

[server]
rate_limit_per_minute = 500
cors_origins = ["https://ui.example.test"]
"""


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    with pytest.MonkeyPatch.context() as mp:
        d = tmp_path_factory.mktemp("pol")
        (d / "kavach.toml").write_text(TOML)
        mp.setenv("KAVACH_POLICY", str(d / "kavach.toml"))
        mp.setenv("KAVACH_DB", str(d / "p.db"))
        mp.setenv("KAVACH_DEMO", "1")
        mp.delenv("KAVACH_MODE", raising=False)
        mp.delenv("KAVACH_RATE_LIMIT", raising=False)
        config.reset()
        import apps.api_server as api
        api = importlib.reload(api)
        with TestClient(api.app) as c:
            yield c
        config.reset()
        importlib.reload(api)


def _seed(client):
    from kavach.eventlog import append, connect

    import apps.api_server as api
    c = connect(api.DB_PATH)
    append(c, source="webhook", external_id="pay_P1:captured", entity_type="payment",
           entity_id="pay_P1", event_type="payment.captured",
           payload={"payload": {"payment": {"entity": {
               "id": "pay_P1", "status": "captured", "amount": 50_000, "currency": "INR"}}}},
           occurred_at=1, received_at=1, sig_verified=True)
    c.close()


def test_policy_endpoint_reports_the_file(client):
    p = client.get("/api/policy").json()
    assert p["source"].endswith("kavach.toml")
    assert p["limits"]["max_auto_refund_minor"] == 50
    assert p["limits"]["daily_cap_minor"] == 100_000
    assert p["gate_costs"]["step_up_minor"] == 9999
    assert p["agent_tiers"] == {"reporting-bot": "readonly"}
    assert p["mutable"] is False


def test_file_limits_and_tiers_govern_decisions(client):
    _seed(client)
    body = {"agent_id": "shop-bot", "session_id": "s", "target_id": "pay_P1",
            "amount_minor": 100, "reason_text": "x"}
    d = client.post("/api/governor/evaluate", json=body).json()["decision"]
    assert d["action"] == "ESCALATE"
    assert any("autonomous limit of 0.50" in r for r in d["reasons"])
    d = client.post("/api/governor/evaluate", json={**body, "agent_id": "reporting-bot"}
                    ).json()["decision"]
    assert d["action"] == "DENY" and "read-only tier" in d["reasons"][0]


def test_cors_origin_from_the_file_is_honoured(client):
    r = client.options("/api/overview", headers={
        "Origin": "https://ui.example.test", "Access-Control-Request-Method": "GET"})
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "https://ui.example.test"


def test_an_invalid_file_refuses_to_start(tmp_path, monkeypatch):
    (tmp_path / "bad.toml").write_text("[limits]\nmax_auto_refund_minor = 'lots'\n")
    monkeypatch.setenv("KAVACH_POLICY", str(tmp_path / "bad.toml"))
    config.reset()
    with pytest.raises(config.ConfigError, match="limits.max_auto_refund_minor"):
        config.current()
    config.reset()
