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

# AI MR reviewer audit artifacts: user ai-review, bucket ai-review only, 90-day
# expiry. Skipped when the password is unset.
if [ -n "${AI_REVIEW_MINIO_PASSWORD:-}" ]; then
  log "Ensuring bucket 'ai-review' and user 'ai-review'..."
  mc mb --ignore-existing local/ai-review
  mc ilm rule add --expire-days "${AI_REVIEW_MINIO_EXPIRE_DAYS:-90}" local/ai-review >/dev/null 2>&1 || true
  cat > /tmp/ai-review-policy.json <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:ListBucket","s3:GetBucketLocation"],"Resource":["arn:aws:s3:::ai-review","arn:aws:s3:::ai-review/*"]}]}
JSON
  mc admin policy create local ai-review-rw /tmp/ai-review-policy.json >/dev/null 2>&1 || true
  mc admin user add local ai-review "${AI_REVIEW_MINIO_PASSWORD}" >/dev/null
  mc admin policy attach local ai-review-rw --user ai-review >/dev/null 2>&1 || true
fi

log "Users:"
mc admin user list local
log "Buckets:"
mc ls local
log "Done."
