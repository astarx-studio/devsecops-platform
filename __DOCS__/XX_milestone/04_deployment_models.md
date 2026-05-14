# Milestone — Deployment Models: Compose-Native and Kubernetes-Native

← [Back to Milestone designs](index.md)

> **Status**: Proposed (not yet scheduled)
> **Audience**: Platform maintainers, future-Phase planners
> **Depends on**: [Platform operability milestone](03_platform_operability.md) — `dsoctl` and the sealed config model are prerequisites
> **Cross-references**: [Infra prereqs](../01_infra/01_prereqs.md), [Bootstrap](../01_infra/03_bootstrap.md), [Architecture](../99_maintainers/01_architecture.md), [Networking](../99_maintainers/05_networking.md)

The platform currently runs its control-plane services (Keycloak, Vault, GitLab, Management API, Traefik, etc.) on a single Docker host via Docker Compose. That model is correct for minimal deployments — it's simple to bootstrap, cheap to operate, and has no cluster management overhead. But it has a hard ceiling: one host, no horizontal scaling, no HA, no live migration.

This milestone introduces **two first-class, officially supported deployment modes** — Compose and Kubernetes — that expose the same operator experience regardless of which mode is active. The analogy to OpenStack's AIO (All-In-One) vs. multi-node deployment, or OpenShift's CRC vs. production cluster, is exact: the platform should be installable on a developer's single machine and also deployable on enterprise multi-zone Kubernetes infrastructure, *without functional differences in how it's operated*.

---

## Table of contents

