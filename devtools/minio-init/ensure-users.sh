#!/bin/sh
# Idempotent MinIO bootstrap for shared DevTools:
# - wait for API
# - ensure service user `cfa` (root user is `admin` from compose)
# - create default CFA buckets
set -eu

log() { echo "[devtools-minio-init] $*"; }
die() { echo "[devtools-minio-init] ERROR $*" >&2; exit 1; }

: "${MINIO_ROOT_USER:?}"
: "${MINIO_ROOT_PASSWORD:?}"
: "${DEVTOOLS_MINIO_CFA_USER:?}"
: "${DEVTOOLS_MINIO_CFA_PASSWORD:?}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://devtools-minio:9000}"

log "Waiting for MinIO at ${MINIO_ENDPOINT}..."
i=0
until mc alias set local "${MINIO_ENDPOINT}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    die "MinIO not ready after ${i} attempts"
  fi
  sleep 2
done
log "MinIO ready (alias=local)."

log "Ensuring user '${DEVTOOLS_MINIO_CFA_USER}'..."
if mc admin user info local "${DEVTOOLS_MINIO_CFA_USER}" >/dev/null 2>&1; then
  log "User exists — updating secret key."
  mc admin user add local "${DEVTOOLS_MINIO_CFA_USER}" "${DEVTOOLS_MINIO_CFA_PASSWORD}" >/dev/null
else
  mc admin user add local "${DEVTOOLS_MINIO_CFA_USER}" "${DEVTOOLS_MINIO_CFA_PASSWORD}"
fi
mc admin policy attach local readwrite --user "${DEVTOOLS_MINIO_CFA_USER}" >/dev/null 2>&1 || true

for b in cfa-dev cfa-stg; do
  log "Ensuring bucket '${b}'..."
  mc mb --ignore-existing "local/${b}"
done

log "Users:"
mc admin user list local
log "Buckets:"
mc ls local
log "Done."
