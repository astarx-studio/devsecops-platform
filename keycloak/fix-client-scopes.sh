#!/bin/sh
# ==========================================================================
# Fix Keycloak Client Scopes
# ==========================================================================
# Creates missing built-in OIDC scopes (openid, profile, email) in the
# devops realm and assigns them to all OIDC clients.
#
# Usage (from project root):
#   MSYS_NO_PATHCONV=1 docker run --rm --network devops-network \
#     -v "${PWD}/keycloak/fix-client-scopes.sh:/fix.sh:ro" \
#     curlimages/curl:latest sh /fix.sh
# ==========================================================================

set -e

KC_URL="${KC_URL:-http://keycloak:8080}"
KC_REALM="${KC_REALM:-devops}"
KC_ADMIN_USER="${KC_ADMIN_USER:-admin}"
KC_ADMIN_PASSWORD="${KC_ADMIN_PASSWORD:?KC_ADMIN_PASSWORD must be set (use KEYCLOAK_ADMIN_PASSWORD from .env)}"

CLIENTS="gitlab vault management-api oauth2-proxy"

echo "[INFO] Authenticating to Keycloak at ${KC_URL}..."
TOKEN=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" \
  -d "grant_type=password" \
  -d "username=${KC_ADMIN_USER}" \
  -d "password=${KC_ADMIN_PASSWORD}" | sed 's/.*"access_token":"\([^"]*\)".*/\1/')

if [ -z "$TOKEN" ]; then
  echo "[ERROR] Failed to get admin token"
  exit 1
fi
echo "[INFO] Authenticated successfully"

AUTH="Authorization: Bearer ${TOKEN}"
CT="Content-Type: application/json"
BASE="${KC_URL}/admin/realms/${KC_REALM}"

# --- Create 'openid' scope ---
echo ""
echo "[INFO] Creating 'openid' client scope..."
HTTP=$(curl -sf -o /dev/null -w "%{http_code}" -X POST -H "$AUTH" -H "$CT" \
  "${BASE}/client-scopes" -d '{
  "name": "openid",
  "description": "OpenID Connect scope",
  "protocol": "openid-connect",
  "attributes": {
    "include.in.token.scope": "true",
    "display.on.consent.screen": "false"
  }
}')
echo "[INFO] openid -> HTTP ${HTTP}"

# --- Create 'profile' scope with mappers ---
echo "[INFO] Creating 'profile' client scope..."
HTTP=$(curl -sf -o /dev/null -w "%{http_code}" -X POST -H "$AUTH" -H "$CT" \
  "${BASE}/client-scopes" -d '{
  "name": "profile",
  "description": "OpenID Connect built-in scope: profile",
  "protocol": "openid-connect",
  "attributes": {
    "include.in.token.scope": "true",
    "display.on.consent.screen": "true"
  },
  "protocolMappers": [
    {
      "name": "username",
      "protocol": "openid-connect",
      "protocolMapper": "oidc-usermodel-attribute-mapper",
      "consentRequired": false,
      "config": {
        "user.attribute": "username",
        "claim.name": "preferred_username",
        "id.token.claim": "true",
        "access.token.claim": "true",
        "userinfo.token.claim": "true",
        "jsonType.label": "String"
      }
    },
    {
      "name": "family name",
      "protocol": "openid-connect",
      "protocolMapper": "oidc-usermodel-attribute-mapper",
      "consentRequired": false,
      "config": {
        "user.attribute": "lastName",
        "claim.name": "family_name",
        "id.token.claim": "true",
        "access.token.claim": "true",
        "userinfo.token.claim": "true",
        "jsonType.label": "String"
      }
    },
    {
      "name": "given name",
      "protocol": "openid-connect",
      "protocolMapper": "oidc-usermodel-attribute-mapper",
      "consentRequired": false,
      "config": {
        "user.attribute": "firstName",
        "claim.name": "given_name",
        "id.token.claim": "true",
        "access.token.claim": "true",
        "userinfo.token.claim": "true",
        "jsonType.label": "String"
      }
    },
    {
      "name": "full name",
      "protocol": "openid-connect",
      "protocolMapper": "oidc-full-name-mapper",
      "consentRequired": false,
      "config": {
        "id.token.claim": "true",
        "access.token.claim": "true",
        "userinfo.token.claim": "true"
      }
    }
  ]
}')
echo "[INFO] profile -> HTTP ${HTTP}"

# --- Create 'email' scope with mappers ---
echo "[INFO] Creating 'email' client scope..."
HTTP=$(curl -sf -o /dev/null -w "%{http_code}" -X POST -H "$AUTH" -H "$CT" \
  "${BASE}/client-scopes" -d '{
  "name": "email",
  "description": "OpenID Connect built-in scope: email",
  "protocol": "openid-connect",
  "attributes": {
    "include.in.token.scope": "true",
    "display.on.consent.screen": "true"
  },
  "protocolMappers": [
    {
      "name": "email",
      "protocol": "openid-connect",
      "protocolMapper": "oidc-usermodel-attribute-mapper",
      "consentRequired": false,
      "config": {
        "user.attribute": "email",
        "claim.name": "email",
        "id.token.claim": "true",
        "access.token.claim": "true",
        "userinfo.token.claim": "true",
        "jsonType.label": "String"
      }
    },
    {
      "name": "email verified",
      "protocol": "openid-connect",
      "protocolMapper": "oidc-usermodel-attribute-mapper",
      "consentRequired": false,
      "config": {
        "user.attribute": "emailVerified",
        "claim.name": "email_verified",
        "id.token.claim": "true",
        "access.token.claim": "true",
        "userinfo.token.claim": "true",
        "jsonType.label": "boolean"
      }
    }
  ]
}')
echo "[INFO] email -> HTTP ${HTTP}"

# --- Create 'web-origins' scope ---
echo "[INFO] Creating 'web-origins' client scope..."
HTTP=$(curl -sf -o /dev/null -w "%{http_code}" -X POST -H "$AUTH" -H "$CT" \
  "${BASE}/client-scopes" -d '{
  "name": "web-origins",
  "description": "OpenID Connect scope for allowed web origins",
  "protocol": "openid-connect",
  "attributes": {
    "include.in.token.scope": "false",
    "display.on.consent.screen": "false"
  },
  "protocolMappers": [
    {
      "name": "allowed web origins",
      "protocol": "openid-connect",
      "protocolMapper": "oidc-allowed-origins-mapper",
      "consentRequired": false,
      "config": {}
    }
  ]
}')
echo "[INFO] web-origins -> HTTP ${HTTP}"

# --- Fetch all scopes and assign to clients ---
echo ""
echo "[INFO] Fetching scope IDs..."
ALL_SCOPES=$(curl -sf -H "$AUTH" "${BASE}/client-scopes")

SCOPE_NAMES="openid profile email web-origins"

for CLIENT_ID_NAME in $CLIENTS; do
  echo ""
  echo "[INFO] Processing client: ${CLIENT_ID_NAME}"

  CLIENT_JSON=$(curl -sf -H "$AUTH" "${BASE}/clients?clientId=${CLIENT_ID_NAME}")
  CLIENT_UUID=$(echo "$CLIENT_JSON" | sed 's/\[{//' | sed 's/}].*//' | sed 's/.*"id":"\([^"]*\)".*/\1/')

  if [ -z "$CLIENT_UUID" ] || [ "$CLIENT_UUID" = "[]" ]; then
    echo "[WARN] Client '${CLIENT_ID_NAME}' not found, skipping"
    continue
  fi
  echo "[INFO] Client UUID: ${CLIENT_UUID}"

  for SCOPE_NAME in $SCOPE_NAMES; do
    SCOPE_ID=$(echo "$ALL_SCOPES" | sed 's/},{/}\n{/g' | grep "\"name\":\"${SCOPE_NAME}\"" | sed 's/.*"id":"\([^"]*\)".*/\1/')

    if [ -z "$SCOPE_ID" ]; then
      echo "[WARN]   Scope '${SCOPE_NAME}' not found"
      continue
    fi

    HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" -X PUT -H "$AUTH" \
      "${BASE}/clients/${CLIENT_UUID}/default-client-scopes/${SCOPE_ID}")

    echo "[OK]    ${CLIENT_ID_NAME} <- ${SCOPE_NAME} (HTTP ${HTTP_CODE})"
  done
done

echo ""
echo "[INFO] All done. GitLab OIDC login should now work."
