# Shared DevTools logging (Loki + Grafana)

← [Back to Developer Guide](index.md)

Platform-wide log aggregation for **all DSOaaS-deployed apps** (Auto DevOps → k3d). CFA apps are included as normal consumers — not a separate logging stack.

Maintainer internals: [devtools stack](../99_maintainers/02_services.md#devtools-stack-shared-postgres--rabbitmq--logging).

---

## What it is

| Item       | Value                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| Purpose    | Browse/search application and platform container logs without `kubectl logs`                                         |
| Store      | Grafana Loki (shared DevTools compose)                                                                               |
| UI         | Grafana Explore at `https://grafana.devops.<DOMAIN>`                                                                 |
| Auth       | DevTools oauth2 tier (`oidc-auth-devtools`): Keycloak groups **`admins`** or **`users`** (console stays admins-only) |
| Collectors | Alloy (Docker compose logs) + Alloy DaemonSet (all k3d pods)                                                         |

---

## How to use (developers)

1. Open **`https://grafana.devops.<DOMAIN>`** (example: `https://grafana.devops.yadatechnology.com`).
2. Sign in with platform Keycloak (any user in **`admins`** or **`users`** — default for new accounts). Operator console remains **`admins`** only.
3. Go to **Explore** → datasource **Loki**.

### Useful LogQL examples

All pods in the `dev` namespace:

```logql
{namespace="dev"}
```

A specific DSOaaS / CFA app release:

```logql
{namespace="dev", app="payable-service"}
```

or by Helm release name:

```logql
{namespace="dev", release="payable-service"} |= "ERROR"
```

Platform compose service (e.g. Traefik / API):

```logql
{source="docker", container="api"}
```

---

## What gets collected automatically

| Source                                              | Collector                              | Labels                                                                 |
| --------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| k3d pods (`dev` / `stg` / `prod`, …)                | Alloy DaemonSet in `logging` namespace | `namespace`, `pod`, `container`, `app`, `release`, `source=kubernetes` |
| Docker containers on the host (platform + DevTools) | Alloy in DevTools compose              | `container`, `compose_project`, `compose_service`, `source=docker`     |

No per-app chart changes are required for basic collection. Optional: emit structured JSON from your app for easier filtering.

---

## Retention

Default Loki retention is **7 days** (`168h`) on the shared host volume. Treat DevTools logs as short-lived operational history, not an archive.

---

## Related

- [Shared DevTools Postgres](10_shared_devtools_postgres.md)
- [Shared DevTools RabbitMQ](11_shared_devtools_rabbitmq.md)
- [Deployments](05_deployments.md)
