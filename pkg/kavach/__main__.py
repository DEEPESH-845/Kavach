"""`python -m kavach`: operator commands that need no running server.

    python -m kavach keys create --name ops --scope operator
    python -m kavach keys list
    python -m kavach keys revoke key_...

`--db` is a SQLite path or a postgresql:// URL and defaults to $KAVACH_DB.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

from . import auth, migrations
from .eventlog import connect


def _conn(path: str):
    conn = connect(path)
    migrations.apply(conn)
    return conn


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="kavach", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", default=os.environ.get("KAVACH_DB", "kavach.db"),
                   help="SQLite path or postgresql:// URL (default: $KAVACH_DB)")
    sub = p.add_subparsers(dest="cmd", required=True)

    keys = sub.add_parser("keys", help="API keys").add_subparsers(dest="op", required=True)
    c = keys.add_parser("create", help="mint a key; the plaintext is printed once")
    c.add_argument("--name", required=True)
    c.add_argument("--scope", required=True, choices=auth.SCOPES)
    keys.add_parser("list", help="every key, never the secret")
    r = keys.add_parser("revoke", help="revoke a key by id")
    r.add_argument("key_id")
    return p


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    conn = _conn(a.db)
    try:
        if a.cmd == "keys" and a.op == "create":
            out = auth.create(conn, name=a.name, scope=a.scope, now=int(time.time()))
            print(json.dumps(out, indent=2))
            print("store this key now; it is not shown again", file=sys.stderr)
        elif a.cmd == "keys" and a.op == "list":
            print(json.dumps(auth.listing(conn), indent=2))
        elif a.cmd == "keys" and a.op == "revoke":
            ok = auth.revoke(conn, a.key_id, now=int(time.time()))
            print(json.dumps({"revoked": ok, "key_id": a.key_id}))
            return 0 if ok else 1
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
