#!/usr/bin/env bash
# Repair the devops realm so users can open the account console after login
# and complete forgot-password. Idempotent. Restarts Keycloak to drop its cache.
# Usage: ./bootstrap/patch-keycloak-account.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { echo "[patch-keycloak-account] $*"; }
die() { echo "[patch-keycloak-account] ERROR $*" >&2; exit 1; }

[[ -f .env ]] || die "Missing .env"

env_val() {
  grep -E "^${1}=" .env | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//'
}

KC_REALM="$(env_val KC_REALM)"
PG_USER="$(env_val POSTGRES_ADMIN_USER)"
[[ -n "${KC_REALM}" ]] || KC_REALM="devops"
[[ "${KC_REALM}" =~ ^[A-Za-z0-9_-]+$ ]] || die "KC_REALM must be a simple name"
[[ -n "${PG_USER}" ]] || die "POSTGRES_ADMIN_USER empty"

docker compose ps postgres 2>/dev/null | grep -q '(healthy)' \
  || die "postgres is not healthy — start the stack first"

psql_kc() {
  docker compose exec -T postgres psql -U "${PG_USER}" -d keycloak -v ON_ERROR_STOP=1 "$@"
}

log "Patching realm ${KC_REALM}: account scopes, role mappers, reset-link lifetime"
psql_kc <<SQL
DO \$\$
DECLARE
  v_realm varchar;
  v_scope varchar;
  v_mapper varchar;
