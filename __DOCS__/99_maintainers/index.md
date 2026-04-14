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
| [05 — Networking](./05_networking.md) | Docker network topology, Traefik static/dynamic config, Kong declarative config, DNS strategy |
| [06 — CI/CD Internals](./06_ci_cd.md) | GitLab Runner setup, shared config repos, pipeline templates, project pipeline anatomy |
| [07 — Secrets Management](./07_secrets.md) | Vault KV v2 paths, OIDC auth method, per-project secret schema, init script |
| [08 — Contributing](./08_contributing.md) | Local dev setup, running tests, adding services, extending the Management API |

---

## Platform at a glance

The platform is a **single-machine Docker Compose stack** providing self-hosted DevOps infrastructure for multiple clients and projects. It is not a Kubernetes environment and makes no attempt to be cloud-native. Everything runs on one Docker bridge network (`devops-network`) and is exposed via a single Traefik reverse proxy.

The core responsibilities of the platform:

- **Identity**: Keycloak handles SSO (OIDC) for all internal services and developer-facing tooling.
- **Routing**: Traefik terminates TLS (Let's Encrypt via Cloudflare DNS-01) and forwards traffic to Kong or directly to services.
- **API Gateway**: Kong manages upstream routing for deployed applications and internal services, with rate limiting and plugin extensibility.
- **SCM + CI/CD**: GitLab CE hosts source code, a container registry, package registries, and runs pipelines via a Docker-executor runner.
- **Secrets**: Vault (KV v2) stores per-project runtime secrets, accessible to CI/CD pipelines and application containers.
- **Provisioning**: The Management API (NestJS) orchestrates project creation—forking templates, configuring Kong, writing Vault secrets, and optionally updating Cloudflare DNS.
- **Tunneling**: Cloudflare Tunnel exposes the platform to the internet without opening inbound firewall ports.

---

## Key conventions used throughout the codebase

- **Domain pattern**: `<service>.devops.<DOMAIN>` for platform services; `<projectName>.<APPS_DOMAIN>` for deployed apps.
- **Docker network aliases**: every service exposes a DNS alias matching its public domain on the shared bridge network, so internal traffic resolves identically to external.
- **Environment variables**: `sample.env` is the single source of truth. Never hardcode domain names.
- **Non-critical steps**: In the provisioning flow, Cloudflare DNS and pipeline triggers are explicitly non-critical. Failures are logged as warnings and do not roll back the operation.
- **Kong template**: `kong/kong.template.yml` uses `${VAR}` placeholders resolved at runtime via `sed` in the `kong-deck-sync` container (custom alpine + deck image).
- **Keycloak realm**: `keycloak/realm-export.json` uses `${VAR}` placeholders resolved at container startup via `sed` in a custom entrypoint (Keycloak does not natively support env var substitution in realm imports).
- **Traefik template**: `traefik/traefik.yml` uses `__DOMAIN__` and `__ACME_EMAIL__` placeholders resolved at container startup via `sed`.
- **Cloudflared profile**: the `cloudflared` service is gated behind the `cftunnel` Docker Compose profile — it does not start with a regular `docker compose up -d`.
