# Services Reference

← [Back to Maintainer Guide](index.md)

Each service in the Docker Compose stack is documented here with its image, host-exposed ports, volumes, critical environment variables, health check logic, and known operational notes.

All services share the `devops-network` Docker bridge network. The network name is driven by `${DOCKER_NETWORK}` (default: `devops-network`).

---

## Startup order summary

| Boot phase | Services |
|---|---|
| Phase 1 — immediate | `traefik`, `mongo`, `postgres` |
| Phase 2 — after postgres healthy | `postgres-keycloak-init`, `postgres-sonar-init`, `postgres-vault-init`, `postgres-gitlab-init`, `postgres-registry-init`, `vault`, `keycloak`, `sonarqube-config-init`, `sonarqube` (first boot may take several minutes), then `sonarqube-init` (must exit 0) |
| Phase 3 — after keycloak healthy | `oauth2-proxy` |
| Phase 4 — after vault started | `vault-prod-bootstrap` (init, unseal, KV), then `vault-oidc-init` (after vault healthy + keycloak healthy) |
| Phase 5 — after mongo + vault bootstrap + OIDC init | `api` |
| Phase 5b — after api healthy | `console` |
| Phase 6 — long-running stack | `gitlab`, `minio`, `minio-init` (see `depends_on` in `docker-compose.yml`) |
| Phase 7 — after gitlab healthy | `gitlab-runner` |
| Profile-gated (manual) | `cloudflared` (`--profile cftunnel`), `wireguard` (`--profile vpnedge`) |

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

## mongo

| Field | Value |
|---|---|
| Image | `mongo:7` |
| Host ports | — |
| Volumes | `./.vols/mongo` → `/data/db` |
| Depends on | — |

**Health check:** `mongosh` admin ping. Interval 15s, timeout 5s, 3 retries, 20s start period.

**Operational notes:** Primary data store for the Management API (projects, audit log, catalog metadata).

---

## postgres

| Field | Value |
|---|---|
| Image | `postgres:17-alpine` |
| Service / container name | `postgres` |
| Host ports | `15433→5432` |
| Volumes | `./.vols/keycloak-db` → `/var/lib/postgresql/data` (path unchanged for upgrades) |
| Depends on | — |

Shared PostgreSQL for **Keycloak** (`KC_DB_*`), **SonarQube** (`SONAR_DB_*`), **GitLab Rails** (`GITLAB_DB_*`), and **container registry metadata** (`REGISTRY_DB_*`). On first boot (empty data directory), the image bootstraps operator superuser `${POSTGRES_ADMIN_USER}` / database `postgres`; `postgres/init/01-keycloak-database.sh` through `04-registry-database.sh` create app roles and databases. Application services use app credentials only (not the admin user).

**DNS:** Hostname `postgres`. Legacy alias `keycloak-db` still resolves on `devops-network` if `.env` still has `KC_DB_HOST=keycloak-db`; prefer `KC_DB_HOST=postgres` in new installs (`sample.env`).

**Renaming without data loss:** Safe when the bind-mount path stays `.vols/keycloak-db`. Stop the stack, then `docker compose up -d` — data lives on the host volume, not the container name. Do not delete `.vols/keycloak-db` unless you intend a full DB reset.

**App databases on compose up:** `postgres-keycloak-init`, `postgres-sonar-init`, `postgres-gitlab-init`, and `postgres-registry-init` create roles, databases, and (for GitLab) required extensions idempotently as `${POSTGRES_ADMIN_USER}`. Fresh installs also run `postgres/init/01-keycloak-database.sh` through `04-registry-database.sh` when the data directory is empty.

**Key environment variables:** `POSTGRES_ADMIN_USER`, `POSTGRES_ADMIN_PASSWORD` (cluster bootstrap + host `psql`); `KC_DB_*`, `SONAR_DB_*`, `GITLAB_DB_*`, `REGISTRY_DB_*` (application users).

**Backup / DR:** `make backup` archives `.vols/` and, when GitLab/registry DBs exist on this instance, writes `backups/gitlabhq_production-*.dump` and `backups/registry-*.dump`. `gitlab-backup` does **not** include the registry metadata database — keep logical dumps with MinIO registry blobs.

