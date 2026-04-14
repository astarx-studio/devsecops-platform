# Services Reference

← [Back to Maintainer Guide](index.md)

Each service in the Docker Compose stack is documented here with its image, host-exposed ports, volumes, critical environment variables, health check logic, and known operational notes.

All services share the `devops-network` Docker bridge network. The network name is driven by `${DOCKER_NETWORK}` (default: `devops-network`).

---

## Startup order summary

| Boot phase | Services |
|---|---|
| Phase 1 — immediate | `traefik`, `kong-db`, `keycloak-db`, `vault` |
| Phase 2 — after kong-db healthy | `kong-migration` |
| Phase 3 — after kong-migration complete | `kong` |
| Phase 4 — after kong healthy | `kong-deck-sync` |
| Phase 5 — after keycloak-db healthy | `keycloak` |
| Phase 5 — after keycloak healthy | `oauth2-proxy` |
| Phase 5 — after vault + keycloak healthy | `vault-oidc-init` |
| Phase 5 — after vault + kong healthy | `api` |
| Phase 6 — after gitlab healthy | `gitlab-runner` |
| Profile-gated (manual) | `cloudflared` (only with `--profile cftunnel`) |

---

## traefik

| Field | Value |
|---|---|
| Image | `traefik:v3.6` |
| Host ports | `10080→80`, `10443→443`, `18080→8080` (dashboard) |
| Volumes | Docker socket (read-only), `./traefik/traefik.yml` → `/etc/traefik/traefik-template.yml` (template), `./traefik/dynamic/` (file provider), `./.vols/traefik/certs/` (ACME state) |
| Depends on | — |

