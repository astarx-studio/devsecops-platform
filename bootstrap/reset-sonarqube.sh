#!/usr/bin/env bash
# =============================================================================
# bootstrap/reset-sonarqube.sh
# =============================================================================
# Destroys SonarQube application state (ES data + Postgres DB) and re-bootstrap.
# Does NOT touch Keycloak, GitLab, or other Postgres databases.
#
# Usage: ./bootstrap/reset-sonarqube.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { echo "[reset-sonarqube] $*"; }
die() { echo "[reset-sonarqube] ERROR $*" >&2; exit 1; }

SONAR_WAIT_SECS="${SONAR_WAIT_SECS:-900}"

[[ -f .env ]] || die "Missing .env — copy from sample.env"

if ! docker compose ps postgres 2>/dev/null | grep -q '(healthy)'; then
  log "Starting postgres..."
  docker compose up -d postgres
  deadline=$((SECONDS + 120))
  while ! docker compose ps postgres 2>/dev/null | grep -q '(healthy)'; do
    (( SECONDS >= deadline )) && die "postgres did not become healthy"
    sleep 2
  done
fi

log "Stopping SonarQube..."
docker compose stop sonarqube 2>/dev/null || true
docker rm -f sonarqube-init 2>/dev/null || true

log "Dropping Sonar PostgreSQL database..."
docker compose exec -T postgres sh -eu -c '
  : "${SONAR_DB_NAME:?SONAR_DB_NAME not set in postgres container}"
  psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 <<-EOSQL
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '"'"'"${SONAR_DB_NAME}"'"'"'
  AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "${SONAR_DB_NAME}";
EOSQL
'

log "Wiping Sonar volume data (data/, extensions/, logs/, bootstrap marker)..."
mkdir -p .vols/sonarqube/{data,extensions,logs,conf}
find .vols/sonarqube/data -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
find .vols/sonarqube/extensions -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
find .vols/sonarqube/logs -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
rm -f .vols/sonarqube/.sonar-bootstrap-done

if ! docker compose ps keycloak 2>/dev/null | grep -q '(healthy)'; then
  log "Starting keycloak (required for SAML config)..."
  docker compose up -d keycloak
  deadline=$((SECONDS + 300))
  while ! docker compose ps keycloak 2>/dev/null | grep -q '(healthy)'; do
    (( SECONDS >= deadline )) && die "keycloak did not become healthy"
    sleep 5
  done
fi

log "Recreating Sonar database role and empty database..."
docker compose run --rm --no-deps postgres-sonar-init

log "Patching Keycloak sonarqube SAML client (disable signing)..."
if [[ -x bootstrap/patch-keycloak-sonarqube-saml.sh ]]; then
  bash bootstrap/patch-keycloak-sonarqube-saml.sh --keycloak-only
fi

log "Regenerating sonar.properties from Keycloak IdP metadata..."
docker compose run --rm --no-deps sonarqube-config-init

log "Starting SonarQube (first boot may take several minutes)..."
docker compose up -d sonarqube

log "Waiting for SonarQube to become healthy (up to ${SONAR_WAIT_SECS}s)..."
deadline=$((SECONDS + SONAR_WAIT_SECS))
while true; do
  if docker compose ps sonarqube 2>/dev/null | grep -q '(healthy)'; then
    log "SonarQube is healthy."
    break
  fi
  (( SECONDS >= deadline )) && die "SonarQube did not become healthy — check: docker compose logs sonarqube"
  sleep 10
done

log "Running sonarqube-init (admin password + groups)..."
docker compose run --rm --no-deps sonarqube-init

log "Restarting SonarQube to load SAML settings..."
docker compose restart sonarqube

deadline=$((SECONDS + SONAR_WAIT_SECS))
while true; do
  if docker compose ps sonarqube 2>/dev/null | grep -q '(healthy)'; then
    break
  fi
  (( SECONDS >= deadline )) && die "SonarQube did not become healthy after restart"
  sleep 10
done

log "Verifying API login with SONAR_ADMIN_* from .env..."
if docker compose run --rm --no-deps --entrypoint sh sonarqube-init -c \
  'curl -sf -u "${SONAR_ADMIN_USER}:${SONAR_ADMIN_PASSWORD}" "${SONAR_INTERNAL_URL}/api/users/current" >/dev/null'; then
  log "SONAR_ADMIN_* credentials OK."
else
  die "SONAR_ADMIN_* login failed after bootstrap — check SONAR_ADMIN_PASSWORD in .env"
fi

if [[ -x scripts/verify-sonar-setup.sh ]]; then
  sh scripts/verify-sonar-setup.sh
fi

log "Done. Sign in at SONARQUBE_EXTERNAL_URL (SAML or local admin from .env)."
