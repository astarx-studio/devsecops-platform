#!/bin/sh
# Idempotent role + database for DSOaaS GitLab plugin state on shared PostgreSQL.
# Deliberately separate from gitlabhq_production: the plugin role gets no access to
# GitLab's database, and GitLab's role gets none to this one.
set -eu

PGHOST="${PGHOST:-postgres}"
: "${PGUSER:?PGUSER required}"
: "${PGPASSWORD:?PGPASSWORD required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${GITLAB_PLUGINS_DB_NAME:?GITLAB_PLUGINS_DB_NAME required}"
: "${GITLAB_PLUGINS_DB_USER:?GITLAB_PLUGINS_DB_USER required}"
: "${GITLAB_PLUGINS_DB_PASSWORD:?GITLAB_PLUGINS_DB_PASSWORD required}"

export PGPASSWORD="${PGPASSWORD}"

echo "[INFO] Waiting for PostgreSQL at ${PGHOST}..."
until pg_isready -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" >/dev/null 2>&1; do
  sleep 2
done

echo "[INFO] Ensuring GitLab plugins role and database exist..."
psql -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 \
  --set=plugins_user="${GITLAB_PLUGINS_DB_USER}" \
  --set=plugins_pass="${GITLAB_PLUGINS_DB_PASSWORD}" \
  --set=plugins_db="${GITLAB_PLUGINS_DB_NAME}" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'plugins_user', :'plugins_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'plugins_user') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'plugins_user', :'plugins_pass') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'plugins_db', :'plugins_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'plugins_db') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'plugins_db') \gexec
EOSQL

echo "[INFO] GitLab plugins PostgreSQL objects ready."
