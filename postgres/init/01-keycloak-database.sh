#!/bin/bash
# Creates Keycloak database and role on first PostgreSQL cluster init only.
# Bootstrap superuser is POSTGRES_ADMIN_* (postgres DB); Keycloak uses KC_DB_* only.
set -euo pipefail

: "${KC_DB_NAME:?KC_DB_NAME required}"
: "${KC_DB_USER:?KC_DB_USER required}"
: "${KC_DB_PASSWORD:?KC_DB_PASSWORD required}"
: "${POSTGRES_USER:?POSTGRES_USER required}"
: "${POSTGRES_DB:?POSTGRES_DB required}"

export PGPASSWORD="${POSTGRES_PASSWORD:-}"

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=kc_user="${KC_DB_USER}" \
  --set=kc_pass="${KC_DB_PASSWORD}" \
  --set=kc_db="${KC_DB_NAME}" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'kc_user', :'kc_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'kc_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'kc_db', :'kc_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'kc_db') \gexec
EOSQL
