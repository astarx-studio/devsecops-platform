#!/bin/sh
# Idempotent Keycloak role + database on shared PostgreSQL (password-safe).
# Used by postgres-keycloak-init; mirrors init/01-keycloak-database.sh on first boot.
set -eu

PGHOST="${PGHOST:-postgres}"
: "${PGUSER:?PGUSER required}"
: "${PGPASSWORD:?PGPASSWORD required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${KC_DB_NAME:?KC_DB_NAME required}"
: "${KC_DB_USER:?KC_DB_USER required}"
: "${KC_DB_PASSWORD:?KC_DB_PASSWORD required}"

export PGPASSWORD="${PGPASSWORD}"

echo "[INFO] Waiting for PostgreSQL at ${PGHOST}..."
until pg_isready -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" >/dev/null 2>&1; do
  sleep 2
done

echo "[INFO] Ensuring Keycloak role and database exist..."
psql -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 \
  --set=kc_user="${KC_DB_USER}" \
  --set=kc_pass="${KC_DB_PASSWORD}" \
  --set=kc_db="${KC_DB_NAME}" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'kc_user', :'kc_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'kc_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'kc_db', :'kc_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'kc_db') \gexec
EOSQL

echo "[INFO] Keycloak PostgreSQL objects ready."
