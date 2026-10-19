#!/usr/bin/env bash
# Idempotent DB seed for the n8n Keycloak client when the Admin API login fails.
# Prefer bootstrap/patch-keycloak-n8n.sh when admin login works.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { echo "[seed-keycloak-n8n] $*"; }
die() { echo "[seed-keycloak-n8n] ERROR $*" >&2; exit 1; }

[[ -f .env ]] || die "Missing .env"

env_val() {
  grep -E "^${1}=" .env | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//'
}

KC_REALM="$(env_val KC_REALM)"
N8N_DOMAIN="$(env_val N8N_DOMAIN)"
CLIENT_SECRET="$(env_val KC_CLIENT_SECRET_N8N)"
PG_USER="$(env_val POSTGRES_ADMIN_USER)"

[[ -n "${KC_REALM}" ]] || die "KC_REALM empty"
[[ -n "${N8N_DOMAIN}" ]] || die "N8N_DOMAIN empty"
[[ -n "${CLIENT_SECRET}" ]] || die "KC_CLIENT_SECRET_N8N empty"
[[ -n "${PG_USER}" ]] || die "POSTGRES_ADMIN_USER empty"
[[ "${CLIENT_SECRET}" =~ ^[A-Za-z0-9_-]+$ ]] || die "KC_CLIENT_SECRET_N8N has characters this seed will not interpolate"

REDIRECT_URI="https://${N8N_DOMAIN}/auth/oidc/callback"
WEB_ORIGIN="https://${N8N_DOMAIN}"

psql_kc() {
  docker compose exec -T postgres psql -U "${PG_USER}" -d keycloak -v ON_ERROR_STOP=1 "$@"
}

EXISTS="$(psql_kc -tAc \
  "SELECT 1 FROM client c JOIN realm r ON r.id=c.realm_id WHERE r.name='${KC_REALM}' AND c.client_id='n8n' LIMIT 1;" | tr -d '[:space:]')"

if [[ "${EXISTS}" = "1" ]]; then
  log "n8n client already exists — updating secret, flags, and URIs"
  psql_kc <<SQL
UPDATE client c
SET secret='${CLIENT_SECRET}',
    enabled=true,
    public_client=false,
    standard_flow_enabled=true,
    direct_access_grants_enabled=false,
    service_accounts_enabled=false
FROM realm r
WHERE r.id=c.realm_id AND r.name='${KC_REALM}' AND c.client_id='n8n';
DELETE FROM redirect_uris ru USING client c, realm r
WHERE ru.client_id=c.id AND c.realm_id=r.id AND r.name='${KC_REALM}' AND c.client_id='n8n';
INSERT INTO redirect_uris (client_id, value)
SELECT c.id, '${REDIRECT_URI}' FROM client c JOIN realm r ON r.id=c.realm_id
WHERE r.name='${KC_REALM}' AND c.client_id='n8n';
DELETE FROM web_origins wo USING client c, realm r
WHERE wo.client_id=c.id AND c.realm_id=r.id AND r.name='${KC_REALM}' AND c.client_id='n8n';
INSERT INTO web_origins (client_id, value)
SELECT c.id, '${WEB_ORIGIN}' FROM client c JOIN realm r ON r.id=c.realm_id
WHERE r.name='${KC_REALM}' AND c.client_id='n8n';
SQL
else
  NEW_ID="$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]' || python -c 'import uuid; print(uuid.uuid4())')"
  [[ -n "${NEW_ID}" ]] || die "Could not generate client UUID"
  log "Creating n8n client"
  psql_kc <<SQL
INSERT INTO client (
  id, enabled, full_scope_allowed, client_id, not_before, public_client, secret,
  bearer_only, surrogate_auth_required, realm_id, protocol, node_rereg_timeout,
  frontchannel_logout, consent_required, name, service_accounts_enabled,
  standard_flow_enabled, implicit_flow_enabled, direct_access_grants_enabled,
  always_display_in_console, description
)
SELECT
  '${NEW_ID}', c.enabled, c.full_scope_allowed, 'n8n', c.not_before, false, '${CLIENT_SECRET}',
  c.bearer_only, c.surrogate_auth_required, c.realm_id, c.protocol, c.node_rereg_timeout,
  c.frontchannel_logout, c.consent_required, 'n8n', false,
  true, false, false, c.always_display_in_console,
  'OIDC client for the devtools n8n editor'
FROM client c
JOIN realm r ON r.id = c.realm_id
WHERE r.name='${KC_REALM}' AND c.client_id='oauth2-proxy';

INSERT INTO redirect_uris (client_id, value)
SELECT c.id, '${REDIRECT_URI}' FROM client c JOIN realm r ON r.id=c.realm_id
WHERE r.name='${KC_REALM}' AND c.client_id='n8n';

INSERT INTO web_origins (client_id, value)
SELECT c.id, '${WEB_ORIGIN}' FROM client c JOIN realm r ON r.id=c.realm_id
WHERE r.name='${KC_REALM}' AND c.client_id='n8n';
SQL
fi

psql_kc <<SQL
INSERT INTO client_scope_client (client_id, scope_id, default_scope)
SELECT c.id, cs.id, true
FROM client c
JOIN realm r ON r.id = c.realm_id
JOIN client_scope cs ON cs.realm_id = r.id
WHERE r.name='${KC_REALM}'
  AND c.client_id='n8n'
  AND cs.name IN ('openid', 'profile', 'email', 'roles', 'groups')
ON CONFLICT DO NOTHING;
SQL

log "n8n client stored. Restart keycloak so it reloads clients from the database."
