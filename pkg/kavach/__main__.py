"""`python -m kavach`: operator commands that need no running server.

    python -m kavach migrate                          # create/upgrade the schema
    python -m kavach keys create --name ops --scope operator
    python -m kavach keys list | revoke KEY_ID
    python -m kavach issuers add --key-id X --public-key B64 | list | remove X
    python -m kavach principal keygen                 # an Ed25519 keypair for a principal
    python -m kavach principal sign --private-key B64 --key-id X mandate.json

`--db` is a SQLite path or a postgresql:// URL and defaults to $KAVACH_DB.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import secrets
import sys
import time

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from . import auth, migrations
from .eventlog import connect
from .gate import envelope


def _conn(path: str):
    conn = connect(path)
    applied = migrations.apply(conn)
    envelope.init(conn)
    return conn, applied


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="kavach", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", default=os.environ.get("KAVACH_DB", "kavach.db"),
                   help="SQLite path or postgresql:// URL (default: $KAVACH_DB)")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("migrate", help="create or upgrade the schema; safe to repeat")

    keys = sub.add_parser("keys", help="API keys").add_subparsers(dest="op", required=True)
    c = keys.add_parser("create", help="mint a key; the plaintext is printed once")
    c.add_argument("--name", required=True)
    c.add_argument("--scope", required=True, choices=auth.SCOPES)
    keys.add_parser("list", help="every key, never the secret")
    r = keys.add_parser("revoke", help="revoke a key by id")
    r.add_argument("key_id")

    iss = sub.add_parser("issuers", help="principal keys trusted to sign mandates"
                         ).add_subparsers(dest="op", required=True)
    a = iss.add_parser("add", help="trust a principal's public key")
    a.add_argument("--key-id", required=True)
    a.add_argument("--public-key", required=True, help="base64 of the 32 raw Ed25519 bytes")
    iss.add_parser("list")
    rm = iss.add_parser("remove")
    rm.add_argument("key_id")

    pr = sub.add_parser("principal", help="what a principal runs on their own machine"
                        ).add_subparsers(dest="op", required=True)
    pr.add_parser("keygen", help="a fresh Ed25519 keypair; register the public half")
    sg = pr.add_parser("sign", help="sign a mandate JSON file into an envelope")
    sg.add_argument("--private-key", required=True, help="base64 private key from keygen")
    sg.add_argument("--key-id", required=True, help="the id the merchant registered it under")
    sg.add_argument("mandate", help="path to the mandate JSON")
    return p


def _principal(a: argparse.Namespace) -> int:
    if a.op == "keygen":
        priv = Ed25519PrivateKey.generate()
        pub = priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        from cryptography.hazmat.primitives.serialization import (
            NoEncryption,
            PrivateFormat,
        )
        raw_priv = priv.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
        print(json.dumps({"key_id": f"prin_{secrets.token_hex(6)}",
                          "public_key_b64": base64.b64encode(pub).decode(),
                          "private_key_b64": base64.b64encode(raw_priv).decode()}, indent=2))
        print("keep private_key_b64 on the principal's device only; register public_key_b64 "
              "with the merchant (python -m kavach issuers add, or POST /api/issuers)",
              file=sys.stderr)
        return 0
    with open(a.mandate, "rb") as f:
        body = json.load(f)
    priv = Ed25519PrivateKey.from_private_bytes(base64.b64decode(a.private_key))
    # Compact, sorted: the exact bytes are what gets signed and what travels.
    raw = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    print(json.dumps({"raw_b64": base64.b64encode(raw).decode(),
                      "signature_b64": base64.b64encode(priv.sign(raw)).decode(),
                      "key_id": a.key_id}, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    if a.cmd == "principal":
        return _principal(a)
    conn, applied = _conn(a.db)
    try:
        if a.cmd == "migrate":
            print(json.dumps({"applied": applied, "db": a.db}))
        elif a.cmd == "keys" and a.op == "create":
            out = auth.create(conn, name=a.name, scope=a.scope, now=int(time.time()))
            print(json.dumps(out, indent=2))
            print("store this key now; it is not shown again", file=sys.stderr)
        elif a.cmd == "keys" and a.op == "list":
            print(json.dumps(auth.listing(conn), indent=2))
        elif a.cmd == "keys" and a.op == "revoke":
            ok = auth.revoke(conn, a.key_id, now=int(time.time()))
            print(json.dumps({"revoked": ok, "key_id": a.key_id}))
            return 0 if ok else 1
        elif a.cmd == "issuers" and a.op == "add":
            pub = base64.b64decode(a.public_key)
            if len(pub) != 32:
                print("--public-key must be base64 of 32 raw Ed25519 bytes", file=sys.stderr)
                return 2
            envelope.register_issuer(conn, a.key_id, pub)
            print(json.dumps({"registered": True, "key_id": a.key_id}))
        elif a.cmd == "issuers" and a.op == "list":
            print(json.dumps([{"key_id": i["key_id"],
                               "public_key_b64": base64.b64encode(i["public_key"]).decode()}
                              for i in envelope.list_issuers(conn)], indent=2))
        elif a.cmd == "issuers" and a.op == "remove":
            ok = envelope.remove_issuer(conn, a.key_id)
            print(json.dumps({"removed": ok, "key_id": a.key_id}))
            return 0 if ok else 1
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
