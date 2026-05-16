# k3d and Kubernetes on the Platform Host

← [Back to Infra Guide](index.md)

This page explains how the **k3d** cluster fits next to the Docker Compose stack, how **kubectl** is used, and how **outer Traefik** (Docker) forwards application traffic to **inner Traefik** (in-cluster). It also captures operational pitfalls discovered during migration (Phase 6.1).

---

## Why k3d is here

Applications are deployed with **GitLab Auto DevOps** into Kubernetes **namespaces** (`dev`, `stg`, `prod`) on a **k3d** cluster running on the same machine as GitLab, Vault, Traefik, and the Management API. The Compose stack is the *platform*; k3d is the *app runtime*.

---

## Prerequisites on the host

- **k3d**, **kubectl**, **helm**, **jq** — checked by [`bootstrap/checks/prereqs.sh`](../../bootstrap/checks/prereqs.sh) and again in [`bootstrap/k3d-cluster.sh`](../../bootstrap/k3d-cluster.sh).
- **Docker Compose stack up** — the k3d server containers attach to the same bridge network as the platform (`devops-network` by default). Start the stack first (see [Bootstrap](03_bootstrap.md)).

---

## Bootstrap scripts (order matters)

From the repository root, after `.env` is configured:

1. [`bootstrap/k3d-cluster.sh`](../../bootstrap/k3d-cluster.sh) — creates the k3d cluster idempotently, connects it to `devops-network`, creates namespaces (`dev`, `stg`, `prod`, `eso-system`).
2. [`bootstrap/k8s-primitives.sh`](../../bootstrap/k8s-primitives.sh) — installs in-cluster **Traefik** (Helm), **External Secrets Operator**, **Stakater Reloader**.
3. [`bootstrap/vault-k8s-auth.sh`](../../bootstrap/vault-k8s-auth.sh) — enables Vault Kubernetes auth, applies `ClusterSecretStore`, runs an ESO smoke test.
4. [`bootstrap/runner-rbac.sh`](../../bootstrap/runner-rbac.sh) — per-namespace RBAC for GitLab deploy jobs and kubeconfig CI variables.

Or run everything in one flow: **`make bootstrap`** or [`bootstrap/bootstrap.sh`](../../bootstrap/bootstrap.sh).

---

## kubectl context

The default cluster name is **`dsoaas`** (`K3D_CLUSTER_NAME` in `.env`). kubectl context name:

```text
k3d-<K3D_CLUSTER_NAME>
```

Example:

```bash
kubectl config use-context k3d-dsoaas
kubectl get nodes
kubectl get ns
```

---

## ServiceLB off and NodePort 30080

k3d is created with **`--k3s-arg "--disable=servicelb@server:*"`** so the built-in **klipper LoadBalancer** is disabled. A `LoadBalancer` Service for in-cluster Traefik would never get a reachable external IP through the old `k3d-*-serverlb` pattern.

**Mitigation (in repo):** Helm values in [`bootstrap/charts/traefik-values.yaml`](../../bootstrap/charts/traefik-values.yaml) set the Traefik chart Service to **NodePort** with a fixed **`nodePort: 30080`** on the web port. [`bootstrap/k8s-primitives.sh`](../../bootstrap/k8s-primitives.sh) installs or upgrades Traefik with that values file.

---

## Outer Traefik → inner Traefik (passthrough)

Outer Traefik (Docker) terminates TLS for `*.apps.<DOMAIN>`, `*.dev.apps.<DOMAIN>`, and `*.stg.apps.<DOMAIN>`, then forwards **plain HTTP** to the in-cluster Traefik NodePort.

Dynamic config: [`traefik/dynamic/k3d-passthrough.yml`](../../traefik/dynamic/k3d-passthrough.yml).

**Backend URL must be the k3d server container on the Docker network**, not the klipper LB host port:

```text
http://k3d-<K3D_CLUSTER_NAME>-server-0:30080
```

**Replicability caveat:** the hostname embeds **`K3D_CLUSTER_NAME`**. If you rename the cluster, update the passthrough backend URL (or template it the same way as `__DOMAIN__` in Traefik’s entrypoint `sed` step) **in lockstep** with `k3d-cluster.sh`, or outer routing will miss the cluster and you will see **404** / no route.

---

## Traefik v3 `HostRegexp` (outer)

Outer Traefik is **v3.x**. Rules must use **Go regexp** syntax accepted by Traefik v3.

**Working example (prod app zone):**

```text
HostRegexp(`[a-z0-9-]+\.apps\.<your-domain>`)
```

**Broken on v3 (Traefik v2 “named group” style):**

```text
HostRegexp(`{subdomain:[a-z0-9-]+}.apps.<your-domain>`)
```

If the regexp does not match, app-zone traffic **never** hits the k3d passthrough router and typically falls through to a generic **404**.

---

## Why there is no active health check on the passthrough backend

An **HTTP health check** on the passthrough service that probes **`/ping` on the web NodePort** fails: inner Traefik serves **`/ping`** on its **internal** metrics entrypoint, not on the Service port that receives traffic from outer Traefik. Traefik would mark the upstream **DOWN** and clients would see **“no available server”**.

**Mitigation:** no active `healthCheck` on the `k3d-ingress` service in [`traefik/dynamic/k3d-passthrough.yml`](../../traefik/dynamic/k3d-passthrough.yml); rely on passive upstream handling.

---

## GitLab object storage (MinIO) and the stack

GitLab expects an **S3-compatible** backend for artifacts and related object types. The Compose file includes **MinIO** and a one-shot **minio-init** job. For manual bucket parity (optional), see [`bootstrap/minio-bootstrap.sh`](../../bootstrap/minio-bootstrap.sh). Bootstrap order: MinIO must be healthy before relying on GitLab for CI artifact uploads.

---

## Quick troubleshooting

| Symptom | What to check |
|---|---|
| `kubectl` cannot connect | `kubectl config use-context k3d-$K3D_CLUSTER_NAME`; cluster created? `k3d cluster list` |
| Apps 404 at edge | Passthrough `HostRegexp` (v3 syntax); backend host `k3d-*-server-0:30080`; `K3D_CLUSTER_NAME` matches |
| ESO secrets never appear | Vault K8s auth and `ClusterSecretStore`; see maintainer [CI/CD — Vault and ExternalSecret paths](../99_maintainers/06_ci_cd.md) |
| Helm deploy timeout | Image pull from registry, DNS from k3d node, `ExternalSecret` sync — see maintainer CI/CD doc |

---

## Related documentation

- [Bootstrap — one-shot platform + k3d](03_bootstrap.md)
- [Networking (maintainer)](../99_maintainers/05_networking.md)
- [CI/CD internals — Auto DevOps, chart, registry](../99_maintainers/06_ci_cd.md)
