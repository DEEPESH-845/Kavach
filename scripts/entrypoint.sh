#!/bin/sh
# Container entrypoint: seed the ledger if there is none, then serve.
#
# KAVACH_DB          where the event log lives (mount a disk at its directory to persist)
# KAVACH_SEED_ON_START=1   re-seed even if a ledger exists (a clean demo on every deploy)
# PORT               what to listen on (Render and Cloud Run set this themselves)
set -eu

PORT="${PORT:-8000}"
DB="${KAVACH_DB:-/data/kavach.db}"
case "$DB" in postgres*) FILE=0 ;; *) FILE=1; mkdir -p "$(dirname "$DB")" ;; esac

# A store is "fresh" when it is a SQLite file that does not exist yet, or a Postgres
# database with no events table applied yet. `migrate` creates or upgrades the schema and
# is safe to repeat; it reports what it applied so a first start is visible in the log.
FRESH=0
if [ "$FILE" = "1" ] && [ ! -f "$DB" ]; then FRESH=1; fi
if python -m kavach --db "$DB" migrate | grep -q '"applied": \[1'; then FRESH=1; fi

# The demo ledger is seeded only for a demo: a production deployment (KAVACH_DEMO unset)
# starts from an empty, migrated store and never holds invented payments.
case "${KAVACH_DEMO:-}" in 1|true|on) DEMO=1 ;; *) DEMO=0 ;; esac
if [ "$DEMO" = "1" ] && { [ "$FRESH" = "1" ] || [ "${KAVACH_SEED_ON_START:-}" = "1" ]; }; then
  echo "kavach: seeding the demo ledger at $DB"
  python apps/demo_data.py --db "$DB"
elif [ "$DEMO" = "1" ]; then
  echo "kavach: using the existing demo ledger at $DB"
else
  echo "kavach: production start against $DB (no demo seed)"
fi

exec python apps/api_server.py --host 0.0.0.0 --port "$PORT"
