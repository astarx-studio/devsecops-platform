#!/bin/sh
# Idempotent pgvector bootstrap: enable the vector extension on the app
# database and on template1 so later CREATE DATABASE inherits it.
set -eu

log() { echo "[devtools-pgvector-init] $*"; }
die() { echo "[devtools-pgvector-init] ERROR $*" >&2; exit 1; }

: "${PGUSER:?}"
: "${PGPASSWORD:?}"
: "${PGDATABASE:?}"
PGHOST="${PGHOST:-devtools-pgvector}"
export PGHOST PGUSER PGPASSWORD

log "Waiting for Postgres at ${PGHOST}..."
i=0
until pg_isready -h "${PGHOST}" -U "${PGUSER}" -d postgres >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    die "Postgres not ready after ${i} attempts"
  fi
  sleep 2
done
log "Postgres ready."

enable_vector() {
  db="$1"
  log "CREATE EXTENSION vector on ${db}"
  psql -h "${PGHOST}" -U "${PGUSER}" -d "${db}" -v ON_ERROR_STOP=1 \
    -c "CREATE EXTENSION IF NOT EXISTS vector;"
}

enable_vector "${PGDATABASE}"
enable_vector template1

psql -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 \
  -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"

log "Ensuring estimator memory tables on ${PGDATABASE}"
psql -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS estimation_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  item_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('webhook', 'manual_qt', 'workflow_qt', 'seen')),
  qt integer,
  title text,
  description text,
  type_name text,
  embedded_text text,
  content_hash text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE estimation_event ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE estimation_event DROP CONSTRAINT IF EXISTS estimation_event_kind_check;
ALTER TABLE estimation_event ADD CONSTRAINT estimation_event_kind_check
  CHECK (kind IN ('webhook', 'manual_qt', 'workflow_qt', 'seen'));
CREATE UNIQUE INDEX IF NOT EXISTS estimation_event_event_id_uidx
  ON estimation_event (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimation_event_item_kind_idx
  ON estimation_event (item_id, kind, occurred_at DESC);

CREATE TABLE IF NOT EXISTS estimation_example (
  item_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('manual', 'workflow')),
  title text NOT NULL,
  description text NOT NULL,
  type_name text,
  qt integer NOT NULL,
  embedded_text text NOT NULL,
  embedding vector(768),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estimation_example_project_idx
  ON estimation_example (project_id);
CREATE INDEX IF NOT EXISTS estimation_example_workspace_idx
  ON estimation_example (workspace_id);
CREATE INDEX IF NOT EXISTS estimation_example_embedding_hnsw
  ON estimation_example USING hnsw (embedding vector_cosine_ops);
SQL

log "vector extension ready on ${PGDATABASE} and template1."
