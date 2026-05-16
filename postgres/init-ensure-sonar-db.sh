#!/bin/sh
# Idempotent SonarQube role + database on shared PostgreSQL (password-safe).
# Used by postgres-sonar-init and can be run manually against an existing cluster.
set -eu

PGHOST="${PGHOST:-postgres}"
: "${PGUSER:?PGUSER required}"
: "${PGPASSWORD:?PGPASSWORD required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${SONAR_DB_NAME:?SONAR_DB_NAME required}"
: "${SONAR_DB_USER:?SONAR_DB_USER required}"
: "${SONAR_DB_PASSWORD:?SONAR_DB_PASSWORD required}"

export PGPASSWORD="${PGPASSWORD}"

echo "[INFO] Waiting for PostgreSQL at ${PGHOST}..."
until pg_isready -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" >/dev/null 2>&1; do
  sleep 2
done

echo "[INFO] Ensuring Sonar role and database exist..."
psql -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 \
  --set=sonar_user="${SONAR_DB_USER}" \
  --set=sonar_pass="${SONAR_DB_PASSWORD}" \
  --set=sonar_db="${SONAR_DB_NAME}" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'sonar_user', :'sonar_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'sonar_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'sonar_db', :'sonar_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'sonar_db') \gexec
EOSQL

echo "[INFO] Sonar PostgreSQL objects ready."
