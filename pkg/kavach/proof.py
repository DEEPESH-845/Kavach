"""Cryptographic Proof Plane.

Wraps the event log in a tamper-evident audit chain. Provides the verification logic to 
ensure no events have been mutated, reordered, or deleted by an attacker with direct DB access.
"""

from __future__ import annotations

import hashlib
import sqlite3


def verify_event_chain(conn: sqlite3.Connection) -> tuple[bool, str]:
    """Verify that every event's hash accurately reflects its payload and the prior hash.
    
    Returns (True, "OK") if the chain is valid.
    Returns (False, reason) if tampering is detected.
    """
    rows = conn.execute("SELECT * FROM events ORDER BY seq").fetchall()
    prev_hash = None
    for r in rows:
        h = hashlib.sha256()
        if prev_hash:
            h.update(prev_hash.encode())
        
        payload_str = r["payload"]
        h.update(f"{r['source']}:{r['external_id']}:{r['entity_type']}:"
                 f"{r['entity_id']}:{r['event_type']}:{payload_str}:"
                 f"{r['occurred_at']}:{r['sig_verified']}".encode())
        if r["parent_entity_id"]:
            h.update(r["parent_entity_id"].encode())
            
        expected = h.hexdigest()
        if expected != r["event_hash"]:
            return (False, 
                    f"Tampering detected at seq {r['seq']}: "
                    f"expected hash {expected}, got {r['event_hash']}")
        prev_hash = expected
        
    return True, f"Chain intact: {len(rows)} events verified."
