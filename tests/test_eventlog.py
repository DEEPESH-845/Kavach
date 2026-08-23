"""The append-only log. Its one job is to make a redelivered webhook harmless."""

from __future__ import annotations

from kavach.eventlog import append, by_seq, connect, for_entity

T = 1_700_000_000
WEBHOOK = {"event": "refund.processed", "payload": {"refund": {"entity": {"id": "rfnd_A"}}}}


def _append(conn, external_id, event_type, occurred_at, received_at, source="webhook"):
    return append(conn, source=source, external_id=external_id, entity_type="refund",
                  entity_id="rfnd_A", event_type=event_type, payload=WEBHOOK,
                  occurred_at=occurred_at, received_at=received_at, sig_verified=True)


def test_first_append_is_new(conn):
    _, is_new = _append(conn, "evt_1", "refund.processed", 1000, 1001)
    assert is_new is True


def test_redelivered_webhook_is_not_reprocessed(conn):
    """Razorpay redelivers on any non-2xx, sometimes hours later. Downstream must not fire
    twice, and the caller learns that by branching on is_new."""
    seq1, _ = _append(conn, "evt_1", "refund.processed", 1000, 1001)
    seq2, is_new = _append(conn, "evt_1", "refund.processed", 1000, 9999)

    assert is_new is False
    assert seq2 == seq1, "redelivery must resolve to the original event, not a new row"
    assert len(for_entity(conn, "refund", "rfnd_A")) == 1


def test_same_id_from_a_different_source_is_a_distinct_observation(conn):
    """Idempotency is scoped to (source, external_id). A webhook and an API poll that happen
    to share an id are two independent observations and both are evidence."""
    _append(conn, "evt_1", "refund.processed", 1000, 1001)
    _, is_new = _append(conn, "evt_1", "api.fetch_refund", 1002, 1002, source="api_response")
    assert is_new is True


def test_events_are_ordered_causally_not_by_arrival(conn):
    """A state machine fed arrival order walks backwards when webhooks arrive out of order."""
    _append(conn, "evt_1", "refund.processed", 1000, 1001)
    _append(conn, "evt_0", "refund.created", 900, 2000)   # earlier event, arrived later

    assert [e.event_type for e in for_entity(conn, "refund", "rfnd_A")][0] == "refund.created"


def test_by_seq_materialises_an_evidence_chain(conn):
    seq, _ = _append(conn, "evt_1", "refund.processed", 1000, 1001)
    assert [e.seq for e in by_seq(conn, [seq])] == [seq]
    assert by_seq(conn, []) == []


def test_schema_is_created_on_connect():
    c = connect(":memory:")
    assert c.execute("SELECT count(*) FROM events").fetchone()[0] == 0
