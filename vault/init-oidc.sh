#!/bin/sh
# ==========================================================================
# OpenBao OIDC Auth Method Initialization
# ==========================================================================
# Enables OIDC authentication in OpenBao, pointing to the Keycloak devops realm.
# Idempotent: "bao auth enable" fails gracefully if already enabled.
#
# Uses JWKS URL + bound_issuer instead of oidc_discovery_url to work around
# the issuer mismatch when the internal Keycloak URL differs from the
# external issuer URL (go-oidc library strict validation).
#
# Required env vars:
#   VAULT_ADDR               - OpenBao HTTP address (VAULT_* prefix kept for backward compat)
#   VAULT_TOKEN              - OpenBao root/admin token
#   KC_CLIENT_SECRET_VAULT   - Keycloak client secret for the "vault" client
#   KEYCLOAK_ISSUER_URL      - Keycloak OIDC issuer URL (external, full URL including realm path)
#   VAULT_EXTERNAL_URL       - OpenBao external URL for redirect URIs (https://vault.devops.yourdomain.com)
# ==========================================================================

set -e

# Use bootstrap root token file when .env VAULT_ROOT_TOKEN is not set yet (first prod init).
if [ -z "${VAULT_TOKEN:-}" ] && [ -r /work/root-token ]; then
  VAULT_TOKEN=$(cat /work/root-token)
  export VAULT_TOKEN
  echo "[INFO] Using root token from /work/root-token"
fi
: "${VAULT_TOKEN:?VAULT_TOKEN or /work/root-token required}"

echo "[INFO] Waiting for OpenBao to be ready..."
until wget --spider --quiet "${VAULT_ADDR}/v1/sys/health" 2>/dev/null; do
  echo "[DEBUG] OpenBao not ready, retrying in 2s..."
  sleep 2
done
echo "[INFO] OpenBao is ready."

if bao auth list -format=json 2>/dev/null | grep -q '"oidc/"'; then
  echo "[INFO] OIDC auth method already enabled (skipping enable)."
else
  echo "[INFO] Enabling OIDC auth method..."
  bao auth enable oidc
fi

echo "[INFO] Configuring OIDC auth method with Keycloak issuer..."
echo "[DEBUG] Discovery URL: ${KEYCLOAK_ISSUER_URL}"

bao write auth/oidc/config \
  oidc_discovery_url="${KEYCLOAK_ISSUER_URL}" \
  oidc_client_id="vault" \
  oidc_client_secret="${KC_CLIENT_SECRET_VAULT}" \
  default_role="default"

echo "[INFO] Creating OIDC role 'default'..."
# groups_claim is required by OpenBao when set; Keycloak omits the claim if the user
# belongs to no groups. Realm defaultGroups (/users) ensures the claim is present.
bao write auth/oidc/role/default \
  allowed_redirect_uris="${VAULT_EXTERNAL_URL}/ui/vault/auth/oidc/oidc/callback" \
  allowed_redirect_uris="http://localhost:8250/oidc/callback" \
  user_claim="preferred_username" \
  groups_claim="groups" \
  oidc_scopes="openid,profile,email,groups" \
  policies="default" \
  ttl="1h"

# -----------------------------------------------------------------------
# Admin policy + group mapping
# -----------------------------------------------------------------------
echo "[INFO] Creating admin policy..."
bao policy write admin - <<'POLICY'
path "*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}
POLICY

echo "[INFO] Creating external group 'admins' with admin policy..."
# Get the OIDC auth method accessor
OIDC_ACCESSOR=$(bao auth list -format=json | awk -F'"' '/"oidc\/"/{found=1} found && /accessor/{print $4; exit}')
echo "[DEBUG] OIDC accessor: ${OIDC_ACCESSOR}"

# Create external group (idempotent: if it exists, update it)
GROUP_ID=$(bao write -format=json identity/group \
  name="admins" \
  type="external" \
  policies="admin" 2>/dev/null | awk -F'"' '/"id"/{print $4; exit}')

# If group already exists, read its ID instead
if [ -z "${GROUP_ID}" ]; then
  GROUP_ID=$(bao read -format=json identity/group/name/admins 2>/dev/null | awk -F'"' '/"id"/{print $4; exit}')
fi
echo "[DEBUG] Group ID: ${GROUP_ID}"

# Create group alias (links Keycloak "admins" group to OpenBao external group)
if [ -n "${GROUP_ID}" ] && [ -n "${OIDC_ACCESSOR}" ]; then
  bao write identity/group-alias \
    name="admins" \
    mount_accessor="${OIDC_ACCESSOR}" \
    canonical_id="${GROUP_ID}" 2>/dev/null || echo "[WARN] Group alias already exists (skipping)."
  echo "[INFO] Admin group mapping complete."
else
  echo "[WARN] Could not create group alias — missing group ID or OIDC accessor."
fi

# External group for Keycloak "users" (default group) — standard login, default policy on role
echo "[INFO] Creating external group 'users' (default Keycloak group)..."
USERS_GROUP_ID=$(bao write -format=json identity/group \
  name="users" \
  type="external" \
  policies="default" 2>/dev/null | awk -F'"' '/"id"/{print $4; exit}')
if [ -z "${USERS_GROUP_ID}" ]; then
  USERS_GROUP_ID=$(bao read -format=json identity/group/name/users 2>/dev/null | awk -F'"' '/"id"/{print $4; exit}')
fi
if [ -n "${USERS_GROUP_ID}" ] && [ -n "${OIDC_ACCESSOR}" ]; then
  bao write identity/group-alias \
    name="users" \
    mount_accessor="${OIDC_ACCESSOR}" \
    canonical_id="${USERS_GROUP_ID}" 2>/dev/null || echo "[WARN] users group alias already exists (skipping)."
  echo "[INFO] users group mapping complete."
fi

echo "[INFO] OpenBao OIDC configuration complete."
echo "[DEBUG] Issuer: ${KEYCLOAK_ISSUER_URL}"
echo "[DEBUG] Redirect: ${VAULT_EXTERNAL_URL}/ui/vault/auth/oidc/oidc/callback"
