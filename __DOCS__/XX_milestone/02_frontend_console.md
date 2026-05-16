# Milestone — Operator Console (Frontend)

← [Back to Milestone designs](index.md)

> **Status**: Deferred (separate repository; not scheduled in this monorepo)
> **Audience**: Product owners, platform maintainers
> **Cross-references**: [Management API (maintainer)](../99_maintainers/03_management_api.md), [Deployments](../03_devs/05_deployments.md), [MIGRATION_PLAN_v2.md](../../MIGRATION_PLAN_v2.md) Phase 7 sketch

This milestone captures a **future web UI** on top of the v2 **GraphQL Management API**. Execution belongs in a **separate Git repository** so release cadence, dependencies, and security surface stay independent from the platform stack (`docker-compose.yml`, k3d, GitLab Omnibus).

---

## 1. Problem and motivation

Today, operators and admins use:

- GitLab UI, Keycloak admin, Vault UI, Traefik dashboard, and
- **HTTP clients** (curl, Insomnia, Apollo Sandbox) for `POST /graphql` and `GET /health`.

That is sufficient for bootstrap and break-glass operations, but it does not give a **single pane of glass** for project lifecycle (provision → env URLs → restart → audit) aligned with DSOaaS vocabulary.

---

## 2. Goal

Deliver a small **operator console** that authenticates against the same Keycloak realm and calls the Management API with OIDC bearer tokens, covering at least:

| Area | Intent |
|---|---|
| **Projects** | List, search, open detail; show `dev` / `stg` / `prod` URLs and provisioning status |
| **Actions** | Trigger or surface mutations already exposed in GraphQL (where safe), with confirmation flows |
| **Catalog** | Read-only views of templates and shared CI config slugs (backed by existing REST/GraphQL) |
| **Audit** | Surface audit log queries the API already supports |

**Non-goals for v1 of the console:** replacing GitLab for source browsing, full log tailing, or cluster shell access.

---

## 3. Suggested technical stack

| Layer | Suggestion |
|---|---|
| Framework | **Next.js** (App Router) **or** Vite + React Router |
| API client | **Apollo Client** **or** **urql** for GraphQL; fetch for health checks |
| Auth | **NextAuth** (or Auth.js) with **Keycloak OIDC** provider — align redirect URIs with `OAUTH_DOMAIN` / Keycloak client patterns already used by `oauth2-proxy` |
| Styling | Match org design system (e.g. MUI or existing internal library) — pick one and stay consistent |

---

## 4. Deployment model

Treat the console as **just another Auto DevOps application** provisioned by the platform:

- **Hostname pattern:** `console.devops.<DOMAIN>` (or equivalent agreed host under `*.devops.<DOMAIN>`).
- **Ingress:** k3d + inner Traefik + outer Traefik passthrough (same as other apps).
- **Secrets:** runtime config (GraphQL URL, OIDC client id) via Vault → ESO if needed, or build-time public env for non-secret endpoints only.

---

## 5. Security notes

- **CORS / cookie domains** — align `DOMAIN` cookie settings with parent DNS; avoid overly broad `*.` cookie domains.
- **Least privilege Keycloak client** — dedicated confidential client for the console; group/role checks mirror admin-only surfaces today protected by `oauth2-proxy` tiers.
- **No secrets in static assets** — client id may be public; client secret must stay server-side (BFF pattern in NextAuth).

---

## 6. Open questions

1. **Read vs write** — Which mutations are exposed in the UI first vs stay CLI-only?
2. **Multi-tenant** — Single console instance per platform (assumed) vs per customer deployment branding.
3. **Hosting** — Same Docker host as GitLab vs separate VM (latency vs blast radius).

---

## 7. Implementation outline (high level)

1. Create repo `dsoaas-console` (name flexible).
2. Wire OIDC login → obtain access token → attach `Authorization: Bearer` to GraphQL transport.
3. Ship read-only project list + detail; add mutations incrementally with integration tests.
4. Add Helm chart values / Auto DevOps project via Management API like any other app.
5. Document operator URLs in maintainer networking doc when the host goes live.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| GraphQL schema drift | Pin console to tagged API releases; CI schema check (`graphql-inspector` or codegen against `/graphql` in non-prod) |
| Token storage XSS | HttpOnly cookies, strict CSP, dependency audit |
| Duplicating GitLab UX | Keep scope narrow; deep-link into GitLab where appropriate |
