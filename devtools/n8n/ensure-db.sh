#!/bin/sh
# Idempotent: role n8n and database n8n on the shared devtools Postgres.
# Does not alter other databases.
set -eu

log() { echo "[devtools-n8n-db] $*"; }
die() { echo "[devtools-n8n-db] ERROR $*" >&2; exit 1; }

: "${PGUSER:?}"
: "${PGPASSWORD:?}"
: "${N8N_DB_PASSWORD:?}"
PGHOST="${PGHOST:-devtools-postgres}"

log "Waiting for Postgres at ${PGHOST}:5432..."
i=0
until pg_isready -h "${PGHOST}" -U "${PGUSER}" -d postgres >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    die "Postgres not ready after ${i} attempts"
  fi
  sleep 2
done

log "Ensuring role n8n..."
# psql does not substitute variables inside dollar quotes, so \gexec runs the formatted statement.
psql -h "${PGHOST}" -U "${PGUSER}" -d postgres -v ON_ERROR_STOP=1 -v n8n_pass="${N8N_DB_PASSWORD}" <<'SQL'
SELECT format('CREATE ROLE n8n LOGIN PASSWORD %L', :'n8n_pass')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'n8n')\gexec
SELECT format('ALTER ROLE n8n WITH LOGIN PASSWORD %L', :'n8n_pass')
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'n8n')\gexec
SQL

log "Ensuring database n8n..."
psql -h "${PGHOST}" -U "${PGUSER}" -d postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'CREATE DATABASE n8n OWNER n8n'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'n8n')\gexec
SQL

psql -h "${PGHOST}" -U "${PGUSER}" -d n8n -v ON_ERROR_STOP=1 <<'SQL'
GRANT ALL ON SCHEMA public TO n8n;
ALTER SCHEMA public OWNER TO n8n;
REVOKE CONNECT ON DATABASE n8n FROM PUBLIC;
GRANT CONNECT ON DATABASE n8n TO n8n;
SQL

# Default PUBLIC CONNECT would let n8n open every other database.
# Explicit grants already on those databases are left in place.
psql -h "${PGHOST}" -U "${PGUSER}" -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  db text;
BEGIN
  FOR db IN
    SELECT datname
    FROM pg_database
    WHERE datallowconn
      AND datname NOT IN ('n8n', 'template0', 'template1')
  LOOP
    EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', db);
  END LOOP;
END
$$;
SQL

log "n8n database ready."
