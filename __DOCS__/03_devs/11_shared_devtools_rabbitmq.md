# Shared devtools RabbitMQ

← [Back to Developer Guide](index.md)

External developers can connect to the **shared** RabbitMQ broker over the VPN edge (same path as [shared Postgres](10_shared_devtools_postgres.md)). Environment isolation is by **virtual host** (`dev` / `stg`), not by separate brokers or ports. This is raw TCP/HTTP — not HTTPS and not SSO.

Maintainer internals: [devtools stack](../99_maintainers/02_services.md#devtools-stack-shared-postgres), [Networking — shared-tool TCP forward](../99_maintainers/05_networking.md#adding-a-shared-tool-tcp-forward), [GCP edge template](../99_maintainers/10_gcp_edge_template.md).

---

## What it is

| Item           | Value                                                                                   |
| -------------- | --------------------------------------------------------------------------------------- |
| Purpose        | One shared RabbitMQ for app teams (CFA and others) on the platform host                 |
| Container      | `devtools-rabbitmq` (`devtools/docker-compose.yml`)                                     |
| Vhosts         | **`dev`**, **`stg`** (plus `/`)                                                         |
| User           | Generic **`admin`** (not app-specific)                                                  |
| Password       | From platform `devtools/.env` (`DEVTOOLS_RMQ_PASSWORD`) — sample default is `change-me` |
| In-cluster DNS | `devtools-rabbitmq.devtools.svc.cluster.local:5672`                                     |

---

## How to connect (external)

Traffic: laptop → GCP LB `34.101.130.148` → edge NAT → WireGuard → home Traefik → `devtools-rabbitmq`.

| Protocol          | Host                                                     | Port                            |
| ----------------- | -------------------------------------------------------- | ------------------------------- |
| **AMQP**          | `34.101.130.148` (or `gitlab.devops.yadatechnology.com`) | **`25672`**                     |
| **Management UI** | same host                                                | **`25682`** (`http://…:25682/`) |

```bash
# AMQP — vhost selects environment
amqp://admin:<password>@34.101.130.148:25672/dev
amqp://admin:<password>@34.101.130.148:25672/stg
```

Management UI login: same **`admin`** credentials. Pick vhost **`dev`** or **`stg`** in the UI. UI is plain HTTP via TCP passthrough (not TLS).

On the platform host / LAN you can use `localhost:25672` / `localhost:25682` (Traefik passthrough, no edge hop).

---

## In-cluster (k3d pods)

After `./devtools/apply-k8s-bridge.sh`:

```text
amqp://admin:<password>@devtools-rabbitmq.devtools.svc.cluster.local:5672/dev
amqp://admin:<password>@devtools-rabbitmq.devtools.svc.cluster.local:5672/stg
```

---

## Security expectations

- Auth is RabbitMQ user/password only — no oauth2-proxy / Keycloak gate.
- Rotate `DEVTOOLS_RMQ_PASSWORD` for anything beyond a personal sandbox; update any Vault RUNTIME `RABBITMQ_URL` values that embed the password.
- Do not put production secrets in queues on this broker.

---

## Related

- [Shared devtools Postgres](10_shared_devtools_postgres.md)
- Maintainer checklist for new TCP tools: [Adding a shared-tool TCP forward](../99_maintainers/05_networking.md#adding-a-shared-tool-tcp-forward)
