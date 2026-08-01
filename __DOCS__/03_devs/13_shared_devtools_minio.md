# Shared DevTools MinIO (S3)

← [Back to Developer Guide](index.md)

Shared object storage for app teams on the platform host (CFA and other DSOaaS apps). This is **separate** from the platform GitLab MinIO (`minio.devops.<DOMAIN>`).

Maintainer internals: [devtools stack](../99_maintainers/02_services.md#devtools-stack-shared-postgres--rabbitmq--logging).

---

## What it is

| Item            | Value                                                                             |
| --------------- | --------------------------------------------------------------------------------- |
| Purpose         | Shared S3-compatible storage for dev/stg workloads                                |
| Container       | `devtools-minio` (`devtools/docker-compose.yml`)                                  |
| Users           | **`admin`** (root) and **`cfa`** (readwrite service user)                         |
| Default buckets | `cfa-dev`, `cfa-stg`                                                              |
| In-cluster DNS  | `devtools-minio.devtools.svc.cluster.local:9000`                                  |
| Console         | `https://minio-devtools.devops.<DOMAIN>` (SSO `admins`/`users`, then MinIO login) |
| S3 API (HTTPS)  | `https://s3-devtools.devops.<DOMAIN>` (access-key auth only — no oauth2-proxy)    |
| S3 API (TCP)    | edge / localhost port **`29000`** → container `:9000`                             |

Passwords live in `devtools/.env` (`DEVTOOLS_MINIO_ROOT_PASSWORD`, `DEVTOOLS_MINIO_CFA_PASSWORD`).

---

## How to connect

### HTTPS S3 API (preferred)

```bash
# example with MinIO client
mc alias set cfa-dev https://s3-devtools.devops.yadatechnology.com cfa '<password>'
mc ls cfa-dev/cfa-dev
```

SDK endpoint: `https://s3-devtools.devops.yadatechnology.com` (path-style). Access key = username (`admin` or `cfa`).

### TCP passthrough (vpnedge)

```text
http://34.101.130.148:29000
```

Same access keys. Use path-style addressing.

### In-cluster (k3d)

After `./devtools/apply-k8s-bridge.sh`:

```text
http://devtools-minio.devtools.svc.cluster.local:9000
```

---

## Console

1. Open `https://minio-devtools.devops.<DOMAIN>`
2. Sign in with platform Keycloak (`admins` or `users`)
3. Sign in to MinIO with `admin` / `cfa` credentials from `devtools/.env`

---

## Security expectations

- S3 API is **not** behind Keycloak — protect credentials; rotate if leaked.
- Console is gated by `oidc-auth-devtools` then MinIO’s own login.
- Do not store production secrets here.

---

## Related

- [Shared DevTools Postgres](10_shared_devtools_postgres.md)
- [Shared DevTools RabbitMQ](11_shared_devtools_rabbitmq.md)