BEGIN
  SELECT id INTO v_realm FROM realm WHERE name = '${KC_REALM}';
  IF v_realm IS NULL THEN
    RAISE EXCEPTION 'realm ${KC_REALM} not found';
  END IF;

  -- basic scope (sub, auth_time). Built-in on a stock realm; missing after this import.
  SELECT id INTO v_scope FROM client_scope WHERE realm_id = v_realm AND name = 'basic';
  IF v_scope IS NULL THEN
    v_scope := gen_random_uuid()::text;
    INSERT INTO client_scope (id, name, realm_id, description, protocol)
    VALUES (v_scope, 'basic', v_realm, 'OpenID Connect built-in scope: basic', 'openid-connect');
  END IF;
  INSERT INTO client_scope_attributes (scope_id, name, value) VALUES
    (v_scope, 'include.in.token.scope', 'false'),
    (v_scope, 'display.on.consent.screen', 'false')
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_mapper FROM protocol_mapper WHERE client_scope_id = v_scope AND name = 'sub';
  IF v_mapper IS NULL THEN
    v_mapper := gen_random_uuid()::text;
    INSERT INTO protocol_mapper (id, name, protocol, protocol_mapper_name, client_scope_id)
    VALUES (v_mapper, 'sub', 'openid-connect', 'oidc-sub-mapper', v_scope);
    INSERT INTO protocol_mapper_config (protocol_mapper_id, name, value) VALUES
      (v_mapper, 'access.token.claim', 'true'),
      (v_mapper, 'introspection.token.claim', 'true');
  END IF;

  SELECT id INTO v_mapper FROM protocol_mapper WHERE client_scope_id = v_scope AND name = 'auth_time';
  IF v_mapper IS NULL THEN
    v_mapper := gen_random_uuid()::text;
    INSERT INTO protocol_mapper (id, name, protocol, protocol_mapper_name, client_scope_id)
    VALUES (v_mapper, 'auth_time', 'openid-connect', 'oidc-usersessionmodel-note-mapper', v_scope);
    INSERT INTO protocol_mapper_config (protocol_mapper_id, name, value) VALUES
      (v_mapper, 'user.session.note', 'AUTH_TIME'),
      (v_mapper, 'claim.name', 'auth_time'),
      (v_mapper, 'jsonType.label', 'long'),
      (v_mapper, 'access.token.claim', 'true'),
      (v_mapper, 'id.token.claim', 'true'),
      (v_mapper, 'introspection.token.claim', 'true');
  END IF;

  -- acr scope
  SELECT id INTO v_scope FROM client_scope WHERE realm_id = v_realm AND name = 'acr';
  IF v_scope IS NULL THEN
    v_scope := gen_random_uuid()::text;
    INSERT INTO client_scope (id, name, realm_id, description, protocol)
    VALUES (v_scope, 'acr', v_realm, 'OpenID Connect scope for authentication context', 'openid-connect');
  END IF;
  INSERT INTO client_scope_attributes (scope_id, name, value) VALUES
    (v_scope, 'include.in.token.scope', 'false'),
    (v_scope, 'display.on.consent.screen', 'false')
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_mapper FROM protocol_mapper WHERE client_scope_id = v_scope AND name = 'acr loa level';
  IF v_mapper IS NULL THEN
    v_mapper := gen_random_uuid()::text;
    INSERT INTO protocol_mapper (id, name, protocol, protocol_mapper_name, client_scope_id)
    VALUES (v_mapper, 'acr loa level', 'openid-connect', 'oidc-acr-mapper', v_scope);
    INSERT INTO protocol_mapper_config (protocol_mapper_id, name, value) VALUES
      (v_mapper, 'access.token.claim', 'true'),
      (v_mapper, 'id.token.claim', 'true'),
      (v_mapper, 'introspection.token.claim', 'true');
  END IF;

  -- roles scope: keep realm_roles, add the mappers the account console requires
  SELECT id INTO v_scope FROM client_scope WHERE realm_id = v_realm AND name = 'roles';
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'roles client scope missing in realm ${KC_REALM}';
  END IF;

  SELECT id INTO v_mapper FROM protocol_mapper WHERE client_scope_id = v_scope AND name = 'realm access roles';
  IF v_mapper IS NULL THEN
    v_mapper := gen_random_uuid()::text;
    INSERT INTO protocol_mapper (id, name, protocol, protocol_mapper_name, client_scope_id)
    VALUES (v_mapper, 'realm access roles', 'openid-connect', 'oidc-usermodel-realm-role-mapper', v_scope);
    INSERT INTO protocol_mapper_config (protocol_mapper_id, name, value) VALUES
      (v_mapper, 'multivalued', 'true'),
      (v_mapper, 'user.attribute', 'foo'),
      (v_mapper, 'introspection.token.claim', 'true'),
      (v_mapper, 'access.token.claim', 'true'),
      (v_mapper, 'claim.name', 'realm_access.roles'),
      (v_mapper, 'jsonType.label', 'String');
  END IF;

  SELECT id INTO v_mapper FROM protocol_mapper WHERE client_scope_id = v_scope AND name = 'client roles';
  IF v_mapper IS NULL THEN
    v_mapper := gen_random_uuid()::text;
    INSERT INTO protocol_mapper (id, name, protocol, protocol_mapper_name, client_scope_id)
    VALUES (v_mapper, 'client roles', 'openid-connect', 'oidc-usermodel-client-role-mapper', v_scope);
    INSERT INTO protocol_mapper_config (protocol_mapper_id, name, value) VALUES
      (v_mapper, 'user.attribute', 'foo'),
      (v_mapper, 'access.token.claim', 'true'),
      (v_mapper, 'claim.name', 'resource_access.\${client_id}.roles'),
      (v_mapper, 'jsonType.label', 'String'),
      (v_mapper, 'multivalued', 'true'),
      (v_mapper, 'introspection.token.claim', 'true');
  END IF;

  SELECT id INTO v_mapper FROM protocol_mapper WHERE client_scope_id = v_scope AND name = 'audience resolve';
  IF v_mapper IS NULL THEN
    v_mapper := gen_random_uuid()::text;
    INSERT INTO protocol_mapper (id, name, protocol, protocol_mapper_name, client_scope_id)
    VALUES (v_mapper, 'audience resolve', 'openid-connect', 'oidc-audience-resolve-mapper', v_scope);
    INSERT INTO protocol_mapper_config (protocol_mapper_id, name, value) VALUES
      (v_mapper, 'access.token.claim', 'true'),
      (v_mapper, 'introspection.token.claim', 'true');
  END IF;

  -- account + account-console had no scopes, so login could not carry manage-account
  INSERT INTO client_scope_client (client_id, scope_id, default_scope)
  SELECT c.id, cs.id, true
  FROM client c
  JOIN client_scope cs ON cs.realm_id = c.realm_id
  WHERE c.realm_id = v_realm
    AND c.client_id IN ('account', 'account-console')
    AND cs.name IN ('acr', 'basic', 'email', 'profile', 'roles', 'web-origins')
  ON CONFLICT DO NOTHING;

  -- declarative user profile (account Personal info form)
  IF NOT EXISTS (
    SELECT 1 FROM component c
    WHERE c.realm_id = v_realm AND c.provider_id = 'declarative-user-profile'
  ) THEN
    INSERT INTO component (id, name, parent_id, provider_id, provider_type, realm_id, sub_type)
    SELECT gen_random_uuid()::text, src.name, v_realm, src.provider_id, src.provider_type, v_realm, src.sub_type
    FROM component src
    JOIN realm mr ON mr.id = src.realm_id AND mr.name = 'master'
    WHERE src.provider_id = 'declarative-user-profile'
    LIMIT 1;

    INSERT INTO component_config (id, component_id, name, value)
    SELECT gen_random_uuid()::text, dest.id, cc.name, cc.value
    FROM component src
    JOIN realm mr ON mr.id = src.realm_id AND mr.name = 'master'
    JOIN component_config cc ON cc.component_id = src.id
    JOIN component dest ON dest.realm_id = v_realm AND dest.provider_id = 'declarative-user-profile'
    WHERE src.provider_id = 'declarative-user-profile';
  END IF;

  -- forgot-password / verify-email links: 30 minutes (stock default is 5)
  IF EXISTS (
    SELECT 1 FROM realm_attribute
    WHERE realm_id = v_realm AND name = 'actionTokenGeneratedByUserLifespan'
  ) THEN
    UPDATE realm_attribute
    SET value = '1800'
    WHERE realm_id = v_realm
      AND name = 'actionTokenGeneratedByUserLifespan'
      AND value::int < 1800;
  ELSE
    INSERT INTO realm_attribute (realm_id, name, value)
    VALUES (v_realm, 'actionTokenGeneratedByUserLifespan', '1800');
  END IF;

  UPDATE realm SET reset_password_allowed = true WHERE id = v_realm AND reset_password_allowed = false;
END
\$\$;
SQL

log "Restarting keycloak so it reloads clients and realm settings"
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
log "Account console scopes are in place. Profile: https://${KC_DOMAIN}/realms/${KC_REALM}/account/"
