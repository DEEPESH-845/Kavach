"""Tampering happens in a copy, verification fails at the exact row, and the live log is
provably untouched."""

from __future__ import annotations

import pytest
from kavach import proof
from kavach.services import tamper

T = 1_700_000_000


@pytest.fixture
def log(conn, refund_event):
    refund_event("rfnd_A", "created", T)
    refund_event("rfnd_A", "processed", T + 60)
    refund_event("rfnd_B", "created", T + 120, amount=25_000)
    refund_event("rfnd_B", "processed", T + 180, amount=25_000)
    return conn


def test_an_empty_log_is_a_typed_failure(conn):
    with pytest.raises(tamper.TamperError) as e:
        tamper.demo(conn)
    assert e.value.code == "empty_log"


def test_the_edit_breaks_verification_at_the_edited_row_and_halts_after_it(log):
    head_before = proof.scan(log)["head"]
    out = tamper.demo(log, seq=2)
    assert out["before"]["ok"] is True
    assert out["after"]["ok"] is False and out["after"]["broken_at"] == 2
    assert out["target"]["seq"] == 2 and out["target"]["field"].endswith("amount")
    assert out["target"]["mutated"] == out["target"]["original"] * 10
    by_seq = {r["seq"]: r for r in out["rows"]}
    assert by_seq[1]["verified"] is True
    assert by_seq[2]["verified"] is False and by_seq[2]["is_target"]
    assert by_seq[2]["stored_hash"] != by_seq[2]["recomputed_hash"]
    assert by_seq[3]["halted"] and by_seq[4]["halted"]
    # the live log did not move
    assert out["live"]["untouched"] is True
    assert proof.scan(log)["ok"] and proof.scan(log)["head"] == head_before


def test_without_a_seq_the_newest_money_row_is_chosen(log):
    out = tamper.demo(log)
    assert out["target"]["seq"] == 4
    assert out["after"]["broken_at"] == 4


def test_a_missing_seq_is_refused(log):
    with pytest.raises(tamper.TamperError) as e:
        tamper.demo(log, seq=99)
    assert e.value.code == "no_such_event"
