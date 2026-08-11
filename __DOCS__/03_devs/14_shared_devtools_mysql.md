# Shared DevTools MySQL

← [Back to Developer Guide](index.md)

External developers can connect to the platform's **shared MySQL** used by ESA (and similar) app databases. This is raw TCP — not HTTPS and not SSO.

Maintainer internals: [devtools stack](../99_maintainers/02_services.md#devtools-stack-shared-postgres--rabbitmq--logging), [GCP edge template](../99_maintainers/10_gcp_edge_template.md).

---

## What it is

| Item | Value |
|---|---|
| Purpose | Shared app-level MySQL for remote **dev** workloads (not the platform Keycloak/Sonar Postgres) |
| Container | `devtools-mysql` (`devtools/docker-compose.yml`) |
| Databases | Maintenance `devtools`; app DB `esa_dev` (created by `devtools/mysql-init/ensure-users.sh`) |
| Users | **`admin`** (ALL PRIVILEGES) and **`esa_dev`** (`esa_dev.*` only) |
| In-cluster DNS | `devtools-mysql.devtools.svc.cluster.local:3306` |
| TCP | edge / localhost port **`23306`** → container `:3306` |

Passwords live in `devtools/.env` (`DEVTOOLS_MYSQL_ADMIN_PASSWORD`, `DEVTOOLS_MYSQL_ESA_PASSWORD`). Root is bootstrap-only — do not hand it to app teams.

Schemas/migrations stay in each project's repo/CI.

---

## How to connect (external)

Traffic path: your laptop → GCP passthrough LB → edge VM NAT → WireGuard → home Traefik `:23306` → `devtools-mysql`.

| Field | Value |
|---|---|
| Host | Public LB IP for the platform edge (production: **`34.101.130.148`**) — **not** an HTTPS hostname |
| Port | **`23306`** |
| User | `admin` (operator) or `esa_dev` (ESA app) |
| Password | Ask your platform operator — **never commit** |
| Database | `esa_dev` (app) or `devtools` (maintenance; admin only) |

```bash
mysql -h 34.101.130.148 -P 23306 -u esa_dev -p esa_dev
```

URL form:

```text
mysql://esa_dev:<password>@34.101.130.148:23306/esa_dev
```

On the platform host itself (or LAN), you can also use `localhost:23306` / the Docker host — same Traefik passthrough, no edge hop.

### In-cluster (k3d)

After `./devtools/apply-k8s-bridge.sh`:

```text
devtools-mysql.devtools.svc.cluster.local:3306
```

---

## Security expectations

- Auth is **MySQL user/password only**. There is no oauth2-proxy / Keycloak gate on raw TCP.
- Treat credentials as secrets. Prefer receiving them from your platform operator.
- External reachability also needs edge `FORWARD_TCP` + GCP firewall for **`23306`** (home Traefik publish is not enough).

---

## Related

- [Shared DevTools Postgres](10_shared_devtools_postgres.md)
- Maintainer checklist for new TCP tools: [Adding a shared-tool TCP forward](../99_maintainers/05_networking.md#adding-a-shared-tool-tcp-forward)
