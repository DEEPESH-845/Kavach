#!/bin/sh
# Container entrypoint: seed the ledger if there is none, then serve.
#
# KAVACH_DB          where the event log lives (mount a disk at its directory to persist)
# KAVACH_SEED_ON_START=1   re-seed even if a ledger exists (a clean demo on every deploy)
# PORT               what to listen on (Render and Cloud Run set this themselves)
set -eu

PORT="${PORT:-8000}"
DB="${KAVACH_DB:-/data/kavach.db}"
mkdir -p "$(dirname "$DB")"

if [ ! -f "$DB" ] || [ "${KAVACH_SEED_ON_START:-}" = "1" ]; then
  echo "kavach: seeding the demo ledger at $DB"
  python apps/demo_data.py --db "$DB"
else
  echo "kavach: using the existing ledger at $DB"
fi

exec python apps/api_server.py --host 0.0.0.0 --port "$PORT"
