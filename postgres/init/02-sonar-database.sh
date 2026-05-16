#!/bin/bash
# Creates SonarQube database and role on first PostgreSQL cluster init only.
# Existing volumes: postgres-sonar-init uses postgres/init-ensure-sonar-db.sh.
set -euo pipefail

: "${SONAR_DB_NAME:?SONAR_DB_NAME required}"
: "${SONAR_DB_USER:?SONAR_DB_USER required}"
: "${SONAR_DB_PASSWORD:?SONAR_DB_PASSWORD required}"
: "${POSTGRES_USER:?POSTGRES_USER required}"
: "${POSTGRES_DB:?POSTGRES_DB required}"

export PGPASSWORD="${POSTGRES_PASSWORD:-}"

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=sonar_user="${SONAR_DB_USER}" \
  --set=sonar_pass="${SONAR_DB_PASSWORD}" \
  --set=sonar_db="${SONAR_DB_NAME}" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'sonar_user', :'sonar_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'sonar_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'sonar_db', :'sonar_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'sonar_db') \gexec
EOSQL
