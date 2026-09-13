from __future__ import annotations

import pytest
from kavach import eventlog, proof


@pytest.fixture
def conn():
    c = eventlog.connect(":memory:")
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


def _ev(conn, n: int):
    eventlog.append(conn, source="t", external_id=str(n), entity_type="payment",
                    entity_id=f"pay_{n}", event_type="x", payload={"n": n},
                    occurred_at=n, received_at=n)


def test_status_verifies_incrementally_and_full_scan_still_catches_an_earlier_edit(conn):
    """status() walks only rows appended since the head this process last verified. It
    proves new rows chain to that head; it does not re-prove the prefix -- scan() does."""
    proof._reset_head()
    _ev(conn, 1)
    s1 = proof.status(conn)
    assert s1["ok"] and s1["events"] == 1 and s1["incremental"] is True
    _ev(conn, 2)
    s2 = proof.status(conn)
    assert s2["ok"] and s2["events"] == 2 and s2["checked"] == 2
    conn.execute("UPDATE events SET payload='{}' WHERE seq=1")
    _ev(conn, 3)
    s3 = proof.status(conn)
    assert s3["ok"] and s3["events"] == 3          # the documented limit of incremental
    full = proof.scan(conn)
    assert not full["ok"] and full["broken_at"] == 1


def test_status_detects_a_new_row_that_does_not_chain_to_the_head(conn):
    proof._reset_head()
    _ev(conn, 1)
    assert proof.status(conn)["ok"]
    conn.execute("INSERT INTO events (source, external_id, entity_type, entity_id, "
                 "event_type, payload, occurred_at, received_at, sig_verified, "
                 "previous_event_hash, event_hash) VALUES "
                 "('t','forged','payment','pay_9','x','{}',9,9,0,'nothing','deadbeef')")
    s = proof.status(conn)
    assert not s["ok"] and s["broken_at"] == 2


def test_status_recovers_when_the_log_is_reset_underneath_it(conn):
    proof._reset_head()
    _ev(conn, 1)
    _ev(conn, 2)
    assert proof.status(conn)["events"] == 2
    conn.execute("DELETE FROM events")
    conn.execute("DELETE FROM sqlite_sequence WHERE name='events'")
    _ev(conn, 1)
    s = proof.status(conn)
    assert s["ok"] and s["events"] == 1 and s["checked"] == 1
