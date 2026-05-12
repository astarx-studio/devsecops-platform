# Maintainer Reference

← [Back to docs home](../index.md)

**Audience:** Platform engineers and contributors who maintain, extend, or debug this DevOps platform.

This section is intentionally dense and technical. It is not written for end users or developers using the platform—those audiences have their own sections (`01_infra`, `02_admin`, `03_devs`). Everything here assumes you have already read those sections and now need to understand the internals.

---

## What this section covers

| Document | Contents |
|---|---|
| [01 — Architecture](./01_architecture.md) | Overall system design, container diagram, component relationships, technology choices |
| [02 — Services Reference](./02_services.md) | Per-service breakdown: image, ports, volumes, environment variables, health checks, startup order |
| [03 — Management API Internals](./03_management_api.md) | NestJS module tree, request lifecycle, all endpoints with full parameter schemas, service internals |
| [04 — Data Flows](./04_data_flows.md) | Sequence diagrams: project provisioning, authentication, inbound request routing, CI/CD pipeline |
| [05 — Networking](./05_networking.md) | Docker network topology, Traefik static/dynamic config, k3d passthrough, DNS strategy, public ingress modes (direct / `cftunnel` / `vpnedge`) |
| [06 — CI/CD Internals](./06_ci_cd.md) | GitLab Runner setup, shared config repos, pipeline templates, project pipeline anatomy |
| [07 — Secrets Management](./07_secrets.md) | Vault KV v2 paths, OIDC auth method, per-project secret schema, init script |
| [08 — Contributing](./08_contributing.md) | Local dev setup, running tests, adding services, extending the Management API |

---

## Platform at a glance

The platform is a **Docker Compose stack** providing self-hosted DevOps infrastructure for multiple clients and projects. Operator services run on a single bridge network (`devops-network`) behind Traefik; **k3d** hosts team application workloads with in-cluster Traefik + Ingress.

The core responsibilities of the platform:

- **Identity**: Keycloak handles SSO (OIDC) for all internal services and developer-facing tooling.
- **Routing**: Traefik terminates TLS (Let's Encrypt via Cloudflare DNS-01) and publishes operator UIs via Docker labels plus dynamic files under `traefik/dynamic/`.
- **Application ingress**: k3d provides Kubernetes; outer Traefik forwards `*.apps.<DOMAIN>` zones to the cluster (see `k3d-passthrough.yml`).
- **SCM + CI/CD**: GitLab CE hosts source code, a container registry, package registries, and runs pipelines via a Docker-executor runner.
- **Secrets**: Vault (KV v2) stores per-project runtime secrets, accessible to CI/CD pipelines and application containers.
- **Provisioning**: The Management API (NestJS) orchestrates project creation—GitLab repos or forks, Vault secrets, MongoDB registry data, and Kubernetes namespaces for Auto DevOps.
- **Tunneling**: Optional **Cloudflare Tunnel** (`cftunnel`) or **WireGuard to a cloud edge VM** (`vpnedge`) can expose the platform without relying on inbound HTTP(S) to your home network. See [Networking](./05_networking.md).

---

## Key conventions used throughout the codebase

- **Domain pattern**: `<service>.devops.<DOMAIN>` for platform services; `<effectiveSlug>.<env>.apps.<DOMAIN>` patterns for deployed apps inside k3d.
- **Docker network aliases**: every service exposes a DNS alias matching its public domain on the shared bridge network, so internal traffic resolves identically to external.
- **Environment variables**: `sample.env` is the single source of truth. Never hardcode domain names.
- **Non-critical steps**: In the provisioning flow, optional automation (for example pipeline triggers) may log warnings without failing the whole mutation—see Management API code for the exact list.
- **ForwardAuth**: `traefik/dynamic/forward-auth.yml` defines the shared `oidc-auth` middleware used by Traefik labels.
- **Keycloak realm**: `keycloak/realm-export.json` uses `${VAR}` placeholders resolved at container startup via `sed` in a custom entrypoint (Keycloak does not natively support env var substitution in realm imports).
- **Traefik template**: `traefik/traefik.yml` uses `__DOMAIN__` and `__ACME_EMAIL__` placeholders resolved at container startup via `sed`.
- **Cloudflared profile**: the `cloudflared` service is gated behind the `cftunnel` Docker Compose profile — it does not start with a regular `docker compose up -d`.
- **WireGuard / VPN edge profile**: the `wireguard` service is gated behind the `vpnedge` profile — use it when a cloud VM terminates public TCP and forwards to this stack over WireGuard (see [05 — Networking](./05_networking.md)).
