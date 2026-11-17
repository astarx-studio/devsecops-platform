#!/bin/sh
# Idempotent: role ai_review and database ai_review on the shared devtools
# Postgres. The worker creates its own table on start. Does not alter other DBs.
set -eu

log() { echo "[devtools-ai-review-db] $*"; }
die() { echo "[devtools-ai-review-db] ERROR $*" >&2; exit 1; }

: "${PGUSER:?}"
: "${PGPASSWORD:?}"
: "${AI_REVIEW_PG_PASSWORD:?}"
PGHOST="${PGHOST:-devtools-postgres}"

log "Waiting for Postgres at ${PGHOST}:5432..."
i=0
until pg_isready -h "${PGHOST}" -U "${PGUSER}" -d postgres >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && die "Postgres not ready after ${i} attempts"
  sleep 2
done

log "Ensuring role ai_review..."
psql -h "${PGHOST}" -U "${PGUSER}" -d postgres -v ON_ERROR_STOP=1 -v pass="${AI_REVIEW_PG_PASSWORD}" <<'SQL'
SELECT format('CREATE ROLE ai_review LOGIN PASSWORD %L', :'pass')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_review')\gexec
SELECT format('ALTER ROLE ai_review WITH LOGIN PASSWORD %L', :'pass')
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_review')\gexec
SQL

log "Ensuring database ai_review..."
psql -h "${PGHOST}" -U "${PGUSER}" -d postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'CREATE DATABASE ai_review OWNER ai_review'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_review')\gexec
SQL

psql -h "${PGHOST}" -U "${PGUSER}" -d ai_review -v ON_ERROR_STOP=1 <<'SQL'
ALTER SCHEMA public OWNER TO ai_review;
GRANT ALL ON SCHEMA public TO ai_review;
REVOKE CONNECT ON DATABASE ai_review FROM PUBLIC;
GRANT CONNECT ON DATABASE ai_review TO ai_review;
SQL

log "ai_review database ready."
