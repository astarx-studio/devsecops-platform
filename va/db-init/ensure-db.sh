#!/bin/sh
# One-shot: create the launcher's role and database on va-postgres.
# Safe to re-run; the password is re-applied each time so va/.env stays the source of truth.
set -eu

: "${VA_LAUNCHER_DB_PASSWORD:?VA_LAUNCHER_DB_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 -v pw="$VA_LAUNCHER_DB_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE va_launcher LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'va_launcher') \gexec
ALTER ROLE va_launcher WITH LOGIN PASSWORD :'pw';
SELECT 'CREATE DATABASE va_launcher OWNER va_launcher' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'va_launcher') \gexec
SQL

echo "va_launcher database ready"
