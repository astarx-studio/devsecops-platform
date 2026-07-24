# Env & lifecycle cheat sheet (platform)

Quick reference for **platform operators** — where config lives and how to change it without hunting across repos.

For **CFA app-specific** profiles (backends, frontends, infra Hasura/Keycloak), see the canonical copy in the CFA docs vault: [env-and-lifecycle-cheatsheet.md](https://gitlab.devops.yadatechnology.com/external/kai/core-finance-apps/infra/-/blob/main/docs/onboarding/env-and-lifecycle-cheatsheet.md) (path: `docs/onboarding/env-and-lifecycle-cheatsheet.md` in the infra/docs clone).

---

## Three config planes

| Plane                                                  | Entrypoint                              | Console? |
| ------------------------------------------------------ | --------------------------------------- | -------- |
| **Platform stack** (`docker-compose.yml`)              | Repo `sample.env` → `.env`              | No       |
| **devtools** (shared Postgres)                         | `devtools/sample.env` → `devtools/.env` | No       |
| **Deployable GitLab projects** (CFA apps, infra, etc.) | Console → **Env profiles (Vault)**      | **Yes**  |

Console: `https://console.devops.<DOMAIN>` → project → **Env profiles (Vault)**.

Mechanism: [Manual onboarding — branch-scoped env profiles](06_manual_onboarding.md#branch-scoped-env-profiles-management-api).

---

## Platform `.env` (main stack)

Copy `sample.env` → `.env` at repo root. Never commit `.env`.

Typical changes: `DOMAIN`, Keycloak admin, GitLab root password, oauth2-proxy groups, port overrides. Restart affected services: `docker compose up -d <service>`.

Full variable list: [Environment variables](../01_infra/02_env.md).

---

## devtools `.env`

Independent compose project — not started by `make bootstrap`.

```bash
cp devtools/sample.env devtools/.env
docker compose -p devtools -f devtools/docker-compose.yml up -d
./devtools/apply-k8s-bridge.sh   # once, after k3d is up
```

| Variable                                    | Purpose                                    |
| ------------------------------------------- | ------------------------------------------ |
| `DEVTOOLS_PG_USER` / `DEVTOOLS_PG_PASSWORD` | Postgres bootstrap superuser               |
| `DEVTOOLS_PG_DB`                            | Maintenance DB name                        |
| `DEVTOOLS_PG_STATIC_IP`                     | k8s bridge target (default `172.19.0.100`) |

Laptop / LAN: `psql -h <platform-host> -p 25432 -d cfa_dev`.

External (vpnedge LB): `psql -h 34.101.130.148 -p 25432 -U <user> -d cfa_dev`. Full developer guide: [Shared devtools Postgres](10_shared_devtools_postgres.md). Maintainer stack notes: [devtools stack](../99_maintainers/02_services.md#devtools-stack-shared-postgres).

**Password rotation:** use `ALTER USER` inside the running container — editing `.env` alone does not change an existing Postgres password. After rotation, update CFA console RUNTIME profiles that embed the password and redeploy affected k8s releases.

---

## Console env profiles (deployable projects)

| Phase       | When         | Example                                     |
| ----------- | ------------ | ------------------------------------------- |
| **RUNTIME** | Running pod  | DB URLs, API keys, `OIDC_*`                 |
| **BUILD**   | Kaniko build | `.env.production`, `application.properties` |

Vault path: `secret/data/<VAULT_PROJECT_PATH>/<targetKey>` for RUNTIME; branch-scoped index for BUILD.

Pods pick up RUNTIME changes via External Secrets Operator + Reloader (~5m or redeploy). BUILD changes require a **new image build**.

---

## Common operator tasks

| Task                        | Action                                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rotate app secret           | Console → RUNTIME profile → redeploy or wait for ESO                                                                                                                              |
| Rotate devtools DB password | `ALTER USER` → update console profiles → redeploy infra + backends                                                                                                                |
| Add deploy target           | Console → Deployment targets (or `upsertDeploymentTarget` API)                                                                                                                    |
| Gate new app path with SSO  | Edit `traefik/dynamic/oauth2-proxy-apps-gated-paths.yml`, recreate traefik                                                                                                        |
| Expose new TCP devtool      | Home Traefik + edge `FORWARD_TCP` + GCP firewall + rebuild template — see [Adding a shared-tool TCP forward](../99_maintainers/05_networking.md#adding-a-shared-tool-tcp-forward) |

---

## Related docs

- [Secrets](04_secrets.md) — Vault UI alternative
- [Deployments](05_deployments.md) — URLs and zones
- [Manual onboarding](06_manual_onboarding.md) — env profile mechanics
- CFA cheat sheet — `docs/onboarding/env-and-lifecycle-cheatsheet.md` in CFA infra/docs repo
