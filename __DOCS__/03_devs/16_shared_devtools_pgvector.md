# Shared DevTools pgvector

← [Back to Developer Guide](index.md)

External developers can connect to the platform's **pgvector Postgres** for embeddings and similarity search. This is raw TCP — not HTTPS and not SSO. It is a separate server from the shared app Postgres on port `25432`.

Maintainer internals: [devtools stack](../99_maintainers/02_services.md#devtools-stack-shared-postgres), [GCP edge template](../99_maintainers/10_gcp_edge_template.md).

---

## What it is

| Item           | Value                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| Purpose        | Postgres 17 with the [pgvector](https://github.com/pgvector/pgvector) extension, for app-level vector columns |
| Container      | `devtools-pgvector` (`devtools/docker-compose.yml`, image `pgvector/pgvector:pg17`)                           |
| Database       | `vectors`                                                                                                     |
| User           | `vectors` (bootstrap superuser)                                                                               |
| Extension      | `vector`, created on `vectors` and on `template1` by `devtools/pgvector-init/ensure-extension.sh`             |
| In-cluster DNS | `devtools-pgvector.devtools.svc.cluster.local:5432`                                                           |
| Compose DNS    | `devtools-pgvector:5432` (other containers on `devops-network`)                                               |
| TCP            | edge / localhost port **`25433`** → container `:5432`                                                         |
| Static IP      | `172.19.0.106`                                                                                                |

The password lives in `devtools/.env` (`DEVTOOLS_PGVECTOR_PASSWORD`). Schemas and tables stay in each project's repo.

Database `vectors` also holds the Qestor estimator memory tables `estimation_event` and `estimation_example`, created by `devtools/pgvector-init/ensure-extension.sh`. A `seen` event stores the title and description hash so the same text is not estimated again after n8n restarts. Other containers on `devops-network` connect as `devtools-pgvector:5432`.

A new database created from `template1` already includes `vector`. A database that already existed **MUST** run `CREATE EXTENSION IF NOT EXISTS vector;` itself.

---

## How to connect (external)

Traffic path: your laptop → GCP passthrough LB → edge VM NAT → WireGuard → home Traefik `:25433` → `devtools-pgvector`.

| Field    | Value                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------- |
| Host     | Public LB IP for the platform edge (production: **`34.101.130.148`**) — **not** an HTTPS hostname |
| Port     | **`25433`**                                                                                       |
| User     | `vectors`                                                                                         |
| Password | Ask your platform operator — **never commit**                                                     |
| Database | `vectors`                                                                                         |

```bash
psql -h 34.101.130.148 -p 25433 -U vectors -d vectors
```

URL form:

```text
postgresql://vectors:<password>@34.101.130.148:25433/vectors
```

On the platform host itself (or LAN), you can also use `localhost:25433` — same Traefik passthrough, no edge hop.

```sql
CREATE TABLE items (
  id bigserial PRIMARY KEY,
  embedding vector(3)
);
INSERT INTO items (embedding) VALUES ('[1,2,3]');
SELECT id FROM items ORDER BY embedding <-> '[1,2,4]' LIMIT 5;
```

### In-cluster (k3d)

After `./devtools/apply-k8s-bridge.sh`:

```text
devtools-pgvector.devtools.svc.cluster.local:5432
```

---

## Security expectations

- Auth **MUST** be Postgres user/password only. There is no oauth2-proxy / Keycloak gate on raw TCP.
- The sample password **MUST** be rotated before any use beyond a personal sandbox.
- Credentials **MUST** be treated as secrets.
- External reachability **MUST** also have edge `FORWARD_TCP` and a GCP firewall rule for **`25433`** (home Traefik publish is not enough). The firewall rule is **not** created by Compose.

---

## Related

- [Shared DevTools Postgres](10_shared_devtools_postgres.md)
- Maintainer checklist for new TCP tools: [Adding a shared-tool TCP forward](../99_maintainers/05_networking.md#adding-a-shared-tool-tcp-forward)
