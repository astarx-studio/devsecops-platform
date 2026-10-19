#!/usr/bin/env bash
# Point the live devops and master realms at the platform theme.
# Idempotent. Restarts Keycloak so it drops cached realm and client settings.
# The platform JAR must already be in the Keycloak image.
# Usage: ./bootstrap/patch-keycloak-theme.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { echo "[patch-keycloak-theme] $*"; }
die() { echo "[patch-keycloak-theme] ERROR $*" >&2; exit 1; }

[[ -f .env ]] || die "Missing .env"

env_val() {
  grep -E "^${1}=" .env | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//'
}

PG_USER="$(env_val POSTGRES_ADMIN_USER)"
[[ -n "${PG_USER}" ]] || die "POSTGRES_ADMIN_USER empty"

docker compose ps postgres 2>/dev/null | grep -q '(healthy)' \
  || die "postgres is not healthy — start the stack first"

psql_kc() {
  docker compose exec -T postgres psql -U "${PG_USER}" -d keycloak -v ON_ERROR_STOP=1 "$@"
}

log "Setting platform theme on devops and master"
psql_kc <<'SQL'
UPDATE realm
SET login_theme = 'platform',
    account_theme = 'platform',
    admin_theme = 'platform',
    email_theme = 'platform'
WHERE name IN ('devops', 'master');

UPDATE realm_attribute AS ra
SET value = 'YADA DSOaaS'
FROM realm AS r
WHERE ra.realm_id = r.id
  AND r.name = 'devops'
  AND ra.name IN ('displayName', 'displayNameHtml');

INSERT INTO realm_attribute (realm_id, name, value)
SELECT r.id, attr.name, 'YADA DSOaaS'
FROM realm AS r
CROSS JOIN (VALUES ('displayName'), ('displayNameHtml')) AS attr(name)
WHERE r.name = 'devops'
  AND NOT EXISTS (
    SELECT 1
    FROM realm_attribute AS ra
    WHERE ra.realm_id = r.id
      AND ra.name = attr.name
  );

UPDATE client_attributes AS ca
SET value = 'platform'
FROM client AS c
JOIN realm AS r ON r.id = c.realm_id
WHERE ca.client_id = c.id
  AND ca.name = 'login_theme'
  AND r.name IN ('devops', 'master')
  AND c.client_id IN ('account', 'account-console');

INSERT INTO client_attributes (client_id, name, value)
SELECT c.id, 'login_theme', 'platform'
FROM client AS c
JOIN realm AS r ON r.id = c.realm_id
WHERE r.name IN ('devops', 'master')
  AND c.client_id IN ('account', 'account-console')
  AND NOT EXISTS (
    SELECT 1
    FROM client_attributes AS ca
    WHERE ca.client_id = c.id
      AND ca.name = 'login_theme'
  );
SQL

log "Restarting keycloak so it reloads themes"
docker compose restart keycloak >/dev/null

log "Waiting for keycloak to become healthy"
ready=0
for _ in $(seq 1 40); do
  if docker inspect keycloak --format '{{.State.Health.Status}}' 2>/dev/null | grep -q '^healthy$'; then
    ready=1
    break
  fi
  sleep 3
done
[[ "${ready}" = "1" ]] || die "keycloak did not become healthy after restart"

KC_DOMAIN="$(env_val KEYCLOAK_DOMAIN)"
log "Platform theme is on. Welcome: https://${KC_DOMAIN}/  Sign-in: https://${KC_DOMAIN}/realms/devops/account/"
