# Secrets Management

← [Back to Maintainer Guide](index.md)

This document covers Vault's configuration, the KV v2 secret path structure, the OIDC auth method setup, Keycloak client configuration for secrets-accessing services, and operational procedures.

---

## Vault overview

Vault runs in **dev mode** (`server -dev`), which means it is automatically initialized and unsealed on every start. Data is persisted at `.vols/vault` via the Docker volume mount. A production-ready `vault/config.hcl` is included for future migration to server mode:

```hcl
storage "file" {
  path = "/vault/data"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = 1   # TLS terminated by Traefik
}

ui = true

default_lease_ttl = "168h"   # 7 days
max_lease_ttl     = "720h"   # 30 days
```

TLS is **not** terminated by Vault itself. All traffic arrives via Traefik (which handles TLS) or directly from internal services (plain HTTP on `devops-network`).

---

## First boot: dev mode behavior

In dev mode, Vault is **automatically initialized and unsealed** on every start using `VAULT_DEV_ROOT_TOKEN_ID` as the root token. No manual initialization or unsealing is needed.

```sh
# Verify Vault is running and unsealed
docker exec vault vault status
```

The `VAULT_DEV_ROOT_TOKEN_ID` in `.env` serves as both the dev mode root token and the token used by the Management API.

**Note:** If you switch to production mode (changing the docker-compose command to `server -config=/vault/prod-config/config.hcl`), Vault will start in an **uninitialized, sealed** state and require manual initialization and unsealing. See the "Switching to production mode" section below.

---

## Secret path structure

All per-project secrets are stored under the `secret/` KV v2 mount (default mount, auto-enabled).

```
secret/
└── data/
    └── projects/
        ├── {clientName}/
        │   ├── {projectName}/
        │   │   data:
        │   │     PROJECT_NAME: "{projectName}"
        │   │     CLIENT_NAME: "{clientName}"
        │   │     GITLAB_PROJECT_ID: "{gitlabProjectId}"
        │   │     DEPLOYMENT_ENV: "local"
        │   │     [custom keys from envVars...]
        │   └── {anotherProject}/
        └── {anotherClient}/
```

**Standard keys written by `ProjectsService`:**

| Key | Value | Description |
|---|---|---|
| `PROJECT_NAME` | `{projectName}` | Project identifier |
| `CLIENT_NAME` | `{clientName}` | Client identifier |
| `GITLAB_PROJECT_ID` | `{id}` | GitLab project numeric ID |
| `DEPLOYMENT_ENV` | `local` | Always `local` (only mode supported) |

**Custom keys** are passed via `envVars` in `CreateProjectDto` and merged with the standard keys. Custom keys override standard keys if names collide.

### KV v2 versioning

KV v2 stores a version history for each secret path. The `VaultService.writeSecrets()` method writes to `/v1/secret/data/{path}` which creates a new version (or version 1 for new paths). `deleteSecrets()` calls `/v1/secret/metadata/{path}` which permanently deletes **all versions** and the metadata for the path.

To read the latest version manually:
```sh
docker exec -it vault vault kv get secret/projects/{clientName}/{projectName}
```

To view version history:
```sh
docker exec -it vault vault kv metadata get secret/projects/{clientName}/{projectName}
```

---

## OIDC auth method

The `vault-oidc-init` container configures the OIDC auth method on first boot (idempotent). The script `vault/init-oidc.sh` performs these steps:

### 1. Enable OIDC auth

```sh
vault auth enable oidc  # or "already enabled" — script ignores this error
```

### 2. Configure OIDC

```sh
vault write auth/oidc/config \
  oidc_discovery_url="${KEYCLOAK_ISSUER_URL}" \
  oidc_client_id="vault" \
  oidc_client_secret="${KC_CLIENT_SECRET_VAULT}" \
  default_role="default"
```

`KEYCLOAK_ISSUER_URL` is sourced from `${OIDC_ISSUER_URL}` in `.env`, which is the **external** public Keycloak URL (e.g. `https://auth.devops.yourdomain.com/realms/devops`). This resolves correctly inside the Docker network because Traefik is aliased to all `*.devops.<DOMAIN>` hostnames on `devops-network`, so internal DNS resolution of `auth.devops.yourdomain.com` routes to Traefik → Keycloak without leaving the host. Vault uses this URL to fetch the discovery document (`.well-known/openid-configuration`) and the JWKS endpoint.

### 3. Create default role

```sh
vault write auth/oidc/role/default \
  role_type="oidc" \
  allowed_redirect_uris="${VAULT_EXTERNAL_URL}/ui/vault/auth/oidc/oidc/callback" \
  allowed_redirect_uris="http://localhost:8250/oidc/callback" \
  user_claim="preferred_username" \
  policies="default" \
  ttl="1h"
```