**Entrypoint processing:** The container uses a custom entrypoint (`/bin/sh -c`) that:
1. Runs `sed` to substitute `__DOMAIN__` and `__ACME_EMAIL__` placeholders in the template, writing the result to `/etc/traefik/traefik.yml` inside the container.
2. Runs `touch` + `chmod 600` on `acme.json` (Windows Docker bind mounts don't preserve Unix permissions).
3. Execs `traefik --configFile=/etc/traefik/traefik.yml`.

**Key environment variables:**

| Variable | Purpose |
|---|---|
| `DOMAIN` | Base domain — substituted into `__DOMAIN__` placeholders in the template |
| `ACME_EMAIL` | Let's Encrypt registration email — substituted into `__ACME_EMAIL__` |
| `CF_DNS_API_TOKEN` | Cloudflare API token for ACME DNS-01 challenge |

**Health check:** `traefik healthcheck --ping` via the `:8082/ping` endpoint. Interval 15s, timeout 5s, 3 retries, 10s start period.

**Network aliases:** All service domains are added as aliases on `devops-network` so internal DNS resolves identically to external. See `docker-compose.yml` for the full list.

**Operational notes:**
- `traefik.yml` on disk is a **template** with `__DOMAIN__` and `__ACME_EMAIL__` placeholders. It is never read directly by Traefik — the entrypoint produces the real config at `/etc/traefik/traefik.yml` inside the container.
- On Windows Docker, `acme.json` permissions don't persist across restarts. The entrypoint script handles `chmod 600` automatically at every start.
- ACME DNS challenge uses `propagation.delayBeforeChecks: 60` (waits 60s after creating the TXT record before requesting Let's Encrypt validation).
- The dashboard is at port `18080` on the host but also exposed publicly via the `${TRAEFIK_DOMAIN}` route (behind OIDC auth).
- Access logs are written to stdout, JSON format, filtered to status codes 400–599.

---

## kong-db

| Field | Value |
|---|---|
| Image | `postgres:17-alpine` |
| Host ports | `15432→5432` |
| Volumes | `./.vols/kong-db` → `/var/lib/postgresql/data` |
| Depends on | — |

**Key environment variables:** `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (mapped from `${KONG_PG_USER}`, `${KONG_PG_PASSWORD}`, `${KONG_PG_DATABASE}`).

**Health check:** `pg_isready -U ${KONG_PG_USER} -d ${KONG_PG_DATABASE}`. Interval 10s, timeout 5s, 5 retries.

---

## kong-migration

| Field | Value |
|---|---|
| Image | `kong:3.9` |
| Host ports | — |
| Volumes | — |
| Depends on | `kong-db` (healthy) |

Runs `kong migrations bootstrap` once. Exits with code 0 on success or if migrations are already applied. `kong` service depends on this completing successfully.

---

## kong

| Field | Value |
|---|---|
| Image | `kong:3.9` |
| Host ports | `18000→8000` (proxy HTTP), `18443→8443` (proxy HTTPS), `18001→8001` (admin HTTP) |
| Volumes | — |
| Depends on | `kong-migration` (completed successfully) |

**Key environment variables:**

| Variable | Purpose |
|---|---|
| `KONG_DATABASE` | `postgres` |
| `KONG_PG_HOST` | `kong-db` |
| `KONG_PG_USER` / `KONG_PG_PASSWORD` / `KONG_PG_DATABASE` | Database credentials |
| `KONG_PROXY_ACCESS_LOG` / `KONG_ADMIN_ACCESS_LOG` | Log targets (`/dev/stdout`) |
| `KONG_PROXY_ERROR_LOG` / `KONG_ADMIN_ERROR_LOG` | Error log targets (`/dev/stderr`) |
| `KONG_ADMIN_LISTEN` | `0.0.0.0:8001` |

**Health check:** `kong health` CLI. Interval 15s, timeout 5s, 5 retries, 30s start period.

**Traefik Docker labels (defined in `docker-compose.yml`):**
- Routes `${KONG_ADMIN_DOMAIN}` → port `8001`.
- Protected by the `oidc-auth@file` ForwardAuth middleware.

**Operational notes:**
- The admin API (port 8001) is accessible on the host at `localhost:18001` without authentication for debugging. Do not expose port 18001 to the public network.
- Kong is deliberately configured without declarative mode at startup. Declarative config is applied by `kong-deck-sync` after Kong is healthy.

---

## kong-deck-sync

| Field | Value |
|---|---|
| Image | Custom inline build: alpine + deck binary copied from `kong/deck:latest` |
| Host ports | — |
| Volumes | `./kong/kong.template.yml` → `/kong/kong.template.yml` (read-only) |
| Depends on | `kong` (healthy) |

One-shot service. The `kong/deck` image is distroless (no shell), so the service uses an inline `dockerfile_inline` multi-stage build that copies the `deck` binary from the official image into alpine. At startup:

1. Uses `sed` to substitute all `${VAR}` placeholders in `/kong/kong.template.yml` with values from the container environment, writing to `/tmp/kong.yml`.
2. Runs `deck gateway sync /tmp/kong.yml --kong-addr http://kong:8001`.

Any service declared in `kong.template.yml` but already present in Kong is updated (idempotent). Services not in the template but present in Kong are left untouched (no `--select-tag` filter).

**Key environment variables:** `KEYCLOAK_DOMAIN`, `VAULT_DOMAIN`, `KONG_DOMAIN`, `GITLAB_DOMAIN`, `GITLAB_REGISTRY_DOMAIN`, `API_DOMAIN`, `OAUTH_DOMAIN`.

**Operational notes:**
- If you add a new service to `kong.template.yml`, re-run this container: `docker compose run --rm kong-deck-sync`.
- Dynamically provisioned project routes (via Management API) are applied directly to Kong via its Admin API and are not tracked in `kong.template.yml`.
- The first run requires building the image: `docker compose build kong-deck-sync`.

---

## keycloak-db

| Field | Value |
|---|---|
| Image | `postgres:17-alpine` |
| Host ports | `15433→5432` |
| Volumes | `./.vols/keycloak-db` → `/var/lib/postgresql/data` |
| Depends on | — |

**Key environment variables:** `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (mapped from `${KC_DB_USER}`, `${KC_DB_PASSWORD}`, `${KC_DB_NAME}`).

**Health check:** `pg_isready -U ${KC_DB_USER} -d ${KC_DB_NAME}`. Interval 10s, timeout 5s, 5 retries.

---

## keycloak

| Field | Value |
|---|---|
| Image | `quay.io/keycloak/keycloak:26.6` |
| Host ports | — |
| Volumes | `./keycloak/realm-export.json` → `/opt/keycloak/data/import-template/realm-export.json` (template) |
| Depends on | `keycloak-db` (healthy) |

**Entrypoint processing:** Like Traefik, Keycloak uses a custom entrypoint (`/bin/sh -c`) that:
1. Creates `/opt/keycloak/data/import/`.
2. Runs `sed` to substitute `${VAR}` placeholders (domain names, SMTP settings) in the template, writing to `/opt/keycloak/data/import/realm-export.json`.
3. Execs `kc.sh start-dev --import-realm`.

**Key environment variables:**

| Variable | Purpose |
|---|---|
| `KC_DB` | `postgres` |
| `KC_DB_URL` | JDBC URL for keycloak-db |
| `KC_DB_USERNAME` / `KC_DB_PASSWORD` | Database credentials |
| `KC_HOSTNAME` | External hostname (prefixed with `https://`) |
| `KC_HOSTNAME_STRICT` | `false` (allows non-matching hostnames) |
| `KC_HTTP_ENABLED` | `true` (TLS terminated at Traefik) |
| `KC_PROXY_HEADERS` | `xforwarded` (trusts `X-Forwarded-*` headers from Traefik) |
| `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD` | Initial admin credentials |
| `GITLAB_DOMAIN`, `VAULT_DOMAIN`, `API_DOMAIN`, `OAUTH_DOMAIN`, `TRAEFIK_DOMAIN`, `KONG_DOMAIN` | Substituted into `realm-export.json` template |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL` | Substituted into `realm-export.json` template for SMTP config |

**Command:** `start-dev --import-realm` (dev mode, suitable for single-server deployment)

**Health check:** HTTP check on `:9000/health/ready`. Interval 15s, timeout 10s, 5 retries, 60s start period.

**Operational notes:**
- `realm-export.json` on disk is a **template** with `${VAR}` placeholders. The entrypoint runs `sed` to produce the actual import file inside the container.
- Realm import runs once on first start. If you modify `realm-export.json` after the realm already exists, it will not be re-imported automatically. You must either delete `.vols/keycloak-db` (destructive) or use the admin console / CLI to apply changes manually.
- The bootstrap admin account is created automatically. After initial setup, create a permanent admin user via the admin console and optionally disable the bootstrap account.
- Keycloak is not exposed directly via a host port. All access goes through Traefik → Kong → keycloak-service route → `http://keycloak:8080`.

---

## vault

| Field | Value |
|---|---|
| Image | `openbao/openbao:2` |
| Host ports | `18200→8200` |
| Volumes | `./vault/config.hcl` → `/vault/prod-config/config.hcl` (read-only, for future prod mode), `./.vols/vault` → `/vault/data` |
| Depends on | — |

**Key environment variables:**

| `.env` variable | Compose mapping | Purpose |
|---|---|---|
| `VAULT_DEV_ROOT_TOKEN_ID` | `BAO_DEV_ROOT_TOKEN_ID` | Dev-mode root token, also used by Management API for OpenBao access |
| *(hardcoded)* | `BAO_DEV_LISTEN_ADDRESS` | `0.0.0.0:8200` (required for Docker networking) |
| `VAULT_ADDR` | `VAULT_ADDR` | Internal URL `http://vault:8200` |

> **Note:** OpenBao's Docker image reads `BAO_DEV_*` env vars for dev server configuration, not `VAULT_DEV_*`. The compose file maps the `.env` names to the correct `BAO_` names internally.

**Command:** `server -dev` (development mode — auto-initialized, auto-unsealed, in-memory storage supplemented by the file volume)

**Health check:** `wget --spider http://127.0.0.1:8200/v1/sys/health`. Interval 15s, timeout 5s, 3 retries, 10s start period.

**Production config (`vault/config.hcl`):** Provided for future production migration:
- `storage "file"` at `/vault/data`
- `listener "tcp"` on `0.0.0.0:8200`, TLS disabled (TLS terminated by Traefik)
- UI enabled
- Default lease 168h, max 720h

To switch to production mode: change the docker-compose command to `server -config=/vault/prod-config/config.hcl`, remove `VAULT_DEV_*` env vars, and handle manual init/unseal.

**Operational notes:**
- In dev mode, OpenBao is automatically initialized and unsealed on every start. No manual unsealing is needed.
- The `VAULT_DEV_ROOT_TOKEN_ID` must be alphanumeric + hyphens only (OpenBao rejects dots and special characters).
- Dev mode is a deliberate v1 trade-off. Secrets persist in `.vols/vault/` across restarts, but the auto-unseal behavior is not production-grade.

---

## cloudflared

| Field | Value |
|---|---|
| Image | `cloudflare/cloudflared:latest` |
| Host ports | — |
| Volumes | — |
| Profiles | `cftunnel` (only starts with `docker compose --profile cftunnel up -d`) |
| Depends on | `traefik` (healthy) |

**Command:** `tunnel --metrics 0.0.0.0:60123 run`

**Key environment variables:**

| Variable | Purpose |
|---|---|
| `TUNNEL_TOKEN` | Authenticates the agent to Cloudflare's edge |

**Health check:** None defined in compose. The image is distroless (no shell, wget, or curl). The metrics endpoint at `:60123/ready` is available for external monitoring. Tunnel health is observable via: `docker logs cloudflared | grep "Registered"`.

**Operational notes:**
- This service is **profile-gated**. It does not start with a regular `docker compose up -d`. You must explicitly activate the profile: `docker compose --profile cftunnel up -d`.
- If `TUNNEL_TOKEN` is missing or invalid, the container enters a restart loop. Check `docker logs cloudflared` for authentication errors.
- The tunnel routing table (which hostnames go to which service) is configured in the Cloudflare dashboard under **Zero Trust → Networks → Tunnels**. Configure `*.devops.{DOMAIN}` → `https://traefik:443` with "No TLS Verify" enabled.
- The rest of the platform works without Cloudflare Tunnel — it is only needed for external (internet) access.

---

## gitlab

| Field | Value |
|---|---|
| Image | `gitlab/gitlab-ce:18.10.1-ce.0` |
| Host ports | `12222→22` (SSH git) |
| Volumes | `./.vols/gitlab/config`, `./.vols/gitlab/logs`, `./.vols/gitlab/data` |
| Depends on | — |

**Key environment variables (via `GITLAB_OMNIBUS_CONFIG`):**

| Config key | Purpose |
|---|---|
| `external_url` | Public HTTPS URL (e.g. `https://gitlab.devops.yourdomain.com`) |
| `gitlab_rails['omniauth_*']` | OmniAuth OIDC config pointing to Keycloak |
| `registry_external_url` | Container registry public URL |
| `gitlab_rails['smtp_*']` | SMTP config for email notifications |
| `gitlab_rails['gitlab_shell_ssh_port']` | Maps to host port 12222 |

**Health check:** `curl --fail http://localhost/-/health`. Interval 30s, timeout 10s, 5 retries, **300s start period**.

**Operational notes:**
- GitLab is the slowest service to start. Do not consider the stack ready until GitLab's health check passes.
- OIDC SSO via Keycloak uses the `gitlab` client configured in the `devops` realm. If Keycloak is not yet running when GitLab first starts, users can still log in with the local root account.
- The root account credentials are set via `GITLAB_ROOT_PASSWORD` (first boot only). After that, use the admin console or API.
- `GITLAB_ROOT_TOKEN` is a personal access token for the root account, created manually after first boot. It is used by the Management API.

---

## gitlab-runner

| Field | Value |
|---|---|
| Image | `gitlab/gitlab-runner:latest` |
| Host ports | — |
| Volumes | Docker socket (`/var/run/docker.sock`), `./.vols/gitlab-runner/config`, `./.vols/gitlab-runner/cache` |
| Depends on | `gitlab` (healthy) |

**Key environment variables:**

| Variable | Purpose |
|---|---|
| `GITLAB_RUNNER_TOKEN` | Runner authentication token from GitLab (starts with `glrt-`) |
| `DOCKER_NETWORK` | Network name to inject into the runner's `docker-network-mode` |

**Registration behavior:**
The entrypoint script checks if `GITLAB_RUNNER_TOKEN` equals `FILL_AFTER_STARTUP`. If so, it loops indefinitely (runner is not yet registered). Once a real token is supplied and the volume at `.vols/gitlab-runner/config/config.toml` does not exist, it runs `gitlab-runner register` with Docker executor settings and then starts the runner.

**Operational notes:**
- After first GitLab boot, retrieve the runner registration token from **GitLab → Admin → Runners** and update `GITLAB_RUNNER_TOKEN` in `.env`. Then restart the `gitlab-runner` container.
- The reference `config.toml` is at `gitlab-runner/config.toml`. It is not mounted; it documents the expected configuration generated during registration.
- `privileged: true` is required for Docker-in-Docker builds.

---

## api (Management API)

| Field | Value |
|---|---|
| Image | Built from `./api/Dockerfile` |
| Host ports | `13000→3000` |
| Volumes | — |
| Depends on | `kong` (healthy), `vault` (healthy) |

**Key environment variables:**

| Variable | Purpose |
|---|---|
| `DOMAIN` | Base domain (e.g. `yourdomain.com`) |
| `GITLAB_URL` | Internal GitLab URL (`http://gitlab`) |
| `GITLAB_ROOT_TOKEN` | GitLab API token |
| `GITLAB_TEMPLATE_GROUP_ID` | Numeric GitLab group ID for templates |
| `GITLAB_CONFIG_GROUP_ID` | Numeric GitLab group ID for shared CI configs |
| `GITLAB_DOMAIN` | External GitLab hostname |
| `KONG_ADMIN_URL` | Internal Kong Admin URL (`http://kong:8001`) |
| `VAULT_URL` | Internal Vault URL (`http://vault:8200`) |
| `VAULT_DEV_ROOT_TOKEN_ID` | Vault token |
| `OIDC_ISSUER_URL` | External Keycloak issuer URL |
| `OIDC_JWKS_URL` | Internal Keycloak JWKS endpoint |
| `OIDC_AUDIENCE` | Expected `aud` claim in JWT (e.g. `management-api`) |
| `API_KEY` | Optional static API key for `X-API-Key` auth |
| `CLOUDFLARE_API_TOKEN` | Optional; Cloudflare integration disabled if absent |
| `CLOUDFLARE_ZONE_ID` | Optional |
| `CLOUDFLARE_TUNNEL_ID` | Optional |
| `NODE_ENV` | `production` in production |
| `LOG_LEVEL` | `info` by default |

**Health check:** `node -e "require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"`. Interval 15s, timeout 5s, 3 retries, 15s start period.

**Build:** Multi-stage Dockerfile. Final image is Node 20 Alpine with a non-root `appuser`. See `api/Dockerfile`.

---

## vault-oidc-init

| Field | Value |
|---|---|
| Image | `openbao/openbao:2` |
| Host ports | — |
| Volumes | `./vault/init-oidc.sh` → `/scripts/init-oidc.sh` |
| Depends on | `vault` (healthy), `keycloak` (healthy) |

One-shot service. Runs `/init-oidc.sh`:

1. Waits until OpenBao responds to `GET /v1/sys/health`.
2. Enables the `oidc` auth method (idempotent).
3. Writes the OIDC config (discovery URL = Keycloak internal issuer).
4. Creates a `default` OIDC role with `preferred_username` as the user claim.

**Key environment variables:** `VAULT_ADDR`, `VAULT_TOKEN`, `KEYCLOAK_ISSUER_URL`, `KC_CLIENT_SECRET_VAULT`, `VAULT_EXTERNAL_URL`.

---

## oauth2-proxy

| Field | Value |
|---|---|
| Image | `quay.io/oauth2-proxy/oauth2-proxy:latest` |
| Host ports | — |
| Volumes | — |
| Depends on | `keycloak` (healthy) |

**Key environment variables:**

| Variable | Purpose |
|---|---|
| `OAUTH2_PROXY_OIDC_ISSUER_URL` | Internal Keycloak issuer (`http://keycloak:8080/realms/devops`) |
| `OAUTH2_PROXY_CLIENT_ID` | `oauth2-proxy` (Keycloak client) |
| `OAUTH2_PROXY_CLIENT_SECRET` | Client secret from Keycloak |
| `OAUTH2_PROXY_COOKIE_SECRET` | 32-byte random secret for cookie encryption |
| `OAUTH2_PROXY_COOKIE_DOMAINS` | `.devops.yourdomain.com` |
| `OAUTH2_PROXY_REDIRECT_URL` | `https://${OAUTH_DOMAIN}/oauth2/callback` |
| `OAUTH2_PROXY_WHITELIST_DOMAINS` | `.devops.yourdomain.com` |
| `OAUTH2_PROXY_EMAIL_DOMAINS` | `*` (allow all email domains) |
| `OAUTH2_PROXY_HTTP_ADDRESS` | `0.0.0.0:4180` |
| `OAUTH2_PROXY_REVERSE_PROXY` | `true` (trusts X-Forwarded headers from Traefik) |
| `OAUTH2_PROXY_SET_XAUTHREQUEST` | `true` (sets X-Auth-Request-* headers) |
| `OAUTH2_PROXY_SKIP_PROVIDER_BUTTON` | `true` (skips the "Sign in with..." button, redirects immediately) |
| `OAUTH2_PROXY_PASS_ACCESS_TOKEN` | `true` (passes the OIDC access token downstream) |

**Health check:** None defined.

**Operational notes:**
- `oauth2-proxy` is used as a ForwardAuth endpoint via Traefik's `oidc-auth@file` middleware. It is also routed through Kong at `${OAUTH_DOMAIN}` to handle the OAuth2 callback.
- The `OAUTH2_PROXY_COOKIE_SECRET` must be exactly 32 bytes. Generate with: `openssl rand -base64 32 | head -c 32`.
- `OAUTH2_PROXY_INSECURE_OIDC_SKIP_ISSUER_VERIFICATION` is set to `true` because the internal issuer URL (`http://keycloak:8080/...`) does