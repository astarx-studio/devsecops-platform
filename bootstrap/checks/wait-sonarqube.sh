#!/usr/bin/env bash
# =============================================================================
# bootstrap/checks/wait-sonarqube.sh
# =============================================================================
# Waits for SonarQube init chain after `docker compose up -d`:
#   postgres-sonar-init → sonarqube-config-init → sonarqube (healthy) → sonarqube-init (exit 0)
#
# Usage: ./bootstrap/checks/wait-sonarqube.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

log()  { echo "[wait-sonarqube] $*"; }
die()  { echo "[wait-sonarqube] ERROR $*" >&2; exit 1; }

SONAR_WAIT_SECS="${SONAR_WAIT_SECS:-900}"

if [[ ! -f .env ]]; then
  die "Missing .env — copy sample.env and set SONARQUBE_* / SONAR_DB_* / SONAR_ADMIN_PASSWORD"
fi

# Ensure one-shot inits and sonarqube are triggered (idempotent).
log "Ensuring Sonar init services and sonarqube are up..."
docker compose up -d postgres keycloak sonarqube 2>/dev/null \
  || docker compose up -d sonarqube

log "Waiting for sonarqube container (up to ${SONAR_WAIT_SECS}s)..."
deadline=$((SECONDS + SONAR_WAIT_SECS))
while true; do
  if docker compose ps sonarqube 2>/dev/null | grep -q '(healthy)'; then
    log "sonarqube is healthy."
    break
  fi
  if (( SECONDS >= deadline )); then
    die "sonarqube did not become healthy in time. Check: docker compose logs sonarqube"
  fi
  sleep 10
done

if docker compose ps -a 2>/dev/null | grep -E 'sonarqube-init.*Exited \(0\)' >/dev/null; then
  log "sonarqube-init already completed successfully."
else
  log "Running sonarqube-init..."
  docker compose run --rm sonarqube-init || die "sonarqube-init failed"
fi

if [[ -x scripts/verify-sonar-setup.sh ]]; then
  log "Running scripts/verify-sonar-setup.sh..."
  sh scripts/verify-sonar-setup.sh
else
  log "scripts/verify-sonar-setup.sh not found — skipping verify"
fi

log "SonarQube bootstrap checks passed."
