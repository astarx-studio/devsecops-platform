#!/usr/bin/env bash
# Allow the account console to store a profile photo on the live realms.
# Idempotent. Restarts Keycloak so it drops the cached user profile.
# Usage: ./bootstrap/patch-keycloak-profile-picture.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { echo "[patch-keycloak-profile-picture] $*"; }
die() { echo "[patch-keycloak-profile-picture] ERROR $*" >&2; exit 1; }

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

log "Adding the picture attribute to devops and master user profiles"
psql_kc <<'SQL'
UPDATE component_config AS cc
SET value = (
  jsonb_set(
    cc.value::jsonb,
    '{attributes}',
    (cc.value::jsonb -> 'attributes') || jsonb_build_array(
      jsonb_build_object(
        'name', 'picture',
        'displayName', 'Profile photo',
        'permissions', jsonb_build_object(
          'view', jsonb_build_array('admin', 'user'),
          'edit', jsonb_build_array('admin', 'user')
        ),
        'validations', jsonb_build_object(
          'length', jsonb_build_object('max', 200000)
        ),
        'multivalued', false
      )
    )
  )
)::text
FROM component AS c
JOIN realm AS r ON r.id = c.realm_id
WHERE cc.component_id = c.id
  AND cc.name = 'kc.user.profile.config'
  AND c.provider_id = 'declarative-user-profile'
  AND r.name IN ('devops', 'master')
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(cc.value::jsonb -> 'attributes') AS attr
    WHERE attr ->> 'name' = 'picture'
  );
SQL

log "Restarting keycloak so it reloads the user profile"
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

log "Profile photo attribute is available on devops and master"
