#!/bin/bash
# Creates OpenBao database and role on first PostgreSQL cluster init only.
# Existing volumes: postgres-vault-init uses postgres/init-ensure-vault-db.sh.
set -euo pipefail

: "${VAULT_DB_NAME:?VAULT_DB_NAME required}"
: "${VAULT_DB_USER:?VAULT_DB_USER required}"
: "${VAULT_DB_PASSWORD:?VAULT_DB_PASSWORD required}"
: "${POSTGRES_USER:?POSTGRES_USER required}"
: "${POSTGRES_DB:?POSTGRES_DB required}"

export PGPASSWORD="${POSTGRES_PASSWORD:-}"

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=vault_user="${VAULT_DB_USER}" \
  --set=vault_pass="${VAULT_DB_PASSWORD}" \
  --set=vault_db="${VAULT_DB_NAME}" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'vault_user', :'vault_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'vault_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'vault_db', :'vault_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'vault_db') \gexec
EOSQL
