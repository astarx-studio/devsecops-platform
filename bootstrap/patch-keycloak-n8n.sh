#!/usr/bin/env bash
# Create or update Keycloak client n8n in the live devops realm.
# Usage: ./bootstrap/patch-keycloak-n8n.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { echo "[patch-keycloak-n8n] $*"; }
die() { echo "[patch-keycloak-n8n] ERROR $*" >&2; exit 1; }

[[ -f .env ]] || die "Missing .env"

env_val() {
  grep -E "^${1}=" .env | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//'
}

KC_REALM="$(env_val KC_REALM)"
N8N_DOMAIN="$(env_val N8N_DOMAIN)"
CLIENT_SECRET="$(env_val KC_CLIENT_SECRET_N8N)"
KEYCLOAK_ADMIN="$(env_val KEYCLOAK_ADMIN)"
KEYCLOAK_ADMIN_PASSWORD="$(env_val KEYCLOAK_ADMIN_PASSWORD)"

[[ -n "${KC_REALM}" ]] || die "KC_REALM is empty in .env"
[[ -n "${N8N_DOMAIN}" ]] || die "N8N_DOMAIN is empty in .env"
[[ -n "${CLIENT_SECRET}" ]] || die "KC_CLIENT_SECRET_N8N is empty in .env"

docker compose ps keycloak 2>/dev/null | grep -q '(healthy)' \
  || die "keycloak is not healthy — start the stack first"

BOOT_USER="$(docker compose exec -T keycloak printenv KC_BOOTSTRAP_ADMIN_USERNAME 2>/dev/null | tr -d '\r' || true)"
BOOT_PASS="$(docker compose exec -T keycloak printenv KC_BOOTSTRAP_ADMIN_PASSWORD 2>/dev/null | tr -d '\r' || true)"
KC_ADMIN_USER="${BOOT_USER:-${KEYCLOAK_ADMIN}}"
KC_ADMIN_PASS="${BOOT_PASS:-${KEYCLOAK_ADMIN_PASSWORD}}"
[[ -n "${KC_ADMIN_USER}" && -n "${KC_ADMIN_PASS}" ]] || die "Keycloak admin credentials unavailable"

KC_URL="http://keycloak:8080"
REDIRECT_URI="https://${N8N_DOMAIN}/auth/oidc/callback"
WEB_ORIGIN="https://${N8N_DOMAIN}"
NETWORK="$(docker inspect keycloak --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' | head -1)"
[[ -n "${NETWORK}" ]] || die "Could not resolve Docker network for keycloak"

log "Obtaining Keycloak admin token..."
TOKEN="$(
  MSYS_NO_PATHCONV=1 docker run --rm --network "${NETWORK}" \
    curlimages/curl:8.5.0 -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
    -d "client_id=admin-cli" \
    -d "grant_type=password" \
    -d "username=${KC_ADMIN_USER}" \
    -d "password=${KC_ADMIN_PASS}" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p' | tr -d '\r'
)" || TOKEN=""

[[ -n "${TOKEN}" ]] || {
  log "Admin API unavailable — falling back to DB seed (bootstrap/seed-keycloak-n8n-db.sh)"
  bash "${SCRIPT_DIR}/seed-keycloak-n8n-db.sh"
  exit 0
}

log "Ensuring n8n client in realm ${KC_REALM}..."
MSYS_NO_PATHCONV=1 docker run --rm --network "${NETWORK}" \
  -e "KC_PATCH_TOKEN=${TOKEN}" \
  -e "KC_PATCH_REALM=${KC_REALM}" \
  -e "KC_PATCH_SECRET=${CLIENT_SECRET}" \
  -e "KC_PATCH_REDIRECT=${REDIRECT_URI}" \
  -e "KC_PATCH_ORIGIN=${WEB_ORIGIN}" \
  curlimages/curl:8.5.0 sh -eu -c '
    KC_URL="http://keycloak:8080"
    AUTH="Authorization: Bearer ${KC_PATCH_TOKEN}"
    BASE="${KC_URL}/admin/realms/${KC_PATCH_REALM}"
    CLIENT_JSON="$(curl -sf -H "${AUTH}" "${BASE}/clients?clientId=n8n")"
    CLIENT_UUID="$(printf "%s" "${CLIENT_JSON}" | sed -n "s/.*\"id\":\"\\([^\"]*\\)\".*/\\1/p" | head -1)"

    PAYLOAD="{
      \"clientId\": \"n8n\",
      \"name\": \"n8n\",
      \"description\": \"OIDC client for the devtools n8n editor\",
      \"enabled\": true,
      \"publicClient\": false,
      \"standardFlowEnabled\": true,
      \"directAccessGrantsEnabled\": false,
      \"serviceAccountsEnabled\": false,
      \"protocol\": \"openid-connect\",
      \"redirectUris\": [\"${KC_PATCH_REDIRECT}\"],
      \"webOrigins\": [\"${KC_PATCH_ORIGIN}\"]
    }"

    if [ -z "${CLIENT_UUID}" ]; then
      HTTP="$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "${AUTH}" -H "Content-Type: application/json" \
        "${BASE}/clients" -d "${PAYLOAD}")"
      [ "${HTTP}" = "201" ] || { echo "create client failed HTTP ${HTTP}" >&2; exit 1; }
      CLIENT_JSON="$(curl -sf -H "${AUTH}" "${BASE}/clients?clientId=n8n")"
      CLIENT_UUID="$(printf "%s" "${CLIENT_JSON}" | sed -n "s/.*\"id\":\"\\([^\"]*\\)\".*/\\1/p" | head -1)"
      echo "Created client ${CLIENT_UUID}"
    else
      curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
        "${BASE}/clients/${CLIENT_UUID}" -d "${PAYLOAD}"
      echo "Updated client ${CLIENT_UUID}"
    fi

    curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
      "${BASE}/clients/${CLIENT_UUID}/client-secret" \
      -d "{\"type\":\"secret\",\"value\":\"${KC_PATCH_SECRET}\"}" >/dev/null

    SCOPES="$(curl -sf -H "${AUTH}" "${BASE}/client-scopes")"
    for SCOPE in openid profile email roles groups; do
      SCOPE_ID="$(printf "%s" "${SCOPES}" | tr "}" "\n" | grep "\"name\":\"${SCOPE}\"" | sed -n "s/.*\"id\":\"\\([^\"]*\\)\".*/\\1/p" | head -1)"
      [ -n "${SCOPE_ID}" ] || continue
      curl -sf -o /dev/null -X PUT -H "${AUTH}" \
        "${BASE}/clients/${CLIENT_UUID}/default-client-scopes/${SCOPE_ID}" || true
    done
    echo "Secret and default scopes applied"
  '

log "Done."
