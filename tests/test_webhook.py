from __future__ import annotations

import hmac
import json
import threading
from http.server import HTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest
from kavach import eventlog
from kavach.webhook import WebhookHandler


@pytest.fixture
def webhook_server(monkeypatch, tmp_path):
    db_path = str(tmp_path / "test.db")
    monkeypatch.setenv("KAVACH_DB", db_path)
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", "secret")
    
    conn = eventlog.connect(db_path)
    
    server = HTTPServer(("localhost", 0), WebhookHandler)
    port = server.server_address[1]
    
    thread = threading.Thread(target=server.serve_forever)
    thread.daemon = True
    thread.start()
    
    yield port, conn
    
    server.shutdown()
    server.server_close()
    conn.close()


def test_webhook_ingestion(webhook_server):
    port, conn = webhook_server
    
    payload = {
        "event": "refund.processed",
        "created_at": 1700000000,
        "payload": {
            "refund": {
                "entity": {
                    "id": "rfnd_A",
                    "payment_id": "pay_A",
                    "amount": 50000
                }
            }
        }
    }
    body = json.dumps(payload).encode()
    
    import hashlib
    signature = hmac.new(b"secret", body, hashlib.sha256).hexdigest()
    
    req = Request(
        f"http://localhost:{port}/webhooks/razorpay",
        data=body,
        headers={
            "X-Razorpay-Signature": signature,
            "X-Razorpay-Event-Id": "evt_123"
        }
    )
    
    with urlopen(req) as resp:
        assert resp.status == 200
        out = json.loads(resp.read().decode())
        assert out["status"] == "OK"
        
    row = conn.execute("SELECT * FROM events").fetchone()
    assert row["entity_id"] == "rfnd_A"
    assert row["parent_entity_id"] == "pay_A"
    assert row["event_type"] == "refund.processed"
    assert row["sig_verified"] == 1
    
    with urlopen(req) as resp:
        assert resp.status == 200
        
    count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    assert count == 1


def test_webhook_invalid_signature(webhook_server):
    port, conn = webhook_server
    body = b'{"event": "refund.processed"}'
    req = Request(
        f"http://localhost:{port}/webhooks/razorpay",
        data=body,
        headers={"X-Razorpay-Signature": "invalid"}
    )
    
    with pytest.raises(HTTPError) as excinfo:
        urlopen(req)
    assert excinfo.value.code == 401
