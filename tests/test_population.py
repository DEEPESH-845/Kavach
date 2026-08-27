import sqlite3

import pytest
from kavach import ledger
from kavach.gate import population


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ledger.init(c)
    yield c
    c.close()


def test_check_velocity_low(conn):
    now = 1000
    risk = population.check_velocity(conn, "agent_1", "princ_1", now=now, window_seconds=3600)
    assert risk.score == 0.0
    assert len(risk.reasons) == 0


def test_check_velocity_high(conn):
    now = 1000
    for i in range(25):
        conn.execute(
            "INSERT INTO intents (intent_id, agent_id, session_id, tool, target_type, "
            "target_id, amount_minor, reason_text, created_at, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (f"int_{i}", "agent_1", "s1", "create_refund", "payment", "pay_1", 100, 
             "test", now - 10, "APPROVED")
        )
    
    risk = population.check_velocity(conn, "agent_1", "princ_1", now=now, window_seconds=3600)
    assert risk.score == 0.6
    assert "high velocity" in risk.reasons[0]


def test_check_velocity_extreme(conn):
    now = 1000
    for i in range(55):
        conn.execute(
            "INSERT INTO intents (intent_id, agent_id, session_id, tool, target_type, "
            "target_id, amount_minor, reason_text, created_at, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (f"int_{i}", "agent_1", "s1", "create_refund", "payment", "pay_1", 100, 
             "test", now - 10, "APPROVED")
        )
    
    risk = population.check_velocity(conn, "agent_1", "princ_1", now=now, window_seconds=3600)
    assert risk.score == 1.0
    assert "extreme velocity" in risk.reasons[0]
