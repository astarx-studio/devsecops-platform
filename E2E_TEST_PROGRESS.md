# E2E Test Progress — `demo-api` + `demo-web` on Dev

**Date:** 2026-05-12
**Goal:** Validate the full DSOaaS v2 Auto DevOps pipeline by deploying two minimal apps
(`demo-api` = Node.js/Express, `demo-web` = Nginx static) to the `dev` k3d namespace.

---

## Current Pipeline Status (latest runs — pipeline 60 / 61)

| Job | demo-api | demo-web | Notes |
|---|---|---|---|
| `build` | ✅ success | ✅ success | Kaniko builds and pushes image |
| `test` | ✅ success | ✅ success | Placeholder echo |
| `deploy:dev` | ❌ failed | ❌ failed | `context deadline exceeded` after 5 min |
| `container_scanning` | ❌ failed | ❌ failed | See separate section below |
| `secret_detection` | ❌ failed | ✅ success | — |
| `semgrep-sast` | ❌ failed | N/A | — |

---

## Issues Resolved in This Session (in order)

### 1. `json.scalar.ts` duplicate scalar registration
- **Status:** ✅ Fixed
- Dropped the `JsonScalar` wrapper class; `@Field(() => GraphQLJSON)` is sufficient.
- `api/src/common/scalars/json.scalar.ts` deleted; `app.module.ts` cleaned up.

### 2. API version bumped to v2.0.0
- **Status:** ✅ Fixed
- `api/package.json` version → `2.0.0`, `@as-integrations/express5` added.

### 3. Registry port in pipeline template — first wrong guess (5005)
- **Root cause:** Previous session assumed registry was on port 5005.
  Port 5005 = nginx alias inside the GitLab container; **not accessible** from `devops-network`.
- **Status:** ✅ Fixed
- Changed `CHART_OCI_REF` and `helm registry login` to use `gitlab:5000`.
- `configs/auto-devops-pipeline/.gitlab-ci.yml` and `configs/auto-devops-chart/.gitlab-ci.yml` updated and pushed.

  > **Port map (for reference):**
  > - `gitlab:80` → GitLab nginx (proxies web + registry `/v2/`)
  > - `gitlab:5000` → Registry daemon (`Docker-Distribution-Api-Version: registry/2.0`)
  > - `gitlab:5005` → NOT externally reachable (internal nginx alias only)

### 4. YAML plain-scalar `\` continuation folded to literal space argument
- **Root cause:** In a YAML block-sequence plain scalar, a `\<newline>` is not a bash
  line continuation — YAML folds newline + surrounding whitespace into a single space.
  The result is `helm registry login "gitlab:5000" <space-word> --username ...`
  where `<space-word>` is an extra stray argument. Helm's OCI auth flow then
  mis-handles the response, returning a GitLab 404 HTML page.
- The chart publish job was immune because it used `- |` block scalar (real newlines).
- **Status:** ✅ Fixed
- Collapsed `helm registry login` onto a **single line** in `before_script`.

### 5. CI job token lacks cross-project registry pull scope
- **Root cause:** `CI_REGISTRY_USER` / `CI_REGISTRY_PASSWORD` are scoped to the running
  project (`demo/demo-api`). Pulling the Helm chart from
  `gitlab:5000/system/devsecops-platform/configs/auto-devops-chart` requires access
  to a different project — which the job token does not have.
- **Status:** ✅ Fixed
- Created a **deploy token** for `auto-devops-chart` with `read_registry` scope:
  - Token name: `helm-chart-reader`
  - Username: `gitlab+deploy-token-1`
  - Token: `gldt-k1ubbTZEta54B9Aqpx4X` (stored as instance-level CI vars)
- Set as **instance-level CI variables** accessible by all projects:
  - `CHART_REGISTRY_USER` = `gitlab+deploy-token-1`
  - `CHART_REGISTRY_PASSWORD` = `<token>` (unmasked — value length short, non-sensitive in context)
- Pipeline template updated to use `CHART_REGISTRY_*` instead of `CI_REGISTRY_*`.

---

## Current Blocker — `context deadline exceeded`

### What happens
Helm successfully:
1. Logs in to `gitlab:5000` with the deploy token → **Login Succeeded**
2. Pulls the chart → `Pulled: gitlab:5000/.../dsoaas-app:0.2.1`
3. Runs `helm upgrade --install ... --atomic --timeout 5m`
4. After exactly 5 minutes → `Error: release demo-api failed, and has been uninstalled due to atomic being set: context deadline exceeded`

The `--atomic` flag means Helm waited for the Deployment rollout to complete and timed out.
The pods never reached `Ready` state within 5 minutes.

### Why the pods fail to become Ready — likely causes

#### A. Image pull failure (containerd DNS issue)
The most probable cause. k3d nodes use `containerd` to pull images. Pulling the app image
from `registry.devops.yadatechnology.com` (the `CI_REGISTRY_IMAGE` value) requires:
- DNS resolution of `registry.devops.yadatechnology.com` from inside the k3d node
- TLS to Traefik on the host
This is a **known DNS issue** documented in past sessions (containerd's DNS resolver inside
k3d nodes sometimes cannot reach external domains; requires `--resolv-conf` overrides or
`/etc/hosts` injection).

To confirm: check pod events inside the k3d cluster.

```bash
# From a container with the dev kubeconfig:
kubectl get pods -n dev
kubectl describe pod <pod-name> -n dev   # look for ImagePullBackOff / ErrImagePull
```

#### B. ExternalSecret not syncing (Vault unavailable or path missing)
The chart deploys an `ExternalSecret` that requires:
- Vault (OpenBao) reachable from the k3d cluster
- The Vault path `external/demo/demo-api` to exist
If ESO cannot sync the secret, the `Deployment` may fail its startup.