1. [Problem & motivation](#1-problem--motivation)
2. [Current state](#2-current-state)
3. [Goal & non-goals](#3-goal--non-goals)
4. [Architecture — the two modes](#4-architecture--the-two-modes)
5. [Compose mode (formalised)](#5-compose-mode-formalised)
6. [Kubernetes mode](#6-kubernetes-mode)
7. [Cluster topology options](#7-cluster-topology-options)
8. [User workload deployment in each mode](#8-user-workload-deployment-in-each-mode)
9. [Operator UX parity — `dsoctl` as the abstraction layer](#9-operator-ux-parity--dsoctl-as-the-abstraction-layer)
10. [Migration path — Compose → Kubernetes](#10-migration-path--compose--kubernetes)
11. [Open questions](#11-open-questions)
12. [Implementation outline](#12-implementation-outline)
13. [Risks & rollback](#13-risks--rollback)
14. [Appendix](#14-appendix)

---

## 1. Problem & motivation

### The Compose ceiling

The current Docker Compose deployment is excellent for what it is: a self-contained, single-host platform that any operator can boot from a clone and a filled-in `.env`. But several growth scenarios hit hard limits it cannot address:

- **High availability**: if the host goes down, everything goes down. No replica sets, no pod rescheduling, no leader election.
- **Horizontal scaling**: the Management API is stateless; it *could* run as five replicas behind a load balancer. Compose has no native mechanism to express this without wrapping it in a Swarm or external proxy.
- **Teams that already run Kubernetes**: an organisation with an existing k8s cluster wants to onboard this platform without provisioning a separate Docker host just for it.
- **Multi-zone / disaster recovery**: distributing platform services across availability zones is a k8s primitive; it is not a Compose primitive.

### The "just use k8s for everything" temptation

The answer is not to abandon Docker Compose and rewrite everything for Kubernetes. Compose is still the right runtime for small teams, solo operators, and development environments. Requiring k8s knowledge just to evaluate the platform is a significant adoption barrier. The goal is to make *both* viable, not to deprecate one.

### The functional-parity constraint

The user-facing and operator-facing behaviour of the platform must be **identical regardless of which deployment mode is active**. A developer onboarding a project, an operator rotating a credential, a CI pipeline deploying an app — none of these should behave differently because the platform happens to be running on Compose vs. k8s. The deployment mode is an infrastructure detail the platform abstracts away.

---

## 2. Current state

The platform's control-plane services run as Docker Compose services on a single host:

| Service | Role | State persistence |
|---|---|---|
| `traefik` | Edge TLS + routing | Stateless (ACME certs in `.vols/traefik/`) |
| `keycloak` | Identity provider / SSO | Stateful (Postgres) |
| `keycloak-db` | PostgreSQL for Keycloak | Stateful (`.vols/keycloak-db/`) |
| `vault` | Secrets store (OpenBao) | Stateful (`.vols/vault/`) |
| `vault-oidc-init` | One-shot OIDC config | Ephemeral (runs once at bootstrap) |
| `gitlab` | Source control + CI/CD | Stateful (`.vols/gitlab/`) — large |
| `gitlab-runner` | CI job executor | Stateless |
| `mongo` | Management API database | Stateful (`.vols/mongo/`) |
| `api` | Management API (GraphQL) | Stateless |
| `oauth2-proxy` | ForwardAuth / access tier | Stateless |
| `minio` | S3-compatible object store (GitLab artifacts, registry) | Stateful (`.vols/minio/`) |
| `minio-init` | One-shot MinIO bucket setup | Ephemeral |
| `cloudflared` | Cloudflare Tunnel (optional profile) | Stateless |
| `wireguard` | VPN edge ingress (optional profile) | Stateless |

In parallel, `k3d` runs a Kubernetes cluster *inside* the Docker host for **user workloads only** (the apps developers deploy through the platform). The platform's own services do not run in k3d.

```
Docker host
├── docker-compose (platform control plane)
│   ├── traefik, keycloak, vault, gitlab, api, mongo, ...
│   └── outer Traefik talks to:
│       └── k3d cluster (user workloads — inner Traefik + app Namespaces)
```

---

## 3. Goal & non-goals

### 3.1 Goals

1. **Two officially supported deployment modes**, each documented to the same standard:
   - **Compose mode**: single-host Docker Compose (current architecture, formalised)
   - **Kubernetes mode**: platform services deployed as Helm chart workloads on any CNCF-conformant k8s cluster
2. **Topology flexibility within Kubernetes mode**: platform services and user workloads can share a cluster (same-cluster topology) or run on separate clusters (split topology), with no functional difference to the operator.
3. **Operator UX parity**: `dsoctl` works identically in both modes. The underlying backend (Compose vs. k8s API) is a configuration detail, not a workflow difference.
4. **Same config and secrets model**: `platform.conf` + Vault (from milestone 03) is the config layer for both modes. There are no mode-specific config files.
5. **Documented migration path** from Compose to Kubernetes for existing deployments.
6. **Feature parity**: Auto DevOps pipelines, project provisioning, CI/CD, and all Management API capabilities work the same in both modes.

### 3.2 Non-goals

- **Replacing Docker Compose as the default for new installs.** Compose mode remains the default and the recommended starting point for small deployments.
- **Running platform services in k3d.** k3d is (and remains) the user-workload runtime in Compose mode. In Kubernetes mode, k3d is replaced by the real k8s cluster — k3d is not the production k8s runtime for the platform's own services in either mode.
- **Multi-cluster federation.** Managing multiple user-workload clusters from one platform control plane is a future milestone ("multi-cluster management"). This milestone handles one control-plane deployment targeting one workload cluster.
- **Managed Kubernetes (EKS, GKE, AKS) specific optimisations.** The Kubernetes mode targets CNCF-conformant clusters generically. Cloud-provider-specific add-ons (e.g., using RDS instead of an in-cluster Postgres, or using ECR instead of the platform's GitLab registry) are operator customisations, not in-scope changes.
- **Auto-migration of data.** The migration path in §10 covers the steps, but automated live data migration (e.g., GitLab data from a Compose bind mount to a PVC) is explicitly a manual operator responsibility.

---

## 4. Architecture — the two modes

### 4.1 Side-by-side overview

```
┌────────────────────────────────────────────────────────────────┐
│             Operator surface (identical in both modes)         │
│   dsoctl CLI  ──────►  Management API  ──────►  Vault (secrets)│
│   Operator Console (milestone 02, optional)                    │
└────────────────────────┬───────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          │                             │
  ┌───────▼──────────┐         ┌────────▼────────────┐
  │  COMPOSE MODE    │         │  KUBERNETES MODE     │
  │                  │         │                      │
  │  Docker host     │         │  k8s cluster         │
  │  docker-compose  │         │  Helm charts         │
  │  .vols/ for PV   │         │  PersistentVolumes   │
  │  k3d inside host │         │  Cluster ingress     │
  │  for user apps   │         │  for user apps:      │
  │                  │         │   same cluster (ns)  │
  └──────────────────┘         │   or separate cluster│
                               └─────────────────────-┘
```

### 4.2 What is and isn't mode-specific

| Concern | Compose mode | Kubernetes mode |
|---|---|---|
| Platform services runtime | `docker compose up -d` | `helm upgrade --install` |
| Config source | `platform.conf` + Vault | `platform.conf` + Vault (same) |
| Secrets injection | Pattern B (rendered env at startup) | Vault Agent Injector or ESO |
| Persistent storage | Bind mounts (`.vols/`) | PersistentVolumeClaims |
| Network / ingress | Traefik with Docker labels + file providers | Traefik as in-cluster Ingress controller (or any CNCF ingress) |
| TLS certificates | ACME via Traefik (Let's Encrypt) | cert-manager (same ACME, k8s-native) |
| User workload runtime | k3d (embedded k8s) | Same cluster (namespaced) or separate cluster |
| Operator CLI (`dsoctl`) | Same binary, compose backend | Same binary, k8s backend |
| Management API behaviour | Identical | Identical |
| Auto DevOps pipelines | Identical | Identical |

The Management API, Auto DevOps chart (`dsoaas-app`), and all pipeline logic are **mode-agnostic**. They talk to the k8s API (for user workloads) regardless of whether the platform's own services are on Compose or k8s.

---

## 5. Compose mode (formalised)

This milestone formally names and documents Compose as **Compose mode** rather than treating it as "just how the platform works." The documentation changes:

- `__DOCS__/01_infra/` becomes the Compose mode guide.
- A new top-level `__DOCS__/00_modes.md` explains the two modes and when to choose each.
- `dsoctl init --mode=compose` targets a Compose deployment.

No functional changes to Compose mode are made by this milestone. The goal is to make Compose a *peer* of Kubernetes mode, not an implicit default that happens to be undocumented as a choice.

The only structural addition is that `docker-compose.yml` gains explicit `profiles` for all optional services (`cloudflared`, `wireguard`) that are already informally optional today, making the minimal Compose footprint even smaller:

```bash
# Minimal Compose mode (core platform only):
docker compose up -d

# With Cloudflare tunnel:
docker compose --profile cftunnel up -d

# With VPN edge:
docker compose --profile vpnedge up -d
```

---

## 6. Kubernetes mode

### 6.1 Platform Helm chart — umbrella design

The Kubernetes mode is delivered as a **single umbrella Helm chart** (`dsoaas-platform`) that composes upstream charts for each service and adds platform-specific wiring (inter-service configuration, Vault AppRole bootstrap, initial Keycloak realm import).

```
dsoaas-platform/                    # umbrella chart
  Chart.yaml
  values.yaml                       # single operator-facing values file
  charts/
    traefik/                        # traefik/traefik (upstream dependency)
    keycloak/                       # bitnami/keycloak (upstream dependency)
    keycloak-db/                    # bitnami/postgresql (upstream dependency)
    vault/                          # hashicorp/vault or openbao/openbao
    gitlab/                         # gitlab/gitlab (upstream dependency — see §6.3)
    mongodb/                        # bitnami/mongodb
    minio/                          # minio/minio (upstream dependency)
    oauth2-proxy/                   # oauth2-proxy/oauth2-proxy
    management-api/                 # custom chart (this project)
    cloudflared/                    # cloudflare/cloudflare (optional)
  templates/
    # platform-level resources: Namespaces, NetworkPolicies, Vault init Job, etc.
    namespace.yaml
    vault-init-job.yaml             # replaces vault-oidc-init compose service
    keycloak-realm-import-job.yaml  # replaces realm-export.json + manual import
    gitlab-runner-job.yaml          # replaces dsoctl bootstrap gitlab-runner
```

The operator installs the platform with a single command:

```bash
# Install or upgrade the entire platform:
dsoctl apply  # → helm upgrade --install dsoaas-platform ./charts/dsoaas-platform \
              #     -f platform-values.yaml -n platform --create-namespace

# Or directly:
helm upgrade --install dsoaas-platform oci://registry.devops.<DOMAIN>/dsoaas-platform \
  --version 1.0.0 -f platform-values.yaml -n platform --create-namespace
```

### 6.2 `platform-values.yaml` — the operator config file

In Kubernetes mode, `platform.conf` maps to a `platform-values.yaml` that `helm` consumes. Secrets are **not** in this file — they are pre-populated in Vault by `dsoctl init` before Helm runs.

```yaml
# platform-values.yaml (no secrets — all secrets live in Vault)

global:
  domain: yourdomain.com
  appsDomain: apps.yourdomain.com
  clusterTopology: split   # or: same-cluster

vault:
  addr: http://vault.platform.svc.cluster.local:8200
  authMethod: approle

traefik:
  enabled: true
  acme:
    email: your@email.com

gitlab:
  enabled: true
  externalUrl: https://gitlab.devops.yourdomain.com

keycloak:
  enabled: true

managementApi:
  enabled: true
  replicas: 2          # horizontal scaling in k8s mode

cloudflared:
  enabled: false       # opt-in, same as compose profile
```

### 6.3 GitLab — the difficult dependency

GitLab on Kubernetes deserves special attention. The official `gitlab/gitlab` Helm chart is a significant operational undertaking — it deploys Gitaly, Workhorse, Webservice, Shell, Runner, Registry, and PostgreSQL as separate workloads, with dozens of configuration values. It is not a drop-in replacement for the GitLab Omnibus container used in Compose mode.

Two options:

**Option A — GitLab official Helm chart.** Full k8s-native GitLab. Best long-term, most scalable. Steep migration path from Omnibus, high complexity.

**Option B — GitLab Omnibus in k8s (single pod).** Run the same GitLab Omnibus image as a Deployment with a single replica and a PVC. Loses horizontal scaling for GitLab, but preserves the operational model and makes migration from Compose mode trivial (copy the data volume). Still benefits from k8s scheduling, restarts, and resource limits.

**Recommended**: B as the v1 k8s mode default, with a documented upgrade path to A. This lets the milestone ship without a GitLab migration project embedded inside it. The `dsoaas-platform` chart's `gitlab` sub-chart uses Omnibus in v1; a future milestone can replace it with the official chart.

### 6.4 Secrets injection in Kubernetes mode

In Compose mode, secrets are injected via rendered env files (Pattern B from milestone 03). In k8s mode, the canonical approach is **Vault Agent Injector**:

```yaml
# Pod annotation (added by the management-api chart):
vault.hashicorp.com/agent-inject: "true"
vault.hashicorp.com/role: "management-api"
vault.hashicorp.com/agent-inject-secret-config: "platform/management-api/api-key"
vault.hashicorp.com/agent-inject-template-config: |
  {{- with secret "platform/management-api/api-key" -}}
  API_KEY={{ .Data.data.key }}
  {{- end }}
```

The Vault agent sidecar renders secrets to a mounted file; the application reads it at startup. Rotating a secret in Vault automatically propagates to new pods (after a rolling restart triggered by `dsoctl secret rotate`).

Alternative: **External Secrets Operator (ESO)** — pulls secrets from Vault and creates native k8s `Secret` objects. More familiar to k8s operators, compatible with more charts out-of-the-box. See Q3.

### 6.5 Storage model

| Compose mode | Kubernetes mode |
|---|---|
| `./vols/gitlab/` bind mount | `PersistentVolumeClaim` (e.g. 50 Gi, `ReadWriteOnce`) |
| `./vols/mongo/` | PVC |
| `./vols/vault/` | PVC |
| `./vols/minio/` | PVC (or use external S3 — see Q4) |
| `./vols/keycloak-db/` | PVC |
| `./vols/traefik/` (ACME certs) | cert-manager manages TLS; no PVC needed |

StorageClass is operator-provided. The `dsoaas-platform` chart declares PVCs with `storageClassName: ""` by default (cluster default class). Operators with specific requirements (e.g., `longhorn`, `ceph-rbd`) set it in `platform-values.yaml`.

### 6.6 Ingress in Kubernetes mode

Compose mode uses Traefik via Docker labels + file provider snippets for both platform services and the outer-edge routing to k3d user workloads.

In Kubernetes mode:
- **Platform services** are exposed via standard k8s Ingress resources (IngressClass: `traefik` or `nginx` — operator's choice).
- **cert-manager** handles TLS (same ACME / Let's Encrypt as Traefik in Compose mode, just k8s-native).
- The `dsoaas-platform` chart includes a Traefik sub-chart; operators who already have an ingress controller in their cluster can disable it and use their existing one (`traefik.enabled: false`).

The outer Traefik passthrough configuration (`traefik/dynamic/k3d-passthrough.yml`) is a Compose mode artefact; in k8s mode, user app traffic routes via the cluster's native Ingress without a two-hop passthrough.

---

## 7. Cluster topology options

The platform supports two cluster topologies in Kubernetes mode. Both are fully functional; the choice is an operational preference.

### 7.1 Same-cluster topology

```
┌─────────────────────────────────────────────────┐
│  Single k8s cluster                             │
│                                                 │
│  namespace: platform                            │
│    keycloak, vault, gitlab, mongo, api, ...     │
│                                                 │
│  namespace: dev  (user workloads — dev env)     │
│  namespace: stg  (user workloads — staging)     │
│  namespace: prod (user workloads — prod)        │
└─────────────────────────────────────────────────┘
```

Simpler infra, lower cost. All traffic stays in-cluster. A misbehaving user workload can affect platform services (resource exhaustion, noisy neighbour). Mitigated by: namespace-level `ResourceQuota`, `NetworkPolicy` denying cross-namespace traffic, and node taints reserving dedicated nodes for the platform namespace.

### 7.2 Split-cluster topology

```
┌──────────────────────────────┐    ┌─────────────────────────────────────┐
│  Platform cluster            │    │  Workload cluster                   │
│                              │    │                                     │
│  namespace: platform         │    │  namespace: dev                     │
│    keycloak, vault, gitlab   │◄───┤  namespace: stg                     │
│    mongo, api, traefik, ...  │    │  namespace: prod                    │
│                              │    │                                     │
└──────────────────────────────┘    └─────────────────────────────────────┘
       Management API talks to workload cluster via kubeconfig secret
```

Better isolation — blast radius of user workloads is contained. Platform services are on dedicated infra. The Management API holds a kubeconfig for the workload cluster (stored in Vault at `platform/workload-cluster/kubeconfig`). This is how the platform connects to k3d today in Compose mode — the topology is the same, just at cluster scope rather than Docker-host scope.

### 7.3 The functional-parity constraint

Neither topology requires changes to the Management API's project provisioning logic, Auto DevOps chart, or operator CLI. The only difference is which k8s endpoint the Management API targets for user workload namespaces. This is a configuration value (`workloadCluster.kubeconfig` or `workloadCluster.inCluster: true`) — not a code path difference.

---

## 8. User workload deployment in each mode

User workloads (apps that developers deploy through the platform) always run on Kubernetes. The deployment mechanism (Auto DevOps pipeline + `dsoaas-app` Helm chart) does not change between modes. Only the *target* cluster changes:

| | Compose mode | k8s mode — same-cluster | k8s mode — split |
|---|---|---|---|
| Where user apps run | k3d (inside Docker host) | Platform k8s cluster (user namespaces) | Workload cluster |
| How Management API connects | `KUBECONFIG` pointing to k3d | In-cluster service account | External kubeconfig (stored in Vault) |
| `APP_HOST` DNS resolution | Via Traefik passthrough (outer → inner) | Direct k8s Ingress | Direct k8s Ingress on workload cluster |
| Auto DevOps chart | Unchanged | Unchanged | Unchanged |
| CI pipeline vars (`APP_HOST`, etc.) | Unchanged | Unchanged | Unchanged |

From a developer's perspective, their pipeline sees the same variables and deploys to the same Ingress semantics regardless of mode.

---

## 9. Operator UX parity — `dsoctl` as the abstraction layer

`dsoctl` (introduced in milestone 03) gains a deployment backend concept. On initialisation, the operator declares the active mode:

```bash
dsoctl init --mode=compose   # Compose backend
dsoctl init --mode=kubernetes --kubeconfig=~/.kube/config  # k8s backend
```

This sets `deploymentMode` in `~/.dsoctl/config`. All subsequent commands behave identically regardless of mode:

| Command | Compose backend | Kubernetes backend |
|---|---|---|
| `dsoctl status` | `docker compose ps` + health checks | `kubectl get pods -n platform` + health checks |
| `dsoctl apply` | `docker compose up -d` | `helm upgrade --install dsoaas-platform ...` |
| `dsoctl secret rotate <target>` | Vault write + `docker compose up -d <svc>` | Vault write + `kubectl rollout restart deploy/<svc> -n platform` |
| `dsoctl bootstrap` | `docker compose exec` sequences | k8s Job / init-container sequences |
| `dsoctl logs <service>` | `docker compose logs <service>` | `kubectl logs -n platform -l app=<service>` |

The operator never needs to know which backend is active. `dsoctl` handles the translation.

---

## 10. Migration path — Compose → Kubernetes

Migration is a supported, documented operation. It is **not** a "reinstall" — data is preserved. The high-level steps:

### Phase 1 — Pre-migration (while still on Compose)

1. Ensure milestone 03 (operability) is complete: all secrets in Vault, `dsoctl` installed.
2. Run `dsoctl backup` to snapshot Vault data and all `.vols/` bind mounts.
3. Provision the target k8s cluster (in-cloud or on-prem).
4. Run `dsoctl migrate preflight --target=<kubeconfig>` — checks cluster readiness, StorageClass availability, DNS wildcard coverage.

### Phase 2 — Data migration

5. For each stateful service, copy volume data to a PVC on the target cluster:
   - `dsoctl migrate volume gitlab --from=.vols/gitlab --to=pvc/gitlab-data`
   - Same for `mongo`, `minio`, `vault`, `keycloak-db`
6. Install the platform Helm chart in a `platform` namespace in dry-run mode; verify rendered manifests.

### Phase 3 — Cutover

7. Schedule a maintenance window.
8. Stop Compose services: `docker compose down` (data is safe in `.vols/`; already copied to PVCs).
9. `dsoctl apply --mode=kubernetes` — deploys the umbrella chart; services come up reading from the migrated PVCs and Vault.
10. Verify: `dsoctl status`, smoke-test SSO login, deploy a test project end-to-end.
11. Update DNS records to point to the k8s cluster's ingress IP (if changed).

### Phase 4 — Post-migration cleanup

12. Run `dsoctl migrate verify` — checks that all services are healthy and user workloads deploy correctly.
13. Archive the Compose host (don't delete yet — keep as rollback option for 2 weeks).
14. Update `dsoctl` mode: `dsoctl config set deploymentMode=kubernetes`.

Rollback: bring Compose services back up from `.vols/` (data was not deleted, only copied). DNS can be re-pointed in minutes.

---

## 11. Open questions

### Q1 — GitLab sub-chart: Omnibus or official chart for v1?

See §6.3. The recommendation is Omnibus-in-a-Pod for v1 (simpler migration from Compose mode), with the official `gitlab/gitlab` chart deferred to a future milestone.

**Option A**: Omnibus Pod (v1). Trade-off: no GitLab horizontal scaling in k8s mode.
**Option B**: Official chart from day one. Trade-off: much more complex, longer milestone.

**Recommended**: A. Even with Omnibus as a single pod, k8s mode delivers HA for *all other services*, rolling restarts, resource limits, and a migration path. GitLab HA can be a separate milestone.

### Q2 — Single-cluster vs split-cluster as the default

Which topology does `dsoctl init --mode=kubernetes` set up by default?

**Option A**: Same-cluster (simpler, less infra).
**Option B**: Split-cluster (better isolation, closer to production patterns).

**Recommended**: A as the default with B as a documented option. Same-cluster requires less infra and is appropriate for the majority of users adopting k8s mode.

### Q3 — Secrets injection: Vault Agent Injector vs External Secrets Operator (ESO)

**Option A**: Vault Agent Injector. Vault-native, no extra operator. Secrets are rendered to files in-pod; the agent is a sidecar container. Slightly higher per-pod resource overhead.

**Option B**: External Secrets Operator (ESO). Creates native k8s `Secret` objects synced from Vault. Broader chart compatibility (most upstream Helm charts accept k8s Secrets natively without file-reading). Adds ESO as a cluster dependency.

**Recommended**: B. Most upstream charts (bitnami/keycloak, hashicorp/vault, etc.) are designed around k8s Secrets, not arbitrary file mounts. ESO makes the platform's custom secret injection consistent with how the rest of the ecosystem works. ESO can be included as a chart dependency in `dsoaas-platform`.

### Q4 — MinIO in k8s mode: in-cluster or external S3

In Compose mode, MinIO provides S3-compatible object storage for GitLab (artifacts, registry, LFS). In k8s mode, the operator may already have S3 (cloud bucket, Ceph RGW, etc.).

**Option A**: Always deploy in-cluster MinIO in k8s mode (same as Compose mode).
**Option B**: Make MinIO optional; allow operators to provide a `s3.endpoint`, `s3.accessKey`, `s3.secretKey` in `platform-values.yaml`. If provided, skip the MinIO sub-chart.

**Recommended**: B. In-cluster MinIO is the default (same as Compose mode); providing external S3 credentials disables it. The Management API and GitLab already work with any S3-compatible endpoint, so this is a values-file change only.

### Q5 — cert-manager as a chart dependency vs operator-provided

Should `dsoaas-platform` include cert-manager as a sub-chart, or require operators to pre-install it?

**Option A**: Include cert-manager. Simpler for new deployments.
**Option B**: Require pre-installation (like most production charts do). Avoids conflicts on clusters that already run cert-manager.

**Recommended**: B. cert-manager is a cluster-singleton. Bundling it causes conflicts on clusters where it's already installed. `dsoctl init --mode=kubernetes` checks for cert-manager presence and prompts the operator to install it if absent. Version requirement is documented as a prereq.

### Q6 — Namespace layout in same-cluster topology

**Option A**: Platform services and user-workload namespaces share a cluster with minimal isolation (just namespaces).
**Option B**: Add `NodeSelector` + `Taint/Toleration` to dedicate nodes to the platform namespace; add `NetworkPolicy` resources to isolate cross-namespace traffic.

**Recommended**: B as the default in `dsoaas-platform` chart values. The policies are additive — operators on resource-constrained clusters can disable them in `platform-values.yaml`. Shipping with them enabled is the safer default.

---

## 12. Implementation outline

### Track A — Helm chart scaffolding

- [ ] Create `charts/dsoaas-platform/` repository (or directory in monorepo)
- [ ] Write `Chart.yaml` with upstream chart dependencies (traefik, keycloak, postgresql, vault, mongodb, minio, oauth2-proxy)
- [ ] Write `management-api/` sub-chart: Deployment, Service, Ingress, configmap, ESO `ExternalSecret`
- [ ] Write `gitlab/` sub-chart: Omnibus StatefulSet + PVC (v1 approach per Q1)
- [ ] Write `platform` init Jobs (`vault-init`, `keycloak-realm-import`, `gitlab-runner-bootstrap`)
- [ ] Write `templates/namespace.yaml`, `NetworkPolicy`, `ResourceQuota` templates (Q6)
- [ ] Write `values.yaml` with a complete, documented reference — every value has a comment
- [ ] CI: `helm lint`, `helm template` snapshot tests, `ct` (Chart Testing) in pipeline

### Track B — `dsoctl` k8s backend

- [ ] Add `deploymentMode` to `~/.dsoctl/config` (set by `dsoctl init --mode=`)
- [ ] Implement k8s backend for `dsoctl apply` (wraps `helm upgrade --install`)
- [ ] Implement k8s backend for `dsoctl status` (wraps `kubectl get pods`)
- [ ] Implement k8s backend for `dsoctl secret rotate` (adds `kubectl rollout restart` after Vault write)
- [ ] Implement k8s backend for `dsoctl logs`
- [ ] Implement `dsoctl migrate` subcommand (preflight, volume, verify)
- [ ] Implement `dsoctl config set deploymentMode` command
- [ ] Tests: backend-switching integration tests (can use `kind` or `k3d` in CI)

### Track C — ESO integration (Q3)

- [ ] Add `external-secrets` as a chart dependency in `dsoaas-platform`
- [ ] Write `ClusterSecretStore` pointing to Vault (AppRole auth)
- [ ] Write `ExternalSecret` resources for each platform service (one per Vault path)
- [ ] Verify that upstream charts accept k8s Secrets as credential sources (bitnami/keycloak, etc.)
- [ ] Test secret rotation end-to-end: `dsoctl secret rotate` → Vault update → ESO sync → k8s Secret updated → pod rolling restart

### Track D — Compose mode formalisation

- [ ] Add `00_modes.md` to `__DOCS__/`: "when to use Compose vs Kubernetes mode"
- [ ] Restructure `__DOCS__/01_infra/` as Compose mode guide (add mode header, cross-reference k8s guide)
- [ ] Write new `__DOCS__/01_infra_k8s/` section: prerequisites, install, bootstrap, operations for k8s mode
- [ ] Explicit `profiles` in `docker-compose.yml` for optional services (already partially done)
- [ ] Update `Makefile` / `README.md` to reference both modes

### Track E — Migration tooling and documentation

- [ ] Write `dsoctl migrate preflight` (cluster readiness checks)
- [ ] Write `dsoctl migrate volume` (copies `.vols/` data to PVCs via a temporary Job)
- [ ] Write `dsoctl migrate verify` (post-migration smoke tests)
- [ ] Write `__DOCS__/XX_milestone/` or dedicated `__DOCS__/01_infra/08_compose_to_k8s.md` migration guide

---

## 13. Risks & rollback

| Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|
| GitLab Omnibus-in-a-Pod stability in k8s | Medium | High | Test on major k8s distributions (k3s, vanilla, EKS). GitLab Omnibus is designed to run standalone; as a pod it should be equivalent to Compose. Liveness/readiness probes ensure restarts on health failure. | Revert to Compose mode (data preserved in PVCs; can copy back to `.vols/`). |
| PVC data loss during migration | Low | Critical | `dsoctl migrate volume` copies, does not move. Source `.vols/` preserved until operator explicitly deletes. Two-week rollback window. | Restore from `.vols/` and restart Compose. |
| ESO sync delay introduces window where rotated secret hasn't propagated | Low | Medium | ESO refresh interval configurable (default 1h; set to 30s for platform secrets). `dsoctl secret rotate` forces immediate ESO refresh via annotation patch. | Vault prior version still active; pod can restart and read old secret while new one propagates. |
| Helm chart upgrade breaks platform mid-operation | Low | High | `--atomic` flag on `helm upgrade` — rolls back automatically on failure. Always run `dsoctl apply --dry-run` first. | `helm rollback dsoaas-platform <revision>`. |
| Same-cluster topology: noisy-neighbour user workload affects platform | Medium | Medium | `ResourceQuota` + node taints for platform namespace (default, per Q6 recommendation). | Evict misbehaving user pod via `kubectl delete pod`; scale up node pool. |
| cert-manager version conflict (Q5) | Medium | Low | `dsoctl init --mode=kubernetes` checks cert-manager version; warns if incompatible. Chart documents minimum version. | Operator upgrades cert-manager separately; no platform data affected. |
| `dsoctl migrate` volume copy fails midway | Low | Medium | Each volume copy is idempotent — re-running does not corrupt data. Progress is checkpointed. | Re-run `dsoctl migrate volume <service>` for the failed service. |

Master rollback: Compose mode is always available. The Docker host, `.vols/` data, and `.env` are not touched by the migration until the operator explicitly decommissions them. The Compose and Kubernetes deployments can run in parallel (on different hosts or namespaces) during validation.

---

## 14. Appendix

### 14.1 Mode selection guide

| Scenario | Recommended mode |
|---|---|
| Solo operator, home lab, evaluation | Compose |
| Small team (<10 devs), single project | Compose |
| Existing k8s infrastructure | Kubernetes (same-cluster) |
| Multiple teams, need HA | Kubernetes (split-cluster) |
| Air-gapped / on-prem with existing k8s | Kubernetes (same or split) |
| Development / testing the platform itself | Compose |
| Production multi-tenant SaaS delivery | Kubernetes (split-cluster) |

The platform's feature set is identical in all cases. The choice is operational, not functional.

### 14.2 Comparison with industry deployment models

| Platform | Minimal mode | Production mode | Migration path |
|---|---|---|---|
| GitLab | Omnibus (single package) | GitLab Helm chart on k8s | Official migration docs; `gitlab-ctl` → Helm |
| Vault / OpenBao | Dev mode, single binary | Cluster mode, k8s operator | `vault operator raft join`; Helm upgrade |
| OpenStack | DevStack (single host) | TripleO / Kolla (multi-node) | Re-deploy; no live migration |
| OpenShift | CRC (single VM) | Production cluster | Install, then migrate workloads |
| This platform (after milestone) | Compose (single host, current) | Kubernetes (Helm chart) | `dsoctl migrate` tooling |

The key differentiator vs. OpenStack / OpenShift: the same `dsoctl` CLI and the same operator UX work in both modes. In OpenStack, the AIO and multi-node deployments use different tooling chains.

### 14.3 `dsoaas-platform` chart dependency versions (reference at time of authoring)

| Sub-chart | Source | Suggested version |
|---|---|---|
| traefik | `traefik/traefik` | `^31.x` |
| keycloak | `bitnami/keycloak` | `^22.x` |
| postgresql | `bitnami/postgresql` | `^15.x` |
| vault (openbao) | `openbao/openbao` | `^0.x` (track releases) |
| mongodb | `bitnami/mongodb` | `^15.x` |
| minio | `minio/minio` | `^5.x` |
| oauth2-proxy | `oauth2-proxy/oauth2-proxy` | `^7.x` |
| external-secrets | `external-secrets/external-secrets` | `^0.9.x` |
| cert-manager | pre-installed (not bundled — see Q5) | `^1.14` |

All versions are illustrative; pin to tested versions in `Chart.lock` before shipping.

### 14.4 Decision log

| Question | Choice | Date | Rationale |
|---|---|---|---|
| Q1 — GitLab sub-chart | _pending_ | — | — |
| Q2 — Default topology | _pending_ | — | — |
| Q3 — Secrets injection method | _pending_ | — | — |
| Q4 — MinIO: in-cluster vs external | _pending_ | — | — |
| Q5 — cert-manager bundling | _pending_ | — | — |
| Q6 — Same-cluster isolation policies | _pending_ | — | — |

### 14.5 Cross-references

- Platform operability milestone: [03_platform_operability.md](03_platform_operability.md) — prerequisite; provides `dsoctl` and sealed config model
- Operator console milestone: [02_frontend_console.md](02_frontend_console.md) — the console deploys as a regular app in both modes
- Existing k3d setup: `__DOCS__/01_infra/06_k3d_and_k8s.md`
- Current compose file: `docker-compose.yml` in repo root
- v2 migration plan: `MIGRATION_PLAN_v2.md`

---

*Authored: 2026-05-14 · Status: Proposed · See [milestone index](index.md) for graduation criteria.*
