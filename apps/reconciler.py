#!/usr/bin/env python3
"""Entrypoint: Reconciliation Engine Worker.

Runs in a loop, periodically finding and settling APPROVED intents.
"""

import argparse
import logging
import os
import time

from kavach import eventlog
from kavach.razorpay.client import Razorpay
from kavach.reconciliation import reconcile_pending_intents

logger = logging.getLogger(__name__)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--interval", type=int, default=30, help="Polling interval in seconds")
    parser.add_argument("--tolerance", type=int, default=60,
                        help="Intent age before reconciling")
    args = parser.parse_args()

    db_path = os.environ.get("KAVACH_DB", "kavach.db")
    conn = eventlog.connect(db_path)
    client = Razorpay()

    logger.info("Starting reconciler loop (interval=%ds, tolerance=%ds) against %s", 
                args.interval, args.tolerance, db_path)

    try:
        while True:
            try:
                settled = reconcile_pending_intents(conn, client, args.tolerance)
                if settled > 0:
                    logger.info("Reconciliation cycle complete. Settled %d intent(s).", settled)
            except Exception as e:
                logger.error("Error during reconciliation cycle: %s", e)
            
            time.sleep(args.interval)
    except KeyboardInterrupt:
        logger.info("Shutting down reconciler...")


if __name__ == "__main__":
    main()
