#!/bin/sh
# Sample postgres-init script for the shared devtools Postgres.
#
# Copy to a project-specific name (e.g. 00-init-myapp-envs.sh) and customize.
# Project-specific scripts under this directory are gitignored so the DSOaaS
# stack stays generic — see .gitignore and __DOCS__/99_maintainers/02_services.md.
#
# Runs once on first container start (empty data dir) via the official postgres
# image's docker-entrypoint-initdb.d mechanism.
set -eu

# Example: one logical database per shared environment.
for ENV_DB in app_dev app_stg; do
  echo "devtools-postgres: creating database ${ENV_DB} (if missing)..."
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname postgres <<-SQL
    SELECT 'CREATE DATABASE ${ENV_DB}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${ENV_DB}')\gexec
SQL

  echo "devtools-postgres: applying bootstrap extensions to ${ENV_DB}..."
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${ENV_DB}" <<-SQL
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
done

echo "devtools-postgres: sample env DB init complete."
