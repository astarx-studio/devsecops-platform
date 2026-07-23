#!/bin/sh
# Runs once, on first container start (empty data dir), via the official
# postgres image's docker-entrypoint-initdb.d mechanism.
#
# Creates one logical database per CFA deployment environment sharing this
# single devtools Postgres instance, each with the same schema/table layout
# CFA's own per-namespace `infra-postgres` uses (see CFA infra repo's
# helm/infra/templates/postgres-hasura.yaml init ConfigMap), so app code
# behaves identically whether pointed at infra-postgres (local/standalone)
# or devtools-postgres (shared dev/stg).
#
# CFA schemas (rf_stub, payable_service, ...) are NOT created here — as of
# 2026-07-23 they're owned by the CFA infra repo's db-core project
# (migrations/cfa/, applied via its migrate:dev/migrate:stg CI jobs on push
# — see db-core/README.md and db-core/hasura/WORKFLOW.md). Only
# CREATE DATABASE + pgcrypto happen here for cfa_dev/cfa_stg; db-core's CI
# creates the schemas/tables on top. This script previously hardcoded a
# narrower/stale rf_stub.users/employee shape (missing columns db-core's
# migration has, e.g. display_name/tenant_id/active/nip/unit_code) — removed
# to avoid two divergent sources of truth for the same schema.
#
# Add non-CFA sample-app schemas/tables here as new apps are onboarded to
# devtools (backend_sample1/backend_sample2 below are examples, unrelated to
# CFA/db-core).
set -eu

for CFA_ENV_DB in cfa_dev cfa_stg; do
  echo "devtools-postgres: creating database ${CFA_ENV_DB} (if missing)..."
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname postgres <<-SQL
    SELECT 'CREATE DATABASE ${CFA_ENV_DB}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${CFA_ENV_DB}')\gexec
SQL

  echo "devtools-postgres: applying schema to ${CFA_ENV_DB}..."
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${CFA_ENV_DB}" <<-SQL
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE SCHEMA IF NOT EXISTS backend_sample1;
    CREATE SCHEMA IF NOT EXISTS backend_sample2;

    CREATE TABLE IF NOT EXISTS backend_sample1.items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      owner_user_id UUID NOT NULL,
      tenant_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS backend_sample2.items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      owner_user_id UUID NOT NULL,
      tenant_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
SQL
done

echo "devtools-postgres: cfa_dev/cfa_stg init complete."