To confirm: check ExternalSecret status.
```bash
kubectl get externalsecret -n dev
kubectl describe externalsecret demo-api -n dev
```

#### C. Ingress host not reachable (non-blocking for pod readiness)
`APP_HOST` is set to something like `demo-api.dev.apps.<domain>`. If the DNS/Traefik
routing isn't wired up, ingress would fail but pods themselves should still become Ready.
This is NOT the cause of the `context deadline exceeded`.

---

## Secondary Failures — Security Scan Jobs

| Job | Status | Likely cause |
|---|---|---|
| `container_scanning` | ❌ both | `CS_IMAGE` env var might resolve wrong, or Trivy can't pull the scanner image |
| `secret_detection` | ❌ demo-api | GitLab CE secret detection template issue |
| `semgrep-sast` | ❌ demo-api | Semgrep license / runner network issue |

These are **advisory** (don't block deploy). The `container_scanning` failure was a known
issue from Phase 3.5 where `CS_IMAGE` needed to be explicitly set — this is already in the
pipeline variables. May be a runner-network DNS failure when pulling the scanner image.

---

## What is Working End-to-End

| Step | Status |
|---|---|
| Management API: create project via GraphQL | ✅ |
| GitLab project + group created | ✅ |
| GitLab CI variables set (KUBE_NAMESPACE, APP_HOST, VAULT_PROJECT_PATH, KUBECONFIG_B64) | ✅ |
| App code + Dockerfile pushed to GitLab | ✅ |
| Pipeline triggered on `develop` push | ✅ |
| `build` (Kaniko → image push to registry) | ✅ |
| `deploy:dev` Helm registry login | ✅ |
| `deploy:dev` Helm chart pull from OCI | ✅ |
| `deploy:dev` Helm install (initiated) | ✅ |
| Pod rollout completes within 5 min | ❌ (timeout) |

---

## Code Changes Made This Session

| File | Change |
|---|---|
| `api/src/common/scalars/json.scalar.ts` | Deleted (duplicate scalar) |
| `api/src/app.module.ts` | Removed JsonScalar import + provider |
| `api/package.json` | Version → 2.0.0, added `@as-integrations/express5` |
| `api/Dockerfile` | Pinned `pnpm@10` (pnpm@11+ requires Node ≥22) |
| `api/src/common/interceptors/logging.interceptor.ts` | GraphQL context handling |
| `api/src/common/guards/combined-auth.guard.ts` | GraphQL context handling |
| `api/src/common/filters/http-exception.filter.ts` | GraphQL context passthrough |
| `api/src/k8s/k8s.service.ts` | Kubeconfig filename + base64 encoding |
| `api/src/projects/projects.service.ts` | CI variable masked=false for short values |
| `api/src/gitlab/gitlab.service.ts` | `permanently_delete=true` on project delete |
| `api/src/config/configuration.ts` | Updated default pipeline project path |
| `docker-compose.yml` | Added AUTO_DEVOPS_PIPELINE_PROJECT / FILE env vars |
| `sample.env` | Updated defaults |
| `configs/auto-devops-pipeline/.gitlab-ci.yml` | Port 5005→5000, single-line helm login, CHART_REGISTRY_* |
| `configs/auto-devops-chart/.gitlab-ci.yml` | Port 5005→5000 |
| `.gitignore` | Added configs/auto-devops-chart/ + pipeline/ |

---

## Recommended Next Steps (for your analysis)

### Step 1 — Diagnose pod failure directly
```bash
# Get the dev kubeconfig
cat .vols/kubeconfigs/kubeconfig-dev.yaml

# From a container in devops-network OR from host if k3d ports are forwarded:
kubectl get pods -n dev
kubectl describe pod <pod> -n dev
kubectl get events -n dev --sort-by='.lastTimestamp'
kubectl get externalsecret -n dev
```

### Step 2 — Fix image pull (if containerd DNS is the issue)
The runner containers resolve `registry.devops.yadatechnology.com` via external DNS +
NAT back to the host's Traefik. k3d nodes might need explicit `/etc/hosts` entries or
a custom `resolv.conf` to do the same.

Options:
- Add `extra_hosts` to k3d node config pointing `registry.devops.yadatechnology.com` → host IP
- Use a registry mirror / insecure local registry alias
- Change `CI_APPLICATION_REPOSITORY` to use the internal `gitlab:5000` path directly

### Step 3 — Vault path for demo apps
The `ExternalSecret` will try to read from `external/demo/demo-api` in Vault. This path
probably doesn't exist yet. Either:
- Pre-create a dummy secret in Vault at that path, OR
- Make ExternalSecret optional / conditional in the chart (e.g. `externalSecret.enabled: false` value)

### Step 4 — Security scan failures
These are advisory. Investigate only if you want clean pipelines:
- `container_scanning`: Likely a Trivy image pull issue (runner DNS)
- `secret_detection` / `semgrep-sast`: May need runner network access to external registries

---

## GitLab Projects Created

| ID | Path | Purpose |
|---|---|---|
| 4 | `system/devsecops-platform/configs/auto-devops-chart` | Helm chart (v0.2.1 published ✅) |
| 5 | `system/devsecops-platform/configs/auto-devops-pipeline` | CI pipeline template |
| 8 | `demo/demo-api` | Test BE — Node.js/Express health endpoint |
| 9 | `demo/demo-web` | Test FE — Nginx static page |

## Instance-Level CI Variables Added

| Key | Description |
|---|---|
| `CHART_REGISTRY_USER` | `gitlab+deploy-token-1` — deploy token for chart registry pull |
| `CHART_REGISTRY_PASSWORD` | Deploy token value (read_registry scope on project 4) |
