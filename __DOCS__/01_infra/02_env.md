# Configuring Your Environment

← [Back to Infra Guide](index.md)

All platform configuration lives in a single file called `.env`. This is the one place where you tell the platform your domain name, your credentials, and your API tokens. Every service reads from this file when it starts, so getting it right is the most important part of setup.

The repository includes a template called `sample.env`. You'll copy it, then fill in the values.

```bash
cp sample.env .env
```

Open the `.env` file in any text editor and work through each section below.

---

## Deployment

```
NODE_ENV=production
```

`NODE_ENV` is a standard Node.js convention used by the Management API and its dependencies. Use `production` for any running environment — it enables production optimizations and disables verbose debug output. Only set it to `development` if you're modifying the API itself and want detailed error traces. See the [Node.js documentation](https://nodejs.org/en/learn/getting-started/nodejs-the-difference-between-development-and-production) for the full implications.

---

## Your domain names

```
DOMAIN=yourdomain.com
APPS_DOMAIN=apps.yourdomain.com
```

Set `DOMAIN` to your base domain. Set `APPS_DOMAIN` to the domain used for applications that developers deploy through the platform.

The remaining `*_DOMAIN` variables (`TRAEFIK_DOMAIN`, `KEYCLOAK_DOMAIN`, etc.) are already pre-filled with the correct subdomains based on the platform's naming convention. You only need to change them if you want to use different subdomain names.

---

## Traefik (the HTTPS gateway)

```
TRAEFIK_ACME_EMAIL=your-email@example.com
```

`TRAEFIK_ACME_EMAIL` — Replace this with your real email address. Let's Encrypt will use it to notify you about certificate expiry or important issues. It's not displayed publicly — it's just for Let's Encrypt's records.

The Traefik dashboard is always enabled and accessible at `https://traefik.devops.yourdomain.com`, protected by the oauth2-proxy/Keycloak login. To disable it, remove or comment out the `traefik-dashboard` router labels from the `traefik` service in `docker-compose.yml`.

---

## Kong (the API gateway)

```
KONG_PG_PASSWORD=change-me-kong-db-password
KONG_LOG_LEVEL=info
```

`KONG_PG_PASSWORD` — The password for Kong's internal database. Change it to something strong. You won't need to remember this password yourself — it's only used internally between Kong and its database container.

`KONG_LOG_LEVEL` — Controls how much detail Kong writes to its logs. The valid values are defined by Kong itself:

| Value | What gets logged |
|-------|-----------------|
| `debug` | Everything, including internal routing decisions — very verbose |
| `info` | General operational events (recommended for normal use) |
| `notice` | Significant events only |
| `warn` | Warnings about unexpected-but-recoverable situations |
| `error` | Only errors |
| `crit` | Critical errors only |

For most setups, `info` is the right choice. Use `debug` temporarily if you're troubleshooting a routing or plugin issue. See the [Kong log level documentation](https://docs.konghq.com/gateway/latest/reference/configuration/#log_level) for more detail.

The remaining Kong variables (`KONG_PG_HOST`, `KONG_PG_PORT`, `KONG_PG_DATABASE`, `KONG_PG_USER`, `KONG_PROXY_LISTEN`, `KONG_ADMIN_LISTEN`) are pre-configured for the Docker network and should not be changed unless you're restructuring the network topology. If you need to change them, refer to the [Kong configuration reference](https://docs.konghq.com/gateway/latest/reference/configuration/).

---

## Keycloak (the login system)

```
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_EMAIL=admin@yourdomain.com
KEYCLOAK_ADMIN_PASSWORD=change-me-keycloak-admin-password
KC_DB_PASSWORD=change-me-keycloak-db-password
KC_HOSTNAME_STRICT=false
KC_HTTP_ENABLED=true
```

`KEYCLOAK_ADMIN` is the username you'll use to log in to the Keycloak admin panel. You can leave it as `admin` or change it.

`KEYCLOAK_ADMIN_EMAIL` is the email address for the bootstrap admin account. Set this to a valid email address (used for account recovery and notifications). This is also the email assigned to the default admin user created in the realm.

`KEYCLOAK_ADMIN_PASSWORD` is the password for that admin account. **Set this to something strong** — this account has full control over all users and login settings.

`KC_DB_PASSWORD` is the internal database password for Keycloak. Like Kong's database password, you won't type this manually — just make it random and strong.

