# Shared devtools Postgres

← [Back to Developer Guide](index.md)

External developers can connect to the platform's **shared Postgres** used by CFA (and similar) **dev** / **stg** app databases. This is raw TCP — not HTTPS and not SSO.

Maintainer internals: [devtools stack](../99_maintainers/02_services.md#devtools-stack-shared-postgres), [GCP edge template](../99_maintainers/10_gcp_edge_template.md).

---

## What it is

| Item | Value |
|---|---|
| Purpose | Shared app-level DB for remote **dev** / **stg** (not the platform Keycloak/Sonar Postgres) |
| Databases | `cfa_dev`, `cfa_stg` (plus maintenance DB `devtools`) |
| Superuser (bootstrap) | From platform `devtools/.env` (`DEVTOOLS_PG_USER` / `DEVTOOLS_PG_PASSWORD`) — sample defaults are `devtools` / `change-me` |
| Schemas | CFA schemas come from the CFA `db-core` migration CI; do not invent a second schema source |

**Today:** only this shared Postgres is exposed for external tools. RabbitMQ and other Traefik TCP passthrough ports are **not** forwarded on the edge yet.

---

## How to connect (external)

Traffic path: your laptop → GCP passthrough LB → edge VM NAT → WireGuard → home Traefik `:25432` → `devtools-postgres`.

| Field | Value |
|---|---|
| Host | Public LB IP for the platform edge (production: **`34.101.130.148`**) — **not** an HTTPS hostname like `gitlab.devops.*` |
| Port | **`25432`** |
| User | Ask your platform operator (usually `devtools`) |
| Password | Ask your platform operator, or read from Console **RUNTIME** env profiles that embed the DB URL — **never commit** |
| Database | `cfa_dev` or `cfa_stg` |

```bash
psql -h 34.101.130.148 -p 25432 -U devtools -d cfa_dev
```

URL form:

```text
postgresql://devtools:<password>@34.101.130.148:25432/cfa_dev
postgresql://devtools:<password>@34.101.130.148:25432/cfa_stg
```

On the platform host itself (or LAN), you can also use `localhost:25432` / the Docker host — same Traefik passthrough, no edge hop.

---

## Security expectations

- Auth is **Postgres user/password only**. There is no oauth2-proxy / Keycloak gate on raw TCP.
- Default sample password must be rotated for anything beyond a personal sandbox.
- Treat credentials as secrets. Prefer receiving them from your platform operator or Console/Vault profiles.

---

## Out of scope / future

Exposing additional shared tools (e.g. RabbitMQ on `25672`/`25673`) follows the maintainer checklist **Adding a shared-tool TCP forward** in [Networking](../99_maintainers/05_networking.md#adding-a-shared-tool-tcp-forward). Developers do not need to change edge/GCP config for that — ask platform ops.
