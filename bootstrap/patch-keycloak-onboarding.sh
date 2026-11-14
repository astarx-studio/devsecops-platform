#!/usr/bin/env bash
# Create the devops-realm service account the Management API uses to invite people.
# Idempotent. The bootstrap admin password is not used: on a running realm it often
# no longer matches Keycloak, so this writes the client through Postgres, like the
# other patch-keycloak scripts. Restarts Keycloak so the new client is visible.
# Writes KEYCLOAK_ONBOARDING_* into .env when those lines are missing.
# Usage: ./bootstrap/patch-keycloak-onboarding.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

export MSYS_NO_PATHCONV=1

log() { echo "[patch-keycloak-onboarding] $*"; }
die() { echo "[patch-keycloak-onboarding] ERROR $*" >&2; exit 1; }

[[ -f .env ]] || die "Missing .env"

env_val() {
  grep -E "^${1}=" .env | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//' || true
}

KC_REALM="$(env_val KC_REALM)"
PG_USER="$(env_val POSTGRES_ADMIN_USER)"
CLIENT_ID="$(env_val KEYCLOAK_ONBOARDING_CLIENT_ID)"
EXISTING_SECRET="$(env_val KEYCLOAK_ONBOARDING_CLIENT_SECRET)"
[[ -n "${KC_REALM}" ]] || KC_REALM="devops"
[[ -n "${CLIENT_ID}" ]] || CLIENT_ID="dsoaas-onboarding"
[[ "${KC_REALM}" =~ ^[A-Za-z0-9_-]+$ ]] || die "KC_REALM must be a simple name"
[[ "${CLIENT_ID}" =~ ^[A-Za-z0-9_-]+$ ]] || die "KEYCLOAK_ONBOARDING_CLIENT_ID must be a simple name"
[[ -n "${PG_USER}" ]] || die "POSTGRES_ADMIN_USER empty"

docker compose ps postgres 2>/dev/null | grep -q '(healthy)' \
  || die "postgres is not healthy — start the stack first"

NEW_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64url'))")"
[[ "${NEW_SECRET}" =~ ^[A-Za-z0-9_-]+$ ]] || die "generated secret was not url-safe"

psql_kc() {
  docker compose exec -T postgres psql -U "${PG_USER}" -d keycloak -v ON_ERROR_STOP=1 -tA "$@"
}

log "Ensuring client ${CLIENT_ID} in realm ${KC_REALM}"
psql_kc <<SQL
DO \$\$
DECLARE
  v_realm varchar;
  v_client varchar;
  v_user varchar;
  v_role varchar;
BEGIN
  SELECT id INTO v_realm FROM realm WHERE name = '${KC_REALM}';
  IF v_realm IS NULL THEN
    RAISE EXCEPTION 'realm ${KC_REALM} not found';
  END IF;

  SELECT id INTO v_client FROM client WHERE realm_id = v_realm AND client_id = '${CLIENT_ID}';
  IF v_client IS NULL THEN
    v_client := gen_random_uuid()::text;
    INSERT INTO client (
      id, enabled, full_scope_allowed, client_id, not_before, public_client, secret,
      bearer_only, surrogate_auth_required, realm_id, protocol, node_rereg_timeout,
      frontchannel_logout, consent_required, name, service_accounts_enabled,
      client_authenticator_type, standard_flow_enabled, implicit_flow_enabled,
      direct_access_grants_enabled, always_display_in_console
    ) VALUES (
      v_client, true, true, '${CLIENT_ID}', 0, false, '${NEW_SECRET}',
      false, false, v_realm, 'openid-connect', 0,
      false, false, 'YADA DSOaaS onboarding', true,
      'client-secret', false, false,
      false, false
    );
  END IF;

  SELECT id INTO v_user
  FROM user_entity
  WHERE realm_id = v_realm AND username = 'service-account-${CLIENT_ID}';
  IF v_user IS NULL THEN
    v_user := gen_random_uuid()::text;
    INSERT INTO user_entity (
      id, email_verified, enabled, realm_id, username, created_timestamp,
      service_account_client_link, not_before
    ) VALUES (
      v_user, false, true, v_realm, 'service-account-${CLIENT_ID}',
      (extract(epoch FROM now()) * 1000)::bigint, v_client, 0
    );
  ELSE
    UPDATE user_entity
    SET enabled = true, service_account_client_link = v_client
    WHERE id = v_user;
  END IF;

  FOR v_role IN
    SELECT r.id
    FROM keycloak_role AS r
    JOIN client AS c ON c.id = r.client
    WHERE c.realm_id = v_realm
      AND c.client_id = 'realm-management'
      AND r.name IN ('manage-users', 'view-users', 'query-users')
  LOOP
    INSERT INTO user_role_mapping (role_id, user_id)
    VALUES (v_role, v_user)
    ON CONFLICT (role_id, user_id) DO NOTHING;
  END LOOP;
