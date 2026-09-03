"""One set of tool functions, two transports. The registry is complete, the flags mean what
razorpay-mcp-server's mean, and dispatch calls the same objects the stdio server serves."""

from __future__ import annotations

import importlib
import re
from pathlib import Path

import pytest
from kavach.eventlog import append

T = 1_700_000_000
SRC = Path(__file__).resolve().parents[1] / "pkg" / "kavach" / "mcp" / "server.py"


@pytest.fixture(scope="module")
def srv(tmp_path_factory):
    """The module, imported against a throwaway database. Reloaded so its import-time
    connection points at the temp file and not at whatever `kavach.db` is lying around."""
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("KAVACH_DB", str(tmp_path_factory.mktemp("mcp") / "mcp.db"))
        mp.delenv("KAVACH_MODE", raising=False)
        import kavach.mcp.server as server
        server = importlib.reload(server)
        yield server
        # configure() mutates module state; hand the next module a fresh import.
        importlib.reload(server)


def test_every_decorated_tool_is_in_the_registry(srv):
    decorated = set(re.findall(r"@mcp\.tool\([^)]*\)\s*\ndef (\w+)", SRC.read_text()))
    assert set(srv.TOOLS) == decorated
    assert set(srv.TOOLSET_OF) == decorated
    assert {"create_refund", "create_payment_link", "create_order"} == srv.WRITE_TOOLS


def test_toolsets_mirror_razorpays_vocabulary(srv):
    assert {"payments", "refunds", "payment_links", "orders"} <= set(srv.TOOLSETS)
    assert srv.TOOLSET_OF["create_refund"] == "refunds"
    assert srv.TOOLSET_OF["fetch_payment_link"] == "payment_links"


def test_dispatch_runs_the_dry_run_on_a_payment_in_the_log(srv):
    for status, at in (("authorized", T), ("captured", T + 30)):
        append(srv._conn, source="webhook", external_id=f"pay_HTTP1:{status}",
               entity_type="payment", entity_id="pay_HTTP1", event_type=f"payment.{status}",
               payload={"payload": {"payment": {"entity": {
                   "id": "pay_HTTP1", "status": status, "amount": 50_000,
                   "currency": "INR"}}}},
               occurred_at=at, received_at=at, sig_verified=True)
    out = srv.dispatch("check_refund", {"payment_id": "pay_HTTP1", "amount": "100",
                                         "reason": "shipping fee waived"})
    assert out["dry_run"] is True and out["would"] in ("ALLOW", "ESCALATE", "DENY")
    assert out["truth"]["captured"] is True


def test_unknown_tool_is_a_key_error_and_bad_args_a_type_error(srv):
    with pytest.raises(KeyError):
        srv.dispatch("nope", {})
    with pytest.raises(TypeError):
        srv.dispatch("verify_audit_trail", {"unexpected": 1})


def test_read_only_hides_write_tools_and_compiles_a_refusing_policy(srv):
    out = srv.configure(toolsets={"refunds", "payments"}, read_only=True)
    assert "create_refund" not in out["enabled"]
    assert "check_refund" in out["enabled"]
    assert srv._policy.allow_write is False
    with pytest.raises(KeyError):
        srv.dispatch("create_refund", {"payment_id": "pay_HTTP1", "amount": "1", "reason": "x"})
    with pytest.raises(KeyError):
        srv.dispatch("verify_agent", {"envelope_b64": "", "signature_b64": "", "key_id": "k"})
    assert srv.status()["read_only"] is True and srv.status()["tools"] == 4
    assert all(t["enabled"] == (t["name"] in out["enabled"]) for t in srv.catalogue())


def test_unknown_toolset_is_refused(srv):
    with pytest.raises(ValueError):
        srv.configure(toolsets={"payouts_from_mars"})