| Parameter | Value | Notes |
|---|---|---|
| `role_type` | `oidc` | Use the OIDC flow (not JWT) |
| `allowed_redirect_uris` | External URL + localhost | External for UI login; localhost for CLI login |
| `user_claim` | `preferred_username` | Maps Keycloak username to Vault entity |
| `policies` | `default` | Minimal access; extend for production |
| `ttl` | `1h` | Token lifetime |

---

## Keycloak client configuration for Vault

The `vault` client in Keycloak (defined in `keycloak/realm-export.json`):

| Setting | Value |
|---|---|
| `clientId` | `vault` |
| `redirectUris` | `https://${VAULT_DOMAIN}/ui/vault/auth/oidc/oidc/callback`, `http://localhost:8250/oidc/callback` |
| `webOrigins` | `https://${VAULT_DOMAIN}` |
| `standardFlowEnabled` | `true` (Authorization Code flow) |
| `serviceAccountsEnabled` | `false` |
| Secret | `${KC_CLIENT_SECRET_VAULT}` (set in realm-export.json placeholder) |

The client secret must match `KC_CLIENT_SECRET_VAULT` in `.env`.

---

## Authentication flows supported

### UI login (browser)

1. User navigates to `https://${VAULT_DOMAIN}/ui`.
2. Selects "OIDC" auth method.
3. Vault redirects to Keycloak login page.
4. User authenticates; Keycloak redirects back to Vault UI with an auth code.
5. Vault exchanges the code for tokens, validates the JWT, and issues a Vault token.

### CLI login

```sh
vault login -method=oidc -address=https://${VAULT_DOMAIN}
# Opens a browser for Keycloak login, then captures the callback on localhost:8250
```

### Token auth (Management API)

The Management API uses a static `VAULT_DEV_ROOT_TOKEN_ID` (passed as `X-Vault-Token` header). This bypasses OIDC entirely. This is appropriate for server-to-server automation but should be hardened in production (see below).

---

## Hardening the Management API Vault token

The current setup uses a root-level token for the Management API. For production, create a policy-scoped token:

```sh
# 1. Create policy
vault policy write management-api - <<EOF
path "secret/data/projects/*" {
  capabilities = ["create", "update", "read", "delete"]
}
path "secret/metadata/projects/*" {
  capabilities = ["delete", "list"]
}
EOF

# 2. Create token with policy
vault token create \
  -policy="management-api" \
  -ttl="0" \
  -no-default-policy
```

Set `VAULT_DEV_ROOT_TOKEN_ID` in `.env` to the new token's value. Restart the `api` container.

---

## Switching to production mode

In dev mode, Vault auto-unseals on every start — no manual intervention is needed. If you want to switch to production mode for better security:

1. Change the docker-compose command from `server -dev` to `server -config=/vault/prod-config/config.hcl`.
2. Remove the `VAULT_DEV_*` environment variables.
3. On first start, initialize Vault manually:

```sh
docker exec -it vault vault operator init -key-shares=5 -key-threshold=3
```

4. Unseal with 3 of the 5 keys:

```sh
docker exec -it vault vault operator unseal <key1>
docker exec -it vault vault operator unseal <key2>
docker exec -it vault vault operator unseal <key3>
```

5. Store the unseal keys securely (e.g. a password manager, separate from this machine). You will need them after every Vault restart.

**Automatic unseal** options for reducing manual intervention:

1. **Vault Auto Unseal** — Use a cloud KMS (AWS KMS, GCP KMS, Azure Key Vault) via `seal "awskms" {}` or equivalent in `config.hcl`.
2. **Shamir with encrypted key storage** — Store the unseal keys in a secure location accessible via a startup script.

---

## Rotating the `VAULT_DEV_ROOT_TOKEN_ID`

If the token is compromised or expires:

```sh
# Option 1: Revoke and create new
vault token revoke <old-token>
vault token create -policy="management-api" -ttl="0"

# Option 2: Revoke all tokens and re-initialize (destructive — last resort)
vault operator rotate
```

After updating the token in `.env`, restart the `api` container:
```sh
docker compose up -d api
```

---

## Vault operational runbook

```sh
# Check status (should show Sealed: false in dev mode)
docker exec vault vault status

# Check token validity
docker exec vault vault token lookup <token>

# Seal (emergency — if a breach is suspected; will require unseal to resume)
docker exec vault vault operator seal

# Unseal (only needed in production mode or after emergency seal)
docker exec vault vault operator unseal <key>
```

---

## Secret access from CI/CD

Project secrets stored in Vault are not automatically injected into GitLab CI jobs. In v1, the supported pattern is:

### GitLab CI masked variables

An operator reads the secrets from Vault and manually adds them as masked CI/CD variables in the GitLab project settings (**Settings → CI/CD → Variables**). Mark each variable as **Masked** so its value is redacted from job logs.

This is the only pattern that works out of the box with the current v1 Vault setup (OIDC auth method configured against Keycloak, not GitLab). Automated Vault-in-CI patterns (e.g., using GitLab ID tokens against a Vault JWT auth method) require additional Vault configuration not included in v1.
