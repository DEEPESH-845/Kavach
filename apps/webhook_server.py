#!/usr/bin/env python3
"""Entrypoint: Webhook Server."""

import argparse
import logging
from http.server import HTTPServer

from kavach.webhook import WebhookHandler


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    server = HTTPServer(("", args.port), WebhookHandler)
    logging.info("Listening for webhooks on port %d...", args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logging.info("Shutting down...")


if __name__ == "__main__":
    main()
