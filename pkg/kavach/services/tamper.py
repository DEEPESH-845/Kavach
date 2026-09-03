"""Break the chain, safely: tamper with a COPY of the event log and watch verification fail.

The proof plane's claim is tamper-EVIDENT, not tamper-proof (proof.py says so in every
response). This module lets a judge test the claim rather than read it: the live database is
backed up into memory, one row's payload is edited there, and proof.scan runs on the copy.
The live ledger is never written -- its own scan is returned alongside so the caller can see
it did not move.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from .. import proof


class TamperError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def _mutate(payload: dict[str, Any]) -> tuple[dict[str, Any], str, Any, Any]:
    """Change the first money-looking field ×10; if there is none, flip the status. Returns
    (mutated, path, original, mutated_value)."""
    def walk(node: Any, path: str) -> tuple[str, Any, Any] | None:
        if isinstance(node, dict):
            for k, v in node.items():
                if k in ("amount", "amount_minor", "total_minor") and isinstance(v, int) \
                        and not isinstance(v, bool):
                    node[k] = v * 10
                    return f"{path}.{k}".lstrip("."), v, v * 10
                found = walk(v, f"{path}.{k}")
                if found:
                    return found
        elif isinstance(node, list):
            for i, v in enumerate(node):
                found = walk(v, f"{path}[{i}]")
                if found:
                    return found
        return None

    copy = json.loads(json.dumps(payload))
    found = walk(copy, "")
    if found:
        path, before, after = found
        return copy, path, before, after
    # No amount anywhere: change something a reader would notice.
    for k in ("status", "action", "decision"):
        if k in copy and isinstance(copy[k], str):
            before = copy[k]
            copy[k] = "tampered"
            return copy, k, before, "tampered"
    copy["tampered"] = True
    return copy, "tampered", None, True


def demo(conn: sqlite3.Connection, *, seq: int | None = None,
         window: int = 8) -> dict[str, Any]:
    live_before = proof.scan(conn)
    if live_before["events"] == 0:
        raise TamperError("empty_log", "the log holds no events to tamper with")

    if seq is None:
        # The newest row that carries money: the edit a fraudster would actually want.
        row = conn.execute(
            "SELECT seq FROM events WHERE entity_type IN ('payment','refund','intent',"
            "'mandate') ORDER BY seq DESC LIMIT 1").fetchone()
        seq = int(row["seq"]) if row else int(live_before["events"])

    mem = sqlite3.connect(":memory:")
    mem.row_factory = sqlite3.Row
    conn.backup(mem)

    target = mem.execute("SELECT * FROM events WHERE seq=?", (seq,)).fetchone()
    if target is None:
        mem.close()
        raise TamperError("no_such_event", f"no event with seq {seq}")
    mutated, path, before, after = _mutate(json.loads(target["payload"]))
    mem.execute("UPDATE events SET payload=? WHERE seq=?",
                (json.dumps(mutated, sort_keys=True), seq))

    after_status = proof.scan(mem)
    lo = max(1, seq - 3)
    rows = mem.execute("SELECT * FROM events WHERE seq >= ? ORDER BY seq LIMIT ?",
                       (lo, window)).fetchall()
    prev_row = mem.execute("SELECT event_hash FROM events WHERE seq < ? ORDER BY seq DESC "
                           "LIMIT 1", (lo,)).fetchone()
    prev_hash = prev_row["event_hash"] if prev_row else None
    out_rows = []
    for r in rows:
        expected = proof._expected(r, prev_hash)
        ok = after_status["ok"] or int(r["seq"]) < after_status["broken_at"]
        out_rows.append({
            "seq": int(r["seq"]), "event_type": r["event_type"], "source": r["source"],
            "entity": f"{r['entity_type']}:{r['entity_id']}",
            "stored_hash": r["event_hash"], "recomputed_hash": expected,
            "verified": ok, "is_target": int(r["seq"]) == seq,
            "halted": (not after_status["ok"]) and int(r["seq"]) > after_status["broken_at"],
        })
        # The chain is walked with what each row STORES as its hash, exactly as scan does.
        prev_hash = r["event_hash"]
    mem.close()

    live_after = proof.scan(conn)
    return {
        "target": {"seq": seq, "field": path, "original": before, "mutated": after,
                   "event_type": target["event_type"],
                   "entity": f"{target['entity_type']}:{target['entity_id']}"},
        "before": live_before,
        "after": after_status,
        "rows": out_rows,
        "live": {"untouched": live_after == live_before, "status": live_after},
        "claims": proof.claims(),
        "note": "the edit was made in an in-memory copy of the log and discarded; the live "
                "ledger's own verification is reported beside it",
    }