`KC_HOSTNAME_STRICT` — When set to `true`, Keycloak only accepts requests that match its configured hostname exactly. When set to `false`, it's more permissive and allows connections from different sources (e.g., internal Docker hostnames). This platform sets it to `false` because services communicate with Keycloak internally over Docker's network, which uses different hostnames than the public URL. Changing this to `true` without additional configuration will break internal service-to-service authentication. See [Keycloak's hostname configuration docs](https://www.keycloak.org/server/hostname) for the full explanation.

`KC_HTTP_ENABLED` — Controls whether Keycloak accepts unencrypted HTTP connections on its internal port. This platform sets it to `true` because TLS termination happens at Traefik, not inside Keycloak itself. Services within the Docker network communicate with Keycloak over HTTP. Setting this to `false` would require configuring TLS certificates inside Keycloak, which is outside the scope of v1. See [Keycloak's TLS documentation](https://www.keycloak.org/server/enabletls) if you want to harden this.

The `KC_HOSTNAME` variable is pre-filled to match your `KEYCLOAK_DOMAIN`. Leave it as-is.

---

## OpenBao (secrets storage)

```
VAULT_DEV_ROOT_TOKEN_ID=change-me-vault-dev-token
```

`VAULT_DEV_ROOT_TOKEN_ID` — This is the token you'll use to log in to OpenBao and the token the Management API uses for OpenBao access. Think of it like a master password for the secrets store. Set it to something you'll remember (or store in a password manager), but keep it **alphanumeric and hyphens only** — OpenBao rejects tokens that contain dots or other special characters.

In v1, OpenBao runs in "dev mode," which means it auto-unseals on startup using this token. This is convenient but not suitable for production use with real sensitive data. See [the OpenBao admin page](../02_admin/04_vault.md) for what that means.

---

## Cloudflare tokens

```
CLOUDFLARE_API_TOKEN=change-me-cloudflare-api-token
CLOUDFLARE_TUNNEL_TOKEN=change-me-cloudflare-tunnel-token
CLOUDFLARE_ZONE_ID=
CLOUDFLARE_TUNNEL_ID=
```

**`CLOUDFLARE_API_TOKEN`** — This is the API token you created in the [prerequisites step](01_prereqs.md#a-cloudflare-api-token). Paste it here. It is used by Traefik for ACME DNS-01 challenges and by the Management API for DNS automation.

**`CLOUDFLARE_TUNNEL_TOKEN`** — The tunnel token from your Cloudflare Tunnel setup. If you're not using a tunnel (direct public IP access only), you can leave this blank. The `cloudflared` service is profile-gated and only starts when you use `docker compose --profile cftunnel up -d`.

**`CLOUDFLARE_ZONE_ID`**, **`CLOUDFLARE_TUNNEL_ID`** — These are optional. They're only needed if you want the Management API to automatically create DNS records when provisioning new projects. You can find these IDs in the Cloudflare dashboard:
- **Zone ID**: shown in the right sidebar of your domain's overview page
- **Tunnel ID**: the UUID shown in Zero Trust → Networks → Tunnels next to your tunnel name

---

## GitLab (source control + CI/CD)

```
GITLAB_EXTERNAL_URL=https://gitlab.devops.yourdomain.com
GITLAB_REGISTRY_EXTERNAL_URL=https://registry.devops.yourdomain.com
GITLAB_ROOT_PASSWORD=change-me-gitlab-root-password
```

These are pre-filled correctly if you've set your `DOMAIN` and `*_DOMAIN` values. `GITLAB_ROOT_PASSWORD` is the password for GitLab's built-in `root` admin account. Set it to something strong and save it.

---

## GitLab Runner token

```
GITLAB_RUNNER_TOKEN=FILL_AFTER_STARTUP
```

This one is different — you can't fill it in before the platform starts, because the token is generated by GitLab after it boots. Here's the process:

1. Start the platform without the runner first (see [Bootstrap](03_bootstrap.md))
2. Log in to GitLab as root
3. Go to **Admin Area → CI/CD → Runners → New instance runner**
4. Create a runner, copy the authentication token (it looks like `glrt-xxxxxxxxxxxx`)
5. Paste it into `.env` as `GITLAB_RUNNER_TOKEN`
6. Run `docker compose up -d gitlab-runner` to start the runner with the token applied

Do **not** use `docker compose restart gitlab-runner` — that doesn't re-read environment variables. Use `up -d` to recreate the container.

---

## Management API

```
API_KEY=change-me-management-api-key
API_PORT=3000
API_HOST=0.0.0.0
GITLAB_ROOT_TOKEN=change-me-gitlab-root-pat
GITLAB_TEMPLATE_GROUP_ID=1
GITLAB_CONFIG_GROUP_ID=2
CORS_ORIGIN=*
CORS_CREDENTIALS=false
```

**`API_KEY`** — A secret key that protects the Management API. Any request to the API must include this key in the `X-API-Key` header. Set it to something random and keep it secure. If you leave it empty, the API runs with no authentication (only do this in development).

**`API_PORT`** — The port the Management API listens on inside Docker. The default is `3000`. There's no reason to change this unless it conflicts with something else on your system.

**`API_HOST`** — The network interface the API binds to. `0.0.0.0` means it listens on all interfaces (required for Docker networking). Leave this as-is.

**`GITLAB_ROOT_TOKEN`** — A Personal Access Token (PAT) from GitLab that the Management API uses to create groups, fork repositories, and manage projects. To create one:
1. Start GitLab and log in as root
2. Go to your profile icon → **Edit profile → Access Tokens**
3. Create a new token with the **api** scope
4. Copy the token (it starts with `glpat-`) and paste it here

**`GITLAB_TEMPLATE_GROUP_ID`** and **`GITLAB_CONFIG_GROUP_ID`** — Numeric IDs of two GitLab groups that you create after first boot. The "templates" group holds project scaffolding repos, and the "configs" group holds shared CI/CD configuration. The Management API needs these IDs to know where to look. After creating each group in GitLab, find its ID in the group's settings page (it appears near the group name at the top).

**`CORS_ORIGIN`** — Controls which web origins are allowed to make requests to the Management API from a browser. The platform defines two meaningful configurations:

| Value | What it means |
|-------|---------------|
| `*` | Any origin is allowed. Fine for internal use where the API is not publicly reachable. |
| `https://your-frontend.com` | Only requests from this specific origin are allowed. Use this if you build a web frontend that calls the API, and you want to restrict access to that frontend only. |

**`CORS_CREDENTIALS`** — Controls whether cross-origin requests can include cookies or authorization headers. Valid values are `true` and `false`. This is a standard browser security mechanism — see [MDN's CORS documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) for the full explanation. For most API-key-based usage, `false` is correct. Set to `true` only if you're building a browser-based frontend that needs to send session cookies.

---

## OIDC client secrets

```
KC_CLIENT_SECRET_GITLAB=CHANGE-ME-GITLAB-CLIENT-SECRET
KC_CLIENT_SECRET_VAULT=CHANGE-ME-VAULT-CLIENT-SECRET
KC_CLIENT_SECRET_OAUTH2_PROXY=CHANGE-ME-OAUTH2-PROXY-CLIENT-SECRET
```

These are shared secrets between each service and Keycloak. They're used during the login handshake to verify that a service is who it claims to be. The values you put here must match the values inside `keycloak/realm-export.json`.

The defaults in `sample.env` and `realm-export.json` are intentionally placeholder strings — change all three of them to unique random strings (e.g., run `openssl rand -hex 32` three times and use those). Make sure the values are identical in both `.env` and `realm-export.json`.

---

## oauth2-proxy cookie secret

```
OAUTH2_PROXY_COOKIE_SECRET=change-me-32-byte-cookie-secret!
```

This is used to sign browser cookies for services that use oauth2-proxy for authentication (the Traefik dashboard and Kong admin panel). It must be exactly 32 bytes. Generate a safe value with:

```bash
openssl rand -base64 32 | head -c 32
```

---

## SMTP (outbound email)

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASSWORD=change-me-smtp-password
SMTP_FROM_NAME=DevOps Platform
SMTP_FROM_EMAIL=devops@yourdomain.com
SMTP_DOMAIN=yourdomain.com
```

These values come from your email provider. They're shared between GitLab and Keycloak, so you only need to set them once here.

`SMTP_HOST` and `SMTP_USER` / `SMTP_PASSWORD` are given by your provider (e.g., `smtp.gmail.com` with an App Password for Gmail, `smtp.sendgrid.net` with `apikey` as the username for SendGrid).

`SMTP_PORT` determines the connection method. The valid values are determined by what your email provider supports:

| Value | Protocol | When to use |
|-------|----------|-------------|
| `587` | STARTTLS | The modern standard. Starts as plain text then upgrades to encrypted. **Use this unless your provider says otherwise.** |
| `465` | SSL/TLS | Older standard where the connection is encrypted from the start. Some providers still use this. |
| `25` | Unencrypted | Used for server-to-server mail relay. Almost never appropriate for authenticated SMTP sending — most providers block it. |

`SMTP_FROM_NAME` — The display name that appears in the "From" field of emails sent by the platform (e.g., "DevOps Platform" or your company name).

`SMTP_FROM_EMAIL` — The email address in the "From" field. Should be a real, deliverable address on your domain — using a domain-verified address helps prevent emails from landing in spam.

`SMTP_DOMAIN` — Your mail domain. Usually just the part after `@` in your from email (e.g., `yourdomain.com`). Some SMTP providers use this in the EHLO handshake to identify the sending server.

If you're not ready to configure SMTP yet, you can leave these as-is and configure them later. GitLab and Keycloak will still start up normally — they'll just fail silently if they try to send an email.

---

## Logging

```
LOG_LEVEL=info
```

Controls the verbosity of logs from the Management API. The platform defines five levels:

| Value | What gets logged |
|-------|-----------------|
| `error` | Only errors — the minimum useful output |
| `warn` | Errors plus unexpected-but-non-fatal situations |
| `info` | Surface-level operational events: requests received, provisioning started/finished, etc. **Recommended for production.** |
| `verbose` | Detailed step-by-step process logging including intermediate values |
| `debug` | Everything, including request and response payloads — very verbose, useful for troubleshooting |

Use `info` for normal operation. Switch to `debug` temporarily when troubleshooting a specific issue, then switch back — debug output can be large and may include sensitive values in responses.

---

Once you've filled in all the values, save the file and move on to [starting the platform](03_bootstrap.md).
