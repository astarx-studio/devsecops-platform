#!/usr/bin/env bash
# =============================================================================
# bootstrap/minio-bootstrap.sh
# =============================================================================
# Idempotent MinIO bootstrap for the DSOaaS platform.
#
# Creates the four GitLab object-store buckets and a dedicated service-account
# key (MINIO_ACCESS_KEY / MINIO_SECRET_KEY) inside MinIO.  Intended for use
# after a fresh `docker compose up` or to re-apply the config without restarting
# containers.
#
# The `minio-init` one-shot container that runs as part of `docker compose up`
# does the same work automatically.  Run this script manually only when:
#   - The minio-init container exited before MinIO was healthy.
#   - You rotated MINIO_ACCESS_KEY / MINIO_SECRET_KEY and need to re-apply.
#   - You added a new bucket and want to create it without a full restart.
#
# Prerequisites:
#   - MinIO container running (docker compose up -d minio)
#   - .env loaded (MINIO_ROOT_USER, MINIO_ROOT_PASSWORD, MINIO_ACCESS_KEY,
#                  MINIO_SECRET_KEY, DOCKER_NETWORK)
#
# Usage:
#   source .env && ./bootstrap/minio-bootstrap.sh
#
# Environment variables:
#   MINIO_ROOT_USER      MinIO root username (default: minio-admin)
#   MINIO_ROOT_PASSWORD  MinIO root password
#   MINIO_ACCESS_KEY     GitLab service-account access key (default: gitlab-objstore)
#   MINIO_SECRET_KEY     GitLab service-account secret key
#   DOCKER_NETWORK       Docker bridge network (default: devops-network)
#   MINIO_ENDPOINT       Internal MinIO endpoint (default: http://minio:9000)
# =============================================================================
set -euo pipefail

MINIO_ROOT_USER="${MINIO_ROOT_USER:-minio-admin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-gitlab-objstore}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:?MINIO_SECRET_KEY is required}"
DOCKER_NETWORK="${DOCKER_NETWORK:-devops-network}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"

BUCKETS=(gitlab-artifacts gitlab-lfs gitlab-uploads gitlab-packages gitlab-dependency-proxy gitlab-terraform-state gitlab-pages gitlab-ci-secure-files)

log()  { echo "[minio-bootstrap] $*"; }
info() { echo "[minio-bootstrap] INFO  $*"; }
warn() { echo "[minio-bootstrap] WARN  $*" >&2; }
die()  { echo "[minio-bootstrap] ERROR $*" >&2; exit 1; }

# Run mc inside a disposable container on devops-network so it can reach minio
# by its container hostname.
mc() {
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
    docker run --rm \
      --network "${DOCKER_NETWORK}" \
      quay.io/minio/mc:latest \
      "$@"
}

# ---------------------------------------------------------------------------
# 1. Wait for MinIO
# ---------------------------------------------------------------------------
log "Waiting for MinIO at ${MINIO_ENDPOINT}..."
for i in $(seq 1 30); do
  if mc alias set local "${MINIO_ENDPOINT}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null 2>&1; then
    info "MinIO is reachable."
    break
  fi
  [ "${i}" -eq 30 ] && die "MinIO not reachable after 60s. Is the minio container running?"
  sleep 2
done

# ---------------------------------------------------------------------------
# 2. Create buckets (idempotent)
# ---------------------------------------------------------------------------
for bucket in "${BUCKETS[@]}"; do
  mc mb --ignore-existing "local/${bucket}" >/dev/null \
    && info "Bucket '${bucket}': present." \
    || warn "Could not create bucket '${bucket}' — manual intervention may be needed."
done

# ---------------------------------------------------------------------------
# 3. Create / update dedicated GitLab service account
# ---------------------------------------------------------------------------
if mc admin user info local "${MINIO_ACCESS_KEY}" >/dev/null 2>&1; then
  info "Service account '${MINIO_ACCESS_KEY}' already exists — updating password."
  mc admin user update local "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" >/dev/null
else
  info "Creating service account '${MINIO_ACCESS_KEY}'."
  mc admin user add local "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" >/dev/null
fi

mc admin policy attach local readwrite --user "${MINIO_ACCESS_KEY}" >/dev/null 2>&1 || true
info "Policy 'readwrite' attached to '${MINIO_ACCESS_KEY}'."

# ---------------------------------------------------------------------------
# 4. Verify
# ---------------------------------------------------------------------------
log "Verifying buckets..."
for bucket in "${BUCKETS[@]}"; do
  if mc ls "local/${bucket}" >/dev/null 2>&1; then
    info "  ✓ local/${bucket}"
  else
    warn "  ✗ local/${bucket} — bucket inaccessible"
  fi
done

log "MinIO bootstrap complete."
log "Buckets: ${BUCKETS[*]}"
log "Service account: ${MINIO_ACCESS_KEY}"
log ""
log "Next step: restart GitLab to pick up the object_store config:"
log "  docker compose up -d --force-recreate gitlab"
