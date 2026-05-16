#!/usr/bin/env bash
# =============================================================================
# bootstrap/checks/prereqs.sh
# =============================================================================
# Verifies host tools required before k3d / Kubernetes bootstrap.
# Keeps checks minimal; k3d-cluster.sh repeats k3d/helm/kubectl with stricter messages.
#
# Usage: ./bootstrap/checks/prereqs.sh
# =============================================================================
set -euo pipefail

log()  { echo "[prereqs] $*"; }
die()  { echo "[prereqs] ERROR $*" >&2; exit 1; }

log "Checking docker..."
command -v docker >/dev/null || die "docker not found."
docker info >/dev/null 2>&1 || die "docker daemon not reachable."

log "Checking docker compose..."
docker compose version >/dev/null 2>&1 || die "docker compose plugin not found."

if [[ -f .env ]]; then
  for var in SONARQUBE_DOMAIN SONARQUBE_EXTERNAL_URL SONAR_DB_NAME SONAR_DB_USER \
    SONAR_DB_PASSWORD SONAR_ADMIN_PASSWORD; do
    if ! grep -qE "^${var}=.+" .env 2>/dev/null; then
      die "Missing or empty ${var} in .env (required for SonarQube — see sample.env)"
    fi
  done
  log "SonarQube variables present in .env"
fi

if [[ "$(uname -s)" == "Linux" ]]; then
  map_count="$(sysctl -n vm.max_map_count 2>/dev/null || echo 0)"
  if [[ "${map_count}" -lt 262144 ]]; then
    die "vm.max_map_count=${map_count} — SonarQube requires >= 262144 (sysctl -w vm.max_map_count=262144)"
  fi
  log "vm.max_map_count OK (${map_count})"
fi

log "Checking k3d, helm, kubectl, jq..."
command -v k3d   >/dev/null || die "k3d not found."
command -v helm  >/dev/null || die "helm not found."
command -v kubectl >/dev/null || die "kubectl not found."
command -v jq    >/dev/null || die "jq not found."

log "All prerequisite checks passed."
