#!/usr/bin/env bash
# =============================================================================
# bootstrap/checks/wait-gitlab.sh
# =============================================================================
# Polls GitLab Omnibus health from inside the gitlab container until ready or timeout.
# Intended to run on the Docker host after `docker compose up`; uses `docker exec`
# because GitLab HTTP is not published on a host port by default.
#
# Environment:
#   GITLAB_CONTAINER  Default: gitlab
#   GITLAB_HEALTH_URL Default: http://localhost/-/health (inside container)
#   GITLAB_WAIT_SECS  Default: 900 (15 minutes)
#
# Usage: ./bootstrap/checks/wait-gitlab.sh
# =============================================================================
set -euo pipefail

GITLAB_CONTAINER="${GITLAB_CONTAINER:-gitlab}"
GITLAB_HEALTH_URL="${GITLAB_HEALTH_URL:-http://localhost/-/health}"
GITLAB_WAIT_SECS="${GITLAB_WAIT_SECS:-900}"

log()  { echo "[wait-gitlab] $*"; }
die()  { echo "[wait-gitlab] ERROR $*" >&2; exit 1; }

docker inspect "${GITLAB_CONTAINER}" >/dev/null 2>&1 \
  || die "Container '${GITLAB_CONTAINER}' not found. Start the stack with docker compose up -d first."

log "Waiting for GitLab health at ${GITLAB_HEALTH_URL} (timeout ${GITLAB_WAIT_SECS}s)..."
start_ts=$(date +%s)
while true; do
  now_ts=$(date +%s)
  elapsed=$((now_ts - start_ts))
  if (( elapsed >= GITLAB_WAIT_SECS )); then
    die "GitLab did not become healthy within ${GITLAB_WAIT_SECS}s. Check: docker compose logs -f gitlab"
  fi
  if docker exec "${GITLAB_CONTAINER}" curl -sf "${GITLAB_HEALTH_URL}" >/dev/null 2>&1; then
    log "GitLab is healthy."
    exit 0
  fi
  sleep 10
  log "Still waiting... ($((GITLAB_WAIT_SECS - elapsed))s left)"
done