**Health check:** `pg_isready -U ${POSTGRES_ADMIN_USER} -d postgres`. Interval 10s, timeout 5s, 5 retries.

---

## keycloak

| Field | Value |
|---|---|
| Image | `quay.io/keycloak/keycloak:26.6` |
| Host ports | — |
| Volumes | `./keycloak/realm-export.json` → `/opt/keycloak/data/import-template/realm-export.json` (template) |
| Depends on | `postgres` (healthy) |

**Entrypoint processing:** Like Traefik, Keycloak uses a custom entrypoint (`/bin/sh -c`) that:
1. Creates `/opt/keycloak/data/import/`.
2. Runs `sed` to substitute `${VAR}` placeholders (domain names, SMTP settings) in the template, writing to `/opt/keycloak/data/import/realm-export.json`.
3. Execs `kc.sh start-dev --import-realm`.

**Key environment variables:**

| Variable | Purpose |
|---|---|
| `KC_DB` | `postgres` |
| `KC_DB_URL` | JDBC URL for `postgres` service |
| `KC_DB_USERNAME` / `KC_DB_PASSWORD` | Database credentials |
| `KC_HOSTNAME` | External hostname (prefixed with `https://`) |
| `KC_HOSTNAME_STRICT` | `false` (allows non-matching hostnames) |
| `KC_HTTP_ENABLED` | `true` (TLS terminated at Traefik) |
| `KC_PROXY_HEADERS` | `xforwarded` (trusts `X-Forwarded-*` headers from Traefik) |
| `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD` | Initial admin credentials |
| `GITLAB_DOMAIN`, `VAULT_DOMAIN`, `API_DOMAIN`, `OAUTH_DOMAIN`, `TRAEFIK_DOMAIN` | Substituted into `realm-export.json` template |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL` | Substituted into `realm-export.json` template for SMTP config |

**Command:** `start-dev --import-realm` (dev mode, suitable for single-server deployment)

**Health check:** HTTP check on `:9000/health/ready`. Interval 15s, timeout 10s, 5 retries, 60s start period.

**Operational notes:**
- `realm-export.json` on disk is a **template** with `${VAR}` placeholders. The entrypoint runs `sed` to produce the actual import file inside the container.
- Realm import runs once on first start. If you modify `realm-export.json` after the realm already exists, it will not be re-imported automatically. You must either delete `.vols/keycloak-db` (destructive) or use the admin console / CLI to apply changes manually.
- The bootstrap admin account is created automatically. After initial setup, create a permanent admin user via the admin console and optionally disable the bootstrap account.
- Keycloak is not exposed directly via a host port. Browser traffic uses the public `Host` header on **Traefik** (`https://${KEYCLOAK_DOMAIN}`), which reverse-proxies to `http://keycloak:8080`.

---

## vault

| Field | Value |
|---|---|
| Image | `openbao/openbao:2` |
| Host ports | `18200→8200` |
| Volumes | `./vault/config.hcl` → `/vault/prod-config/config.hcl` (read-only) |
| Depends on | `postgres` (healthy), `postgres-vault-init` (completed) |

**Key environment variables:**

| `.env` variable | Compose mapping | Purpose |
|---|---|---|
| `VAULT_DB_*` | `BAO_PG_CONNECTION_URL` | PostgreSQL storage on shared `postgres` |
| `VAULT_ROOT_TOKEN` | API + bootstrap scripts | Root token from `operator init` (see `vault-prod-bootstrap`) |
| `VAULT_ADDR` | `VAULT_ADDR` | Internal URL `http://vault:8200` |

**Command:** `server -config=/vault/prod-config/config.hcl` (production mode, PostgreSQL storage, Shamir seal).

**Health check:** `GET /v1/sys/seal-status` until `"sealed":false`. Vault stays unhealthy while sealed until `vault-prod-bootstrap` runs.

**Storage:** `storage "postgresql"` in [`vault/config.hcl`](../../vault/config.hcl); connection via `BAO_PG_CONNECTION_URL`. Cluster state and secrets survive container restarts.

**Bootstrap secrets (gitignored under `.vols/vault/`):** `init.txt`, `unseal-keys`, `root-token` — written by `vault-prod-bootstrap` on first init. Copy `root-token` into `.env` as `VAULT_ROOT_TOKEN`.

