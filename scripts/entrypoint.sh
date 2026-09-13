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

# The demo ledger is seeded only for a demo: a production deployment (KAVACH_DEMO unset)
# starts from an empty, migrated store and never holds invented payments.
case "${KAVACH_DEMO:-}" in 1|true|on) DEMO=1 ;; *) DEMO=0 ;; esac
if [ "$DEMO" = "1" ] && { [ ! -f "$DB" ] || [ "${KAVACH_SEED_ON_START:-}" = "1" ]; }; then
  echo "kavach: seeding the demo ledger at $DB"
  python apps/demo_data.py --db "$DB"
elif [ "$DEMO" = "1" ]; then
  echo "kavach: using the existing demo ledger at $DB"
else
  echo "kavach: production start; applying migrations to $DB"
  python -m kavach --db "$DB" keys list >/dev/null
fi

exec python apps/api_server.py --host 0.0.0.0 --port "$PORT"
