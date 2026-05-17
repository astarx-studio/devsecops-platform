#!/usr/bin/env bash
# =============================================================================
# Patch Keycloak sonarqube SAML client so SonarQube can accept responses.
# Disables client/request/assertion signing (aligned with sonar.auth.saml.signature.enabled=false).
#
# Usage: ./bootstrap/patch-keycloak-sonarqube-saml.sh
# Then:  docker compose run --rm --no-deps sonarqube-config-init && docker compose restart sonarqube
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { echo "[patch-keycloak-sonar] $*"; }
die() { echo "[patch-keycloak-sonar] ERROR $*" >&2; exit 1; }

[[ -f .env ]] || die "Missing .env"

env_val() {
  grep -E "^${1}=" .env | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//'
}

KC_REALM="$(env_val KC_REALM)"
KEYCLOAK_ADMIN="$(env_val KEYCLOAK_ADMIN)"
KEYCLOAK_ADMIN_PASSWORD="$(env_val KEYCLOAK_ADMIN_PASSWORD)"

[[ -n "${KC_REALM}" ]] || die "KC_REALM is empty in .env"
[[ -n "${KEYCLOAK_ADMIN}" ]] || die "KEYCLOAK_ADMIN is empty in .env"
[[ -n "${KEYCLOAK_ADMIN_PASSWORD}" ]] || die "KEYCLOAK_ADMIN_PASSWORD is empty in .env"

docker compose ps keycloak 2>/dev/null | grep -q '(healthy)' \
  || die "keycloak is not healthy — start the stack first"

log "Obtaining Keycloak admin token (realm master, credentials from container env)..."
TOKEN="$(
  MSYS_NO_PATHCONV=1 docker compose exec -T keycloak sh -eu -c '
    USER="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}"
    PASS="${KC_BOOTSTRAP_ADMIN_PASSWORD:-}"
    curl -sf -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
      -d "client_id=admin-cli" \
      -d "grant_type=password" \
      -d "username=${USER}" \
      -d "password=${PASS}" \
    | sed -n "s/.*\"access_token\":\"\\([^\"]*\\)\".*/\\1/p"
  ' 2>/dev/null | tr -d '\r'
)"

if [[ -z "${TOKEN}" ]]; then
  log "Retrying token request with .env KEYCLOAK_ADMIN (injected into container)..."
  TOKEN="$(
    MSYS_NO_PATHCONV=1 docker compose exec -T \
      -e "KC_PATCH_USER=${KEYCLOAK_ADMIN}" \
      -e "KC_PATCH_PASS=${KEYCLOAK_ADMIN_PASSWORD}" \
      keycloak sh -eu -c '
      curl -sf -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
        -d "client_id=admin-cli" \
        -d "grant_type=password" \
        -d "username=${KC_PATCH_USER}" \
        -d "password=${KC_PATCH_PASS}" \
      | sed -n "s/.*\"access_token\":\"\\([^\"]*\\)\".*/\\1/p"
    ' 2>/dev/null | tr -d '\r'
  )"
fi

[[ -n "${TOKEN}" ]] || die "Could not get admin token — log into Keycloak Admin UI and patch sonarqube client manually (see __DOCS__/02_admin/09_sonarqube_sso.md)"

log "Finding and patching sonarqube client in realm ${KC_REALM}..."
MSYS_NO_PATHCONV=1 docker compose exec -T \
  -e "KC_PATCH_TOKEN=${TOKEN}" \
  -e "KC_PATCH_REALM=${KC_REALM}" \
  keycloak sh -eu -c '
  set -eu
  CLIENT_JSON="$(curl -sf -H "Authorization: Bearer ${KC_PATCH_TOKEN}" \
    "http://localhost:8080/admin/realms/${KC_PATCH_REALM}/clients?clientId=sonarqube")"
  CLIENT_ID="$(printf "%s" "${CLIENT_JSON}" | sed -n "s/.*\"id\":\"\\([^\"]*\\)\".*/\\1/p" | head -1)"
  [ -n "${CLIENT_ID}" ] || { echo "sonarqube client not found" >&2; exit 1; }
  curl -sf -X PUT -H "Authorization: Bearer ${KC_PATCH_TOKEN}" -H "Content-Type: application/json" \
    "http://localhost:8080/admin/realms/${KC_PATCH_REALM}/clients/${CLIENT_ID}" \
    -d "{
      \"attributes\": {
        \"saml.assertion.signature\": \"false\",
        \"saml.server.signature\": \"false\",
        \"saml.client.signature\": \"false\",
        \"saml.encrypt\": \"false\",
        \"saml.force.post.binding\": \"true\",
        \"saml.authnstatement\": \"true\",
        \"saml_name_id_format\": \"username\"
      }
    }"
  echo "Patched client ${CLIENT_ID}"
'

if [[ "${1:-}" != "--keycloak-only" ]]; then
  log "Refreshing Sonar sonar.properties and restarting SonarQube..."
  docker compose run --rm --no-deps sonarqube-config-init
  docker compose restart sonarqube
  log "Done. Wait for sonarqube healthy, then retry Keycloak login."
else
  log "Done (Keycloak only). Run: docker compose run --rm --no-deps sonarqube-config-init && docker compose restart sonarqube"
fi
