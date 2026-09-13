"""Cryptographic proof plane: is the record we are showing you the record we wrote?

The event log is hash-chained -- each row's `event_hash` covers its own immutable fields AND
its predecessor's hash -- so the log is tamper-EVIDENT. That is a narrower and more honest
claim than tamper-proof: an attacker with write access to the database can still change a
row, but they cannot change it without every subsequent hash failing to reproduce.

What this module does NOT claim, and must never be presented as claiming:

  * It is not a signature. Nothing here proves WHO wrote an event, only that the sequence
    has not been altered since it was written. Provenance for rail events comes from the
    HMAC check on the webhook (`sig_verified`), which is a separate and stronger property.
  * It does not protect against an attacker who rewrites the whole chain from the point of
    the edit forward. Anchoring the head externally is what would close that, and it is not
    done here.

Both limits are reported to the caller in `claims()` rather than left for a reader to
assume the strongest interpretation.
"""

from __future__ import annotations

import hashlib
import threading
from typing import Any

from . import db


def _expected(row: db.Row, prev_hash: str | None) -> str:
    """Recompute a row's hash exactly as eventlog.append computed it.

    Deliberately duplicated rather than shared with append(): a verifier that calls the
    writer's helper verifies that the helper is self-consistent, not that the stored bytes
    are what the writer produced. If these two ever disagree, that disagreement is the
    finding.
    """
    h = hashlib.sha256()
    if prev_hash:
        h.update(prev_hash.encode())
    h.update(f"{row['source']}:{row['external_id']}:{row['entity_type']}:"
             f"{row['entity_id']}:{row['event_type']}:{row['payload']}:"
             f"{row['occurred_at']}:{row['sig_verified']}".encode())
    if row["parent_entity_id"]:
        h.update(row["parent_entity_id"].encode())
    return h.hexdigest()


def scan(conn: db.Connection) -> dict[str, Any]:
    """Walk the whole chain once. Returns the first break, if any, and the head.

    One pass, because every other function here needs the same walk and doing it three times
    per page load is how a proof page becomes the slowest screen in the product.
    """
    rows = conn.execute("SELECT * FROM events ORDER BY seq").fetchall()
    prev_hash: str | None = None
    checked = 0
    for r in rows:
        expected = _expected(r, prev_hash)
        if expected != r["event_hash"]:
            return {"ok": False, "events": len(rows), "checked": checked,
                    "broken_at": int(r["seq"]),
                    "detail": (f"event {r['seq']} does not reproduce its stored hash: "
                               f"expected {expected}, stored {r['event_hash']}"),
                    "head": prev_hash}
        prev_hash = expected
        checked += 1
    return {"ok": True, "events": len(rows), "checked": checked, "broken_at": None,
            "detail": None, "head": prev_hash}


#: Per-process verified head: (seq, hash). A health check every 30 s must not walk a
#: million rows; it walks what arrived since the last check.
_head: tuple[int, str | None] | None = None
_head_lock = threading.Lock()


def _reset_head() -> None:
    global _head
    with _head_lock:
        _head = None


def status(conn: db.Connection) -> dict[str, Any]:
    """Chain status for health and metrics: verifies rows appended since the last head this
    process verified, then advances the head.

    It proves that new rows chain to the verified head -- both that each reproduces its hash
    and that it names the head as its predecessor. It does NOT re-prove rows before that
    head; `scan()` does, and /api/proof/verify calls it. Reported as `incremental: True`
    so a reader knows which claim they are holding. Same keys as scan().
    """
    global _head
    with _head_lock:
        since, prev_hash = _head if _head else (0, None)
        total = conn.execute(
            "SELECT COUNT(*) c, COALESCE(MAX(seq), 0) m FROM events").fetchone()
        if int(total["m"]) < since:  # the log was reset underneath this process
            since, prev_hash = 0, None
        rows = conn.execute("SELECT * FROM events WHERE seq > ? ORDER BY seq",
                            (since,)).fetchall()
        checked = since
        for r in rows:
            expected = _expected(r, prev_hash)
            if expected != r["event_hash"] or r["previous_event_hash"] != prev_hash:
                _head = (since, prev_hash)
                return {"ok": False, "events": int(total["c"]), "checked": checked,
                        "broken_at": int(r["seq"]),
                        "detail": (f"event {r['seq']} does not chain to the verified head: "
                                   f"expected {expected}, stored {r['event_hash']}"),
                        "head": prev_hash, "incremental": True}
            prev_hash, checked = r["event_hash"], checked + 1
        _head = (int(rows[-1]["seq"]) if rows else since, prev_hash)
        return {"ok": True, "events": int(total["c"]), "checked": checked,
                "broken_at": None, "detail": None, "head": prev_hash, "incremental": True}


