#!/usr/bin/env python3
"""Entrypoint: seed the demo ledger by running the real pipeline over a plausible day.

The seed itself lives in kavach.services.demo so the API's "Reset demo" button and this
command produce byte-for-byte the same shape of ledger.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

from kavach.services.demo import seed

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the Kavach demo ledger")
    parser.add_argument("--db", default=os.environ.get("KAVACH_DB", str(ROOT / "kavach.db")))
    parser.add_argument("--keep", action="store_true",
                        help="append instead of clearing the existing ledger")
    args = parser.parse_args()

    started = time.perf_counter()
    counts = seed(args.db, reset=not args.keep)
    print(f"seeded {args.db} in {(time.perf_counter() - started) * 1000:.0f} ms")
    for k, v in counts.items():
        print(f"  {k:<20} {v}")
    if not any(k.startswith("status:") for k in counts):
        print("  no intents recorded", file=sys.stderr)


if __name__ == "__main__":
    main()
