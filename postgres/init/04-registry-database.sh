#!/bin/bash
# Creates container registry metadata database and role on first cluster init only.
set -euo pipefail

: "${REGISTRY_DB_NAME:?REGISTRY_DB_NAME required}"
: "${REGISTRY_DB_USER:?REGISTRY_DB_USER required}"
: "${REGISTRY_DB_PASSWORD:?REGISTRY_DB_PASSWORD required}"
: "${POSTGRES_USER:?POSTGRES_USER required}"
: "${POSTGRES_DB:?POSTGRES_DB required}"

export PGPASSWORD="${POSTGRES_PASSWORD:-}"

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=registry_user="${REGISTRY_DB_USER}" \
  --set=registry_pass="${REGISTRY_DB_PASSWORD}" \
  --set=registry_db="${REGISTRY_DB_NAME}" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'registry_user', :'registry_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'registry_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'registry_db', :'registry_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'registry_db') \gexec
EOSQL