def verify_event_chain(conn: db.Connection) -> tuple[bool, str]:
    """(valid, human-readable message). The shape the MCP tool surface already returns."""
    s = scan(conn)
    if not s["ok"]:
        return False, f"Tampering detected at seq {s['broken_at']}: {s['detail']}"
    return True, f"Chain intact: {s['events']} events verified."


def verify_range(conn: db.Connection, seqs: list[int]) -> tuple[bool, str]:
    """Are these specific events inside the verified prefix of the chain?

    A single event cannot be verified alone -- its hash covers its predecessor's -- so the
    honest answer is whether the chain is intact up to and including it.
    """
    if not seqs:
        return True, "no events cited"
    s = scan(conn)
    if s["ok"]:
        return True, f"{len(seqs)} cited event(s) verified against an intact chain"
    if max(seqs) < s["broken_at"]:
        return True, (f"{len(seqs)} cited event(s) sit before the break at seq "
                      f"{s['broken_at']} and verify")
    return False, f"the chain breaks at seq {s['broken_at']}, at or before a cited event"


def chain(conn: db.Connection, limit: int = 50,
          before: int | None = None) -> dict[str, Any]:
    """A window of the chain, newest first, each row with its own verification state."""
    status = scan(conn)
    sql = "SELECT * FROM events"
    args: list[Any] = []
    if before is not None:
        sql += " WHERE seq < ?"
        args.append(before)
    sql += " ORDER BY seq DESC LIMIT ?"
    args.append(limit)
    rows = conn.execute(sql, args).fetchall()

    items = []
    for r in rows:
        seq = int(r["seq"])
        verified = status["ok"] or (status["broken_at"] is not None
                                    and seq < status["broken_at"])
        items.append({
            "seq": seq, "source": r["source"], "external_id": r["external_id"],
            "entity_type": r["entity_type"], "entity_id": r["entity_id"],
            "parent_entity_id": r["parent_entity_id"], "event_type": r["event_type"],
            "occurred_at": r["occurred_at"], "received_at": r["received_at"],
            "sig_verified": bool(r["sig_verified"]),
            "previous_event_hash": r["previous_event_hash"],
            "event_hash": r["event_hash"],
            "verified": verified,
        })
    return {
        "items": items,
        "next_before": items[-1]["seq"] if len(items) == limit and items else None,
        "status": status,
        "claims": claims(),
    }


def claims() -> dict[str, str]:
    """What the chain proves and what it does not. Shipped with every proof response so the
    UI cannot overstate it by omission."""
    return {
        "proves": "the ordered event log has not been altered since it was written: every "
                  "row reproduces its stored SHA-256 over its own immutable fields and its "
                  "predecessor's hash",
        "does_not_prove": "who wrote an event. Provenance for rail events comes from the "
                          "HMAC signature check on the webhook, recorded separately as "
                          "sig_verified",
        "limit": "an attacker with write access could rewrite the chain from the point of "
                 "an edit forward. Externally anchoring the head would close that, and is "
                 "not implemented",
        "algorithm": "SHA-256, chained",
    }
