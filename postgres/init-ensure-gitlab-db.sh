#!/bin/sh
# Idempotent GitLab Rails role + database + required extensions on shared PostgreSQL.
set -eu

PGHOST="${PGHOST:-postgres}"
: "${PGUSER:?PGUSER required}"
: "${PGPASSWORD:?PGPASSWORD required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${GITLAB_DB_NAME:?GITLAB_DB_NAME required}"
: "${GITLAB_DB_USER:?GITLAB_DB_USER required}"
: "${GITLAB_DB_PASSWORD:?GITLAB_DB_PASSWORD required}"

export PGPASSWORD="${PGPASSWORD}"

echo "[INFO] Waiting for PostgreSQL at ${PGHOST}..."
until pg_isready -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" >/dev/null 2>&1; do
  sleep 2
done

echo "[INFO] Ensuring GitLab role and database exist..."
psql -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 \
  --set=gitlab_user="${GITLAB_DB_USER}" \
  --set=gitlab_pass="${GITLAB_DB_PASSWORD}" \
  --set=gitlab_db="${GITLAB_DB_NAME}" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'gitlab_user', :'gitlab_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'gitlab_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'gitlab_db', :'gitlab_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'gitlab_db') \gexec
EOSQL

echo "[INFO] Ensuring GitLab extensions in ${GITLAB_DB_NAME}..."
psql -h "${PGHOST}" -U "${PGUSER}" -d "${GITLAB_DB_NAME}" -v ON_ERROR_STOP=1 <<'EOSQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS amcheck;
EOSQL

echo "[INFO] GitLab PostgreSQL objects ready."
