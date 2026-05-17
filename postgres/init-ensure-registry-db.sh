#!/bin/sh
# Idempotent container registry metadata role + database on shared PostgreSQL.
set -eu

PGHOST="${PGHOST:-postgres}"
: "${PGUSER:?PGUSER required}"
: "${PGPASSWORD:?PGPASSWORD required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${REGISTRY_DB_NAME:?REGISTRY_DB_NAME required}"
: "${REGISTRY_DB_USER:?REGISTRY_DB_USER required}"
: "${REGISTRY_DB_PASSWORD:?REGISTRY_DB_PASSWORD required}"

export PGPASSWORD="${PGPASSWORD}"

echo "[INFO] Waiting for PostgreSQL at ${PGHOST}..."
until pg_isready -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" >/dev/null 2>&1; do
  sleep 2
done

echo "[INFO] Ensuring registry metadata role and database exist..."
psql -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 \
  --set=registry_user="${REGISTRY_DB_USER}" \
  --set=registry_pass="${REGISTRY_DB_PASSWORD}" \
  --set=registry_db="${REGISTRY_DB_NAME}" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'registry_user', :'registry_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'registry_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'registry_db', :'registry_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'registry_db') \gexec
EOSQL

echo "[INFO] Registry metadata PostgreSQL objects ready."
