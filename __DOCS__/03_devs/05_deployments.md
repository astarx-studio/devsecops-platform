# Deployments (v2 — Auto DevOps + k3d)

← [Back to Developer Guide](index.md)

This page describes how applications are deployed **after Phase 5** of the v2 migration: **GitLab Auto DevOps**, the **`configs/auto-devops-pipeline`** template, Helm to **k3d (Kubernetes)**, and **Traefik in-cluster Ingress**. The legacy v1 model (per-project Docker Compose on the host + Kong routes) has been retired from the default stack.

---

## What the platform provisions for you

When the Management API creates a project with **`provisioning: AUTO_DEVOPS`**, it:

1. Creates the GitLab project and CI/CD variables (`KUBE_NAMESPACE`, `APP_HOST`, `VAULT_PROJECT_PATH`, `KUBECONFIG_B64`, …).
2. Commits a minimal **`.gitlab-ci.yml`** that **includes** the shared pipeline from **`configs/auto-devops-pipeline`** and a **`chart-values.yaml`** for optional Helm overrides.
3. Seeds **Vault** paths per environment (`dev`, `stg`, `prod`) so **External Secrets Operator** can sync a Kubernetes `Secret` for your pods.

Your app image should listen on **container port 80** (`EXPOSE 80`, and for Node **`ENV PORT=80`**) so it matches the default **`dsoaas-app`** Helm chart (`service.targetPort: 80`) without extra port overrides.

---

## How a deploy works

1. **Build** — CI builds your container image and pushes it to the **GitLab Container Registry**.
2. **Security jobs** — SAST / secret detection / container scanning run as configured in the pipeline; artifacts go to **object storage** (MinIO in local dev).
3. **`deploy:<env>`** — The pipeline writes kubeconfig from CI variables, ensures the namespace, creates a short-lived **docker-registry pull secret** so the cluster can pull your image, then runs **`helm upgrade --install`** against the **OCI-published `dsoaas-app`** chart (`CHART_VERSION` in the pipeline must match a published chart tag).

Ingress is **`IngressClass: traefik`** inside the cluster. **TLS is terminated at the outer Traefik** (Docker Compose); in-cluster Traefik receives plain HTTP with the original `Host` header.

---

## URLs and environments

| Environment | Typical hostname pattern | Git branch (default convention) |
|-------------|--------------------------|----------------------------------|
| Development | `{slug}.dev.apps.<DOMAIN>` | `develop` |
| Staging     | `{slug}.stg.apps.<DOMAIN>` | `staging` |
| Production  | `{slug}.apps.<DOMAIN>`     | `main` (often manual deploy) |

Exact **`APP_HOST`** values are set per project by the API as CI variables.

---

## What you maintain in the repo

| File | Purpose |
|------|---------|
| `.gitlab-ci.yml` | `include:` from `configs/auto-devops-pipeline` — do not fork the whole pipeline unless you must. |
| `chart-values.yaml` | Optional Helm overrides (resources, probes, `extraEnv`). Avoid duplicating `project.*` or `ingress.host`; the pipeline sets those via `--set`. |
| `Dockerfile` | Production-oriented image; **listen on port 80** for consistency with the chart defaults. |

---

## Troubleshooting (short)

- **`ImagePullBackOff`** — The pipeline creates `gitlab-registry-secret` in the deploy namespace; if deploys still fail, confirm the cluster can reach the registry and that **`CHART_VERSION`** matches a chart version published to the OCI registry.
- **`SecretSyncedError` / ExternalSecret** — Check Vault path **`{VAULT_PROJECT_PATH}/{env}`** exists and **Kubernetes auth** in Vault is configured (`bootstrap/vault-k8s-auth.sh`).
- **`UPGRADE FAILED: another operation … pending-*`** — The pipeline includes a pre-flight rollback for stuck Helm releases; if needed, **`helm uninstall <release> -n <ns>`** clears a bad state.
- **404 at app URL from the internet** — Confirm **outer Traefik** routes for `*.dev.apps.<DOMAIN>` (see `traefik/dynamic/k3d-passthrough.yml`) and that in-cluster Traefik is reachable (**NodePort** bootstrap in `bootstrap/charts/traefik-values.yaml`).

For platform services (GitLab, Vault, Keycloak, Management API, OAuth callback host), HTTPS is routed **directly by Traefik** to each container (**Phase 5 — Kong removed**); only **application** traffic for `*.dev.apps.*` / `*.stg.apps.*` / `*.apps.*` uses the k3d passthrough file.

---

## Legacy v1 (reference only)

v1 used **Kong** plus **`deploy-compose`** pipelines and per-project containers on the host Docker network. That path is no longer part of the default `docker-compose.yml`. If you still operate a **pinned v1** project, your admin keeps a reduced stack or custom routing until migration is complete.
