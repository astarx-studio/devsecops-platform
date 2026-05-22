#!/bin/sh
# Idempotent OpenBao role + database on shared PostgreSQL (password-safe).
# Used by postgres-vault-init and can be run manually against an existing cluster.
set -eu

PGHOST="${PGHOST:-postgres}"
: "${PGUSER:?PGUSER required}"
: "${PGPASSWORD:?PGPASSWORD required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${VAULT_DB_NAME:?VAULT_DB_NAME required}"
: "${VAULT_DB_USER:?VAULT_DB_USER required}"
: "${VAULT_DB_PASSWORD:?VAULT_DB_PASSWORD required}"

export PGPASSWORD="${PGPASSWORD}"

echo "[INFO] Waiting for PostgreSQL at ${PGHOST}..."
until pg_isready -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" >/dev/null 2>&1; do
  sleep 2
done

echo "[INFO] Ensuring OpenBao role and database exist..."
psql -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 \
  --set=vault_user="${VAULT_DB_USER}" \
  --set=vault_pass="${VAULT_DB_PASSWORD}" \
  --set=vault_db="${VAULT_DB_NAME}" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'vault_user', :'vault_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'vault_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'vault_db', :'vault_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'vault_db') \gexec
EOSQL

echo "[INFO] OpenBao PostgreSQL objects ready."
