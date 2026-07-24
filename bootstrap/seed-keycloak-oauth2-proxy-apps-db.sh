#!/usr/bin/env bash
# Idempotent DB seed for oauth2-proxy-apps when Keycloak Admin API creds are unavailable.
# Prefer patch-keycloak-oauth2-proxy-apps.sh when admin login works.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { echo "[seed-oauth2-apps-db] $*"; }
die() { echo "[seed-oauth2-apps-db] ERROR $*" >&2; exit 1; }

[[ -f .env ]] || die "Missing .env"

env_val() {
  grep -E "^${1}=" .env | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//'
}

KC_REALM="$(env_val KC_REALM)"
OAUTH_APPS_DOMAIN="$(env_val OAUTH_APPS_DOMAIN)"
CLIENT_SECRET="$(env_val KC_CLIENT_SECRET_OAUTH2_PROXY_APPS)"
PG_USER="$(env_val POSTGRES_ADMIN_USER)"

[[ -n "${KC_REALM}" ]] || die "KC_REALM empty"
[[ -n "${OAUTH_APPS_DOMAIN}" ]] || die "OAUTH_APPS_DOMAIN empty"
[[ -n "${CLIENT_SECRET}" ]] || die "KC_CLIENT_SECRET_OAUTH2_PROXY_APPS empty"
[[ -n "${PG_USER}" ]] || die "POSTGRES_ADMIN_USER empty"

REDIRECT_URI="https://${OAUTH_APPS_DOMAIN}/oauth2/callback"
WEB_ORIGIN="https://${OAUTH_APPS_DOMAIN}"

EXISTS="$(docker compose exec -T postgres psql -U "${PG_USER}" -d keycloak -tAc \
  "SELECT 1 FROM client c JOIN realm r ON r.id=c.realm_id WHERE r.name='${KC_REALM}' AND c.client_id='oauth2-proxy-apps' LIMIT 1;" | tr -d '[:space:]')"

if [[ "${EXISTS}" = "1" ]]; then
  log "oauth2-proxy-apps already exists — updating secret and URIs"
  docker compose exec -T postgres psql -U "${PG_USER}" -d keycloak -v ON_ERROR_STOP=1 <<SQL
UPDATE client c SET secret='${CLIENT_SECRET}', enabled=true, standard_flow_enabled=true
FROM realm r WHERE r.id=c.realm_id AND r.name='${KC_REALM}' AND c.client_id='oauth2-proxy-apps';
DELETE FROM redirect_uris ru USING client c, realm r
WHERE ru.client_id=c.id AND c.realm_id=r.id AND r.name='${KC_REALM}' AND c.client_id='oauth2-proxy-apps';
INSERT INTO redirect_uris (client_id, value)
SELECT c.id, '${REDIRECT_URI}' FROM client c JOIN realm r ON r.id=c.realm_id
WHERE r.name='${KC_REALM}' AND c.client_id='oauth2-proxy-apps';
DELETE FROM web_origins wo USING client c, realm r
WHERE wo.client_id=c.id AND c.realm_id=r.id AND r.name='${KC_REALM}' AND c.client_id='oauth2-proxy-apps';
INSERT INTO web_origins (client_id, value)
SELECT c.id, '${WEB_ORIGIN}' FROM client c JOIN realm r ON r.id=c.realm_id
WHERE r.name='${KC_REALM}' AND c.client_id='oauth2-proxy-apps';
SQL
  log "Updated oauth2-proxy-apps"
  exit 0
fi

NEW_ID="$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]' || python -c 'import uuid; print(uuid.uuid4())' 2>/dev/null || openssl rand -hex 16 | sed 's/^\(........\)\(....\)\(....\)\(....\)\(............\)$/\1-\2-\3-\4-\5/')"
[[ -n "${NEW_ID}" ]] || die "Could not generate client UUID"
log "Creating oauth2-proxy-apps client (${NEW_ID})..."

docker compose exec -T postgres psql -U "${PG_USER}" -d keycloak -v ON_ERROR_STOP=1 <<SQL
INSERT INTO client (
  id, enabled, full_scope_allowed, client_id, not_before, public_client, secret,
  bearer_only, surrogate_auth_required, realm_id, protocol, node_rereg_timeout,
  frontchannel_logout, consent_required, name, service_accounts_enabled,
  standard_flow_enabled, implicit_flow_enabled, direct_access_grants_enabled,
  always_display_in_console, description
)
SELECT
  '${NEW_ID}', c.enabled, c.full_scope_allowed, 'oauth2-proxy-apps', c.not_before, false, '${CLIENT_SECRET}',
  c.bearer_only, c.surrogate_auth_required, c.realm_id, c.protocol, c.node_rereg_timeout,
  c.frontchannel_logout, c.consent_required, 'OAuth2 Proxy (app zones)', c.service_accounts_enabled,
  true, c.implicit_flow_enabled, false, c.always_display_in_console,
  'OIDC client for oauth2-proxy-apps — ForwardAuth on *.dev.apps and *.stg.apps hostnames'
FROM client c
JOIN realm r ON r.id = c.realm_id
WHERE r.name='${KC_REALM}' AND c.client_id='oauth2-proxy';

INSERT INTO redirect_uris (client_id, value)
SELECT c.id, '${REDIRECT_URI}' FROM client c JOIN realm r ON r.id=c.realm_id
WHERE r.name='${KC_REALM}' AND c.client_id='oauth2-proxy-apps';

INSERT INTO web_origins (client_id, value)
SELECT c.id, '${WEB_ORIGIN}' FROM client c JOIN realm r ON r.id=c.realm_id
WHERE r.name='${KC_REALM}' AND c.client_id='oauth2-proxy-apps';

INSERT INTO client_scope_client (client_id, scope_id, default_scope)
SELECT new_c.id, csc.scope_id, csc.default_scope
FROM client_scope_client csc
JOIN client src ON src.id = csc.client_id
JOIN realm r ON r.id = src.realm_id
JOIN client new_c ON new_c.realm_id = r.id AND new_c.client_id = 'oauth2-proxy-apps'
WHERE r.name='${KC_REALM}' AND src.client_id='oauth2-proxy'
ON CONFLICT DO NOTHING;
SQL

log "Created oauth2-proxy-apps — restart keycloak if OIDC discovery does not list the client immediately"