**After PC reboot:** run `make vault-bootstrap` or `docker compose run --rm vault-prod-bootstrap` (reads `unseal-keys`; no manual UI unseal if keys file is present).

**Migration from dev mode:** see [Secrets — production mode](07_secrets.md#production-mode-postgresql--scripted-unseal).

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

## wireguard

| Field | Value |
|---|---|
| Image | `lscr.io/linuxserver/wireguard:latest` |
| Profile | `vpnedge` (only starts with `docker compose --profile vpnedge up -d`) |
| Host ports | `${WIREGUARD_SERVER_PORT:-51820}→51820/udp` |
| Volumes | `./.vols/wireguard` → `/config` (server config + generated `peer_edge` client files) |
| Capabilities | `NET_ADMIN`, `SYS_MODULE` |
| Sysctls | `net.ipv4.conf.all.src_valid_mark=1` |
| Depends on | — |

**Purpose:** WireGuard **server** at home. The cloud **edge** VM runs a **client** using `peer_edge/peer_edge.conf` from this volume, then applies **`edge/vpn-edge/apply-nat.sh`** to forward public TCP to **`HOME_TRAFFIC_IP`** (the Docker host’s LAN address). See [05_networking.md — VPN edge ingress](05_networking.md#vpn-edge-ingress-wireguard).

**Key environment variables:** `WIREGUARD_SERVER_URL`, `WIREGUARD_SERVER_PORT`, `WIREGUARD_INTERNAL_SUBNET`, `WIREGUARD_PEER_ALLOWEDIPS`, `WIREGUARD_PERSISTENTKEEPALIVE_PEERS`, `WIREGUARD_LOG_CONFS` (see [02_env.md](../01_infra/02_env.md#wireguard-vpn-edge-ingress)).

**Health check:** None. Use `docker logs wireguard` and `docker exec wireguard wg show`.

**The auto-generated `wg0.conf`** (under `.vols/wireguard/wg_confs/wg0.conf`) includes the canonical LinuxServer `PostUp` rule that masquerades decrypted tunnel traffic onto the Docker bridge so return packets find their way back to the container:
```
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth+ -j MASQUERADE
```
No additional iptables configuration is needed inside the container.

**Operational notes:**
- This service is **profile-gated** — use `docker compose --profile vpnedge up -d`.
- **Docker Desktop / WSL2:** `HOME_TRAFFIC_IP` in `forward-ports.env` on the edge VM must be the **WSL2 instance's IPv4** (where Docker actually listens), not the Windows LAN address. Check with `ip -4 route get 1.1.1.1` inside WSL2. If inbound UDP to the container fails at the WSL2 layer, run WireGuard natively in WSL2 with the same keys; see [05_networking.md](05_networking.md).
- Verify a healthy deployment: `docker exec wireguard wg show` (recent handshake, transfer counting) and `docker exec wireguard iptables -t nat -L POSTROUTING -nv` (MASQUERADE rule with non-zero packet count).

---

## gitlab

| Field | Value |
|---|---|
| Image | `gitlab/gitlab-ce:18.10.1-ce.0` |
| Host ports | `12222→22` (SSH git) |
| Volumes | `./.vols/gitlab/config`, `./.vols/gitlab/logs`, `./.vols/gitlab/data` |
| Depends on | `postgres` (healthy), `postgres-gitlab-init`, `postgres-registry-init`, `minio` (healthy) |

**Databases:** Rails uses shared `postgres` (`GITLAB_DB_*`, default database `gitlabhq_production`). Container registry metadata uses a separate database (`REGISTRY_DB_*`, default `registry`) on the same host. Embedded Omnibus PostgreSQL is disabled (`postgresql['enable'] = false`). Fresh installs: empty DBs are created by `postgres-gitlab-init` / `postgres-registry-init` on first `compose up`. Upgrading from embedded PostgreSQL requires a planned cutover (logical dump/restore of `gitlabhq_production`, then registry metadata import per [GitLab docs](https://docs.gitlab.com/administration/packages/container_registry_metadata_database/)) before relying on this layout.

**Key environment variables (via `GITLAB_OMNIBUS_CONFIG` and `.env`):**

| Config key | Purpose |
|---|---|
| `external_url` | Public HTTPS URL (e.g. `https://gitlab.devops.yourdomain.com`) |
| `gitlab_rails['db_*']` | External Rails PostgreSQL on service `postgres` |
| `registry['database']` | External registry metadata PostgreSQL; `REGISTRY_DB_ENABLED=true` only after metadata import |
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
- Keep `REGISTRY_DB_ENABLED=false` until registry metadata import to the shared `registry` database completes; then set `true` and recreate GitLab.

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
| Depends on | `mongo` (healthy), `vault` (healthy) |

**Key environment variables:**

| Variable | Purpose |
|---|---|
| `DOMAIN` | Base domain (e.g. `yourdomain.com`) |
| `GITLAB_URL` | Internal GitLab URL (`http://gitlab`) |
| `GITLAB_ROOT_TOKEN` | GitLab API token |
| `GITLAB_TEMPLATE_GROUP_ID` | Numeric GitLab group ID for templates |
| `GITLAB_CONFIG_GROUP_ID` | Numeric GitLab group ID for shared CI configs |
| `GITLAB_DOMAIN` | External GitLab hostname |
| `MONGO_URL` | MongoDB connection string |
| `MONGO_DB_NAME` | MongoDB database name |
| `KUBECONFIG_DIR` | Host path mounted for per-env kubeconfigs |
| `VAULT_URL` | Internal Vault URL (`http://vault:8200`) |
| `VAULT_ROOT_TOKEN` | Vault root token (Management API) |
| `OIDC_ISSUER_URL` | External Keycloak issuer URL |
| `OIDC_JWKS_URL` | Internal Keycloak JWKS endpoint |
| `OIDC_AUDIENCE` | Expected `aud` claim in JWT (e.g. `management-api`) |
| `API_KEY` | Optional static API key for `X-API-Key` auth |
| `NODE_ENV` | `production` in production |
| `LOG_LEVEL` | `info` by default |

**Health check:** `node -e "require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"`. Interval 15s, timeout 5s, 3 retries, 15s start period.

**Build:** Multi-stage Dockerfile. Final image is Node 20 Alpine with a non-root `appuser`. See `api/Dockerfile`.

---

## console (Operator UI)

| Field | Value |
|---|---|
| Image | Built from `./console/Dockerfile` |
| Host ports | `13001→3001` |
| Volumes | — |
| Depends on | `api` (healthy) |

**Public URL:** `https://${CONSOLE_DOMAIN}` (e.g. `console.devops.yourdomain.com`).

**Auth:** Traefik `oidc-auth@file` → oauth2-proxy → Keycloak; `OAUTH2_PROXY_ALLOWED_GROUPS` (default `admins`). The browser never receives `API_KEY`.

**Key environment variables:**

| Variable | Purpose |
|---|---|
| `CONSOLE_DOMAIN` | Traefik router hostname |
| `CONSOLE_PORT` | Listen port inside container (default `3001`) |
| `CONSOLE_HOST` | Bind address (default `0.0.0.0`) |
| `MANAGEMENT_API_GRAPHQL_URL` | Internal GraphQL URL (`http://api:3000/graphql` in compose) |
| `API_KEY` | Server-side only; forwarded as `X-API-Key` to the Management API |
| `NODE_ENV` | `production` in production |

**Health check:** `wget -qO- http://127.0.0.1:3001/api/health`. Interval 15s, timeout 5s, 3 retries, 20s start period.

**Build:** Next.js standalone output. See `console/Dockerfile`.

---

## postgres-vault-init

| Field | Value |
|---|---|
| Image | `postgres:17-alpine` |
| Host ports | — |
| Volumes | `./postgres/init-ensure-vault-db.sh` |
| Depends on | `postgres` (healthy) |

One-shot. Creates `${VAULT_DB_USER}` / `${VAULT_DB_NAME}` on shared PostgreSQL (idempotent). First empty cluster also runs `postgres/init/05-vault-database.sh`.

---

## vault-prod-bootstrap

| Field | Value |
|---|---|
| Image | `openbao/openbao:2` |
| Host ports | — |
| Volumes | `./vault/init-prod-bootstrap.sh`, `./.vols/vault` → `/work` |
| Depends on | `vault` (started), `postgres-vault-init` (completed) |

One-shot. Runs [`vault/init-prod-bootstrap.sh`](../../vault/init-prod-bootstrap.sh): `operator init` (first boot), unseal from `/work/unseal-keys`, enable KV v2 at `secret/`. Invoked by `make bootstrap`, `make vault-bootstrap`, or `docker compose run --rm vault-prod-bootstrap`.

---

## vault-oidc-init

| Field | Value |
|---|---|
| Image | `openbao/openbao:2` |
| Host ports | — |
| Volumes | `./vault/init-oidc.sh`, `./.vols/vault` → `/work` (read-only, for `root-token`) |
| Depends on | `vault-prod-bootstrap` (completed), `vault` (healthy), `keycloak` (healthy) |

One-shot service. Runs `/init-oidc.sh`:

1. Waits until OpenBao responds to `GET /v1/sys/health`.
2. Enables the `oidc` auth method (idempotent).
3. Writes the OIDC config (discovery URL = Keycloak internal issuer).
4. Creates an `admin` policy with full access.
5. Creates a `default` OIDC role with `preferred_username` as the user claim and `groups` as the groups claim.
6. Creates an external group named `admins`.
7. Maps Keycloak's `admins` group to the external group, assigning the `admin` policy.

Users authenticating via OIDC who belong to the Keycloak `admins` group automatically receive full admin access to OpenBao.

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
| `OAUTH2_PROXY_ALLOWED_GROUPS` | Comma-separated Keycloak group names (JWT `groups` claim; **plural** — required by oauth2-proxy); default `admins` in Compose if unset |

**Health check:** None defined.

**Operational notes:**
- `oauth2-proxy` is used as a ForwardAuth endpoint via Traefik's `oidc-auth@file` middleware (`traefik/dynamic/forward-auth.yml`). Browser callbacks use `https://${OAUTH_DOMAIN}` (routed like other devops hostnames on Traefik).
- Tiered OIDC by extending oauth2-proxy / Traefik / Keycloak (extra instances and callbacks): [Adding tiered OIDC with oauth2-proxy](../02_admin/08_oauth2_proxy_tiers_and_forwardauth.md) in the admin guide.
- The `OAUTH2_PROXY_COOKIE_SECRET` must be exactly 32 bytes. Generate with: `openssl rand -base64 32 | head -c 32`.
- `OAUTH2_PROXY_INSECURE_OIDC_SKIP_ISSUER_VERIFICATION` is set to `true` because the internal issuer URL (`http://keycloak:8080/...`) does not match the public issuer URL used in browser-facing discovery in every deployment path.

---

## sonarqube

| Field | Value |
|---|---|
| Image | `sonarqube:community` |
| Host ports | — (Traefik `https://${SONARQUBE_DOMAIN}`) |
| Volumes | `./.vols/sonarqube/data`, `extensions`, `logs`, `conf/sonar.properties` (generated) |
| Depends on | `postgres` (healthy), `postgres-sonar-init`, `sonarqube-config-init` (completed) |

**Key environment variables:**

| Variable | Purpose |
|---|---|
| `SONARQUBE_DOMAIN` | Public hostname (Traefik router + Keycloak SAML client) |
| `SONARQUBE_EXTERNAL_URL` | Public base URL for links and `sonar.core.serverBaseURL` |
| `SONARQUBE_INTERNAL_URL` | In-network scanner URL (`http://sonarqube:9000`) for GitLab Runner jobs |
| `SONAR_DB_*` | Sonar role/database on shared `postgres` (not Keycloak credentials) |

**Health check:** `GET /api/system/status` until `status` is `UP` (long `start_period` on first boot).

**Host prerequisite (Linux):** `sysctl -w vm.max_map_count=262144` (persist in `/etc/sysctl.conf` on production hosts). WSL2: set in `.wslconfig` or skip Sonar on Windows-only dev if the limit cannot be raised.

**SSO (SAML + Keycloak):** Keycloak side from `realm-export.json` on first import (see [SonarQube SSO](../02_admin/09_sonarqube_sso.md)). Sonar side: `sonarqube-config-init` + `sonarqube-init`.

| Service | Role |
|---|---|
| `sonarqube-config-init` | Writes SAML settings to `.vols/sonarqube/conf/sonar.properties` from Keycloak IdP metadata |
| `sonarqube-init` | Sonar built-in `sonar-users` permissions + `admins` global admin; removes legacy custom groups |

**Traefik:** TLS termination only (no ForwardAuth on Sonar — authentication is SAML inside SonarQube).

**Backup / DR:** Back up the shared PostgreSQL volume (`.vols/keycloak-db`) **and** `.vols/sonarqube/data` (search index). Restore both together on the same Sonar version.

**CI integration:** Shared pipeline job `sonar:scan` in `configs/auto-devops-pipeline`. Runners use `SONAR_HOST_URL_INTERNAL`; humans use `SONARQUBE_EXTERNAL_URL`. See [CI/CD internals](06_ci_cd.md#sonarqube) and [Manual onboarding Sonar](../03_devs/06_manual_onboarding.md#sonarqube-opt-in).

### sonarqube-mcp (optional profile `sonarmcp`)

| Field | Value |
|---|---|
| Image | `mcp/sonarqube:latest` |
| Host ports | `${SONARQUBE_MCP_PORT:-19080}` → container `8080` (HTTP, bind `0.0.0.0`) |
| Ingress | None (LAN only; not on Traefik) |
| Depends on | `sonarqube` (healthy) |

Start: `docker compose --profile sonarmcp up -d sonarqube-mcp`. MCP endpoint: `http://<host-lan-ip>:19080/mcp`. Each IDE client must send `Authorization: Bearer <SonarQube user token>` (create token in Sonar UI). Cursor example:

```json
{
  "mcpServers": {
    "sonarqube-shared": {
      "url": "http://192.168.x.x:19080/mcp",
      "headers": {
        "Authorization": "Bearer <your-sonar-user-token>"
      }
    }
  }
}
```

Uses `SONARQUBE_INTERNAL_URL` (`http://sonarqube:9000`) from inside the stack. Restrict LAN access with host firewall rules if needed.

**GitLab commit status:** After analysis, CI posts `sonarqube/quality-gate` via `POST /projects/:id/statuses/:sha` with `JOB-TOKEN` (same contract as `GitLabService.postCommitStatus` in the Management API).

**Management API:** `mutation updateProjectSonarConfig` stores `allowedBranches` + `gatePolicy`, writes token to `secret/data/projects/.../sonar`, mirrors GitLab CI variables. Default gate policy: dev **optional**, stg/prod **required**, other **optional**.

**Greenfield replication checklist:**

1. Copy `sample.env` → `.env`; set `SONARQUBE_DOMAIN`, `SONARQUBE_EXTERNAL_URL` (`https://` + same host), `SONAR_DB_*`, `SONAR_ADMIN_PASSWORD`, and `SONARQUBE_DOMAIN` before **first** Keycloak start (realm SAML client).
2. Linux host: `sysctl -w vm.max_map_count=262144`.
3. `docker compose up -d` (full stack) or at minimum: `postgres` → `keycloak` → `sonarqube-config-init` → `sonarqube` → `sonarqube-init`.
4. Confirm `docker compose ps -a` shows `sonarqube-config-init` and `sonarqube-init` **Exited (0)**.
5. Run `make verify-sonar` or `sh scripts/verify-sonar-setup.sh` from the repo root (`make bootstrap` runs this automatically).
6. DNS / tunnel: point `SONARQUBE_DOMAIN` at Traefik; sign in via SAML (no oauth2-proxy on Sonar). For **existing** Keycloak installs, align the live `sonarqube` client with Sonar settings — see [SonarQube SSO](../02_admin/09_sonarqube_sso.md).

**Optional maintainer reset (not part of normal install):** `make reset-sonarqube` wipes only Sonar DB/data and re-runs init; does not touch GitLab or Keycloak.

**vs GitLab security templates:** GitLab SAST / Secret Detection / Container Scanning remain in the `test` stage for vulnerability report triage. Sonar adds maintainability, coverage, and quality gates — complementary, not a replacement.