END
\$\$;
SQL

SECRET="$(psql_kc -c "SELECT c.secret FROM client c JOIN realm r ON r.id = c.realm_id WHERE r.name = '${KC_REALM}' AND c.client_id = '${CLIENT_ID}';")"
SECRET="$(printf '%s' "$SECRET" | tr -d '[:space:]')"
[[ -n "$SECRET" ]] || die "Keycloak did not return a client secret"

export CLIENT_ID SECRET
node <<'NODE'
const fs = require('fs');
const path = '.env';
let text = fs.readFileSync(path, 'utf8');
const updates = {
  KEYCLOAK_ONBOARDING_CLIENT_ID: process.env.CLIENT_ID,
  KEYCLOAK_BASE_URL: 'http://keycloak:8080',
};
if (!/^KEYCLOAK_ONBOARDING_CLIENT_SECRET=.+/m.test(text)) {
  updates.KEYCLOAK_ONBOARDING_CLIENT_SECRET = process.env.SECRET;
}
for (const [key, value] of Object.entries(updates)) {
  const line = `${key}=${value}`;
  const re = new RegExp('^' + key + '=.*$', 'm');
  if (re.test(text)) text = text.replace(re, line);
  else text += (text.endsWith('\n') ? '' : '\n') + line + '\n';
}
fs.writeFileSync(path, text);
NODE

if [[ -n "${EXISTING_SECRET}" ]]; then
  log "Left the existing KEYCLOAK_ONBOARDING_CLIENT_SECRET in .env"
else
  log "Wrote KEYCLOAK_ONBOARDING_CLIENT_SECRET to .env"
fi

log "Allowing the personalEmail attribute so invite mail can be copied to that inbox"
export KC_REALM
PROFILE="$(psql_kc -c "SELECT cc.value FROM component_config cc JOIN component c ON c.id = cc.component_id JOIN realm r ON r.id = c.realm_id WHERE r.name = '${KC_REALM}' AND c.provider_id = 'declarative-user-profile' AND cc.name = 'kc.user.profile.config';")"
export PROFILE
node <<'NODE'
const fs = require('fs');
const profile = JSON.parse(process.env.PROFILE);
const attrs = Array.isArray(profile.attributes) ? profile.attributes : [];
if (!attrs.some((attr) => attr.name === 'personalEmail')) {
  attrs.push({
    name: 'personalEmail',
    displayName: 'Personal email',
    validations: { email: {}, length: { max: 255 } },
    permissions: { view: ['admin'], edit: ['admin'] },
    multivalued: false,
  });
  profile.attributes = attrs;
}
const json = JSON.stringify(profile);
if (json.includes('$profile$')) {
  throw new Error('user profile JSON cannot be written safely');
}
const realm = process.env.KC_REALM;
const sql = `UPDATE component_config AS cc
SET value = $profile$${json}$profile$
FROM component AS c
JOIN realm AS r ON r.id = c.realm_id
WHERE cc.component_id = c.id
  AND r.name = '${realm}'
  AND c.provider_id = 'declarative-user-profile'
  AND cc.name = 'kc.user.profile.config';
`;
fs.writeFileSync('.tmp-kc-profile.sql', sql);
NODE
psql_kc < .tmp-kc-profile.sql >/dev/null
rm -f .tmp-kc-profile.sql

log "Restarting keycloak so it loads the client"
docker compose restart keycloak >/dev/null
ready=0
for _ in $(seq 1 40); do
  if docker inspect keycloak --format '{{.State.Health.Status}}' 2>/dev/null | grep -q '^healthy$'; then
    ready=1
    break
  fi
  sleep 3
done
[[ "${ready}" = "1" ]] || die "keycloak did not become healthy after restart"
log "Client is ready. Recreate the api container so it reads the new environment."
