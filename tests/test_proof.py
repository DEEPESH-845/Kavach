from __future__ import annotations

import sqlite3

import pytest
from kavach import eventlog, proof


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    eventlog.SCHEMA = eventlog.SCHEMA
    c.executescript(eventlog.SCHEMA)
    yield c
    c.close()


def test_verify_event_chain_valid(conn):
    eventlog.append(conn, source="test", external_id="1", entity_type="test", entity_id="1",
                    event_type="test", payload={"a": 1}, occurred_at=100, received_at=100)
    eventlog.append(conn, source="test", external_id="2", entity_type="test", entity_id="2",
                    event_type="test", payload={"b": 2}, occurred_at=101, received_at=101)
    
    valid, msg = proof.verify_event_chain(conn)
    assert valid is True
    assert "2 events" in msg


def test_verify_event_chain_tampered(conn):
    eventlog.append(conn, source="test", external_id="1", entity_type="test", entity_id="1",
                    event_type="test", payload={"a": 1}, occurred_at=100, received_at=100)
    eventlog.append(conn, source="test", external_id="2", entity_type="test", entity_id="2",
                    event_type="test", payload={"b": 2}, occurred_at=101, received_at=101)
    
    conn.execute("UPDATE events SET payload = '{\"b\": 3}' WHERE external_id = '2'")
    
    valid, msg = proof.verify_event_chain(conn)
    assert valid is False
    assert "Tampering detected" in msg
