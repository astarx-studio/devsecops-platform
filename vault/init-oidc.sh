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

echo "[INFO] Waiting for OpenBao to be ready..."
until wget --spider --quiet "${VAULT_ADDR}/v1/sys/health" 2>/dev/null; do
  echo "[DEBUG] OpenBao not ready, retrying in 2s..."
  sleep 2
done
echo "[INFO] OpenBao is ready."

echo "[INFO] Enabling OIDC auth method..."
bao auth enable oidc 2>/dev/null || echo "[WARN] OIDC auth method already enabled (skipping)."

echo "[INFO] Configuring OIDC auth method with Keycloak issuer..."
echo "[DEBUG] Discovery URL: ${KEYCLOAK_ISSUER_URL}"

bao write auth/oidc/config \
  oidc_discovery_url="${KEYCLOAK_ISSUER_URL}" \
  oidc_client_id="vault" \
  oidc_client_secret="${KC_CLIENT_SECRET_VAULT}" \
  default_role="default"

echo "[INFO] Creating OIDC role 'default'..."
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

echo "[INFO] OpenBao OIDC configuration complete."
echo "[DEBUG] Issuer: ${KEYCLOAK_ISSUER_URL}"
echo "[DEBUG] Redirect: ${VAULT_EXTERNAL_URL}/ui/vault/auth/oidc/oidc/callback"
