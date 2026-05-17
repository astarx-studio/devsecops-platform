#!/bin/bash
# Creates GitLab Rails database and role on first PostgreSQL cluster init only.
# Extensions are installed by postgres-gitlab-init on every compose up.
set -euo pipefail

: "${GITLAB_DB_NAME:?GITLAB_DB_NAME required}"
: "${GITLAB_DB_USER:?GITLAB_DB_USER required}"
: "${GITLAB_DB_PASSWORD:?GITLAB_DB_PASSWORD required}"
: "${POSTGRES_USER:?POSTGRES_USER required}"
: "${POSTGRES_DB:?POSTGRES_DB required}"

export PGPASSWORD="${POSTGRES_PASSWORD:-}"

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=gitlab_user="${GITLAB_DB_USER}" \
  --set=gitlab_pass="${GITLAB_DB_PASSWORD}" \
  --set=gitlab_db="${GITLAB_DB_NAME}" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'gitlab_user', :'gitlab_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'gitlab_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'gitlab_db', :'gitlab_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'gitlab_db') \gexec
EOSQL
