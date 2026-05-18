# Monorepo CI — Multiple Apps in One GitLab Project

← [Back to Developer Guide](index.md)

Some repositories ship more than one deployable surface from a single GitLab project. The **datahub-fe** workspace (Nx + Angular) is the reference case: **admin** and **satudata** are separate apps with separate Docker images, while **tests and Sonar** run once for the whole repo.

This page explains how that maps onto **Auto DevOps v2**, what is configured today (build + test, no deploy), and how to add **per-app deploy** later.

---

## When to use this pattern

| Situation | Approach |
|---|---|
| One app, one container, one hostname | Default Auto DevOps (root `Dockerfile`, single `build` job) |
| Multiple apps, shared libs, one repo | This guide — multiple Kaniko jobs + shared `test` / `sonar:scan` |
| Apps that must scale or release independently in production | Same repo is fine; use **separate images** and **separate deployment targets** (or separate GitLab projects if teams need hard isolation) |

---

## How Auto DevOps v2 fits

Your repo root `.gitlab-ci.yml` only needs to **include** the platform pipeline:

```yaml
include:
  - project: system/devsecops-platform/configs/auto-devops-pipeline
    file: .gitlab-ci.yml
```

That template provides:

1. **build** — Kaniko (one image per job)
2. **test** — placeholder (override in your repo)
3. **deploy** — Helm (`dsoaas-app` chart), gated by `DEPLOY_*_REF` branch variables
4. **sonar:scan** — optional static analysis
5. Security templates (SAST, secret detection, container scanning)

For a monorepo you **override** the default `build` job and add one Kaniko job per app. The shared template supports optional variables (since platform chart `0.2.3` / pipeline update):

| Variable | Default | Monorepo example |
|---|---|---|
| `KANIKO_DOCKERFILE` | `Dockerfile` | `admin.Dockerfile` |
| `KANIKO_IMAGE_NAME` | *(empty)* | `admin` → image `…/registry/project/admin:sha` |

---

## datahub-fe layout (reference)

```
datahub-fe/
  admin.Dockerfile          # builds admin SPA → nginx
  satudata.Dockerfile       # builds satudata SPA → nginx
  nginx-pwa.conf            # SPA routing for both images
  .gitlab-ci.yml            # include + overrides (see repo)
  sonar-project.properties  # workspace-wide Sonar paths
  apps/admin/               # Nx app
  apps/satudata/            # Nx app
  package.json              # build:prod:admin, build:prod:satudata, nx test
```

**Package scripts** (root `package.json`):

- `pnpm run build:prod:admin` — production build for admin
- `pnpm run build:prod:satudata` — production build for satudata
- `pnpm exec nx run-many -t test -p admin,satudata` — unit tests for both apps

Legacy per-app `.gitlab-ci.yml` under `apps/*` (Docker-in-Docker, SSH deploy) is **not** used with Auto DevOps v2. The root `.gitlab-ci.yml` replaces that model.

---

## Current pipeline behaviour (build + test, no deploy)

The datahub-fe `.gitlab-ci.yml` (in your GitLab clone) does the following.

### Disable deploy

All deploy refs are set to the sentinel `none` so no `deploy:dev` / `deploy:stg` / `deploy:prod` jobs run:

```yaml
variables:
  DEPLOY_DEV_REF: "none"
  DEPLOY_STG_REF: "none"
  DEPLOY_PROD_REF: "none"
```

### Separate builds

| Job | Dockerfile | Registry image |
|---|---|---|
| `build:admin` | `admin.Dockerfile` | `$CI_REGISTRY_IMAGE/admin:$CI_COMMIT_SHORT_SHA` |
| `build:satudata` | `satudata.Dockerfile` | `$CI_REGISTRY_IMAGE/satudata:$CI_COMMIT_SHORT_SHA` |

The default `build` job is disabled (`when: never`) because there is no single root `Dockerfile` for the whole monorepo.

### Shared test and Sonar

The `test` job uses **`docker:24` as the CI image** and runs Node/pnpm inside `docker run node:20-bookworm …`. Do not set `image: node:20-bookworm` on the job itself — GitLab Runner 18.10 can fail prepare environment with `gitlab-runner-build: not found` when the job image is Node and the helper is pulled in the same phase (Kaniko build jobs are unaffected).

| Job | What it runs |
|---|---|
| `test` | `nx run-many -t test -p admin,satudata` with coverage artifacts (via nested `node:20-bookworm` container) |
| `sonar:scan` | Platform Sonar job; runs in parallel with `test` (not skipped on test failure). Lcov from `test` is only present when tests pass in the same pipeline. |

**Container scanning** is turned off for now (`container_scanning: when: never`) because the template expects a single `CS_IMAGE`. Re-enable per image when you add custom scan jobs.

### Security scans

SAST and secret detection still run from the included templates (repo-wide).

---

## GitLab CI variables to set

In **Settings → CI/CD → Variables** for the datahub-fe project:

| Variable | Required for | Notes |
|---|---|---|
| `SONAR_TOKEN` | Sonar | Masked; from platform admin |
| `SONAR_ALLOWED_BRANCHES` | Sonar | e.g. `main,staging,develop` |
| `SONAR_HOST_URL` | Dashboard links | Public Sonar URL |
| `KUBECONFIG_B64`, `APP_HOST`, … | Deploy only | Skip until you enable deploy |

No deploy variables are needed while `DEPLOY_*_REF` are `none`.

---

## Build-time environment (config scripts)

Production builds run `config:admin` / `config:satudata` before `nx build`. Those scripts need at least:

- `NX_ENV=production` (selects `environment.prod.ts`)
- `NX_REGION_CODE`, `NX_API_URL`, `NX_ADMIN_URL`, `NX_SATUDATA_URL`, `NX_OPENDATA_URL`, `NX_SATUPETA_URL`

`admin.Dockerfile` and `satudata.Dockerfile` set **safe CI defaults** via `ARG`/`ENV` so Kaniko builds succeed without a monolithic `ENV` blob.

#### Vault env profiles (recommended for per-branch URLs)

Instead of hard-coding build args in `.gitlab-ci.yml`, use **BUILD** env profiles in the Management UI:

1. Upload a dotenv file per app with keys matching Dockerfile `ARG` names (any prefix — the platform does not filter keys).
2. Set **job selector** to `admin` or `satudata` (same value as `KANIKO_IMAGE_NAME`).
3. Set **branches** to the refs you build from (e.g. `main`).

The pipeline loads profiles in **every** job that uses `.load-vault-env` (build, test, sonar, deploy). `dotenv_build_args` keys are exported as shell variables in that job and passed to Kaniko as `--build-arg` on build jobs. For a custom `test` job, prepend:

```yaml
before_script:
  - !reference [.load-vault-env, before_script]
  # … your install steps
```

Alternatively use **raw file** delivery to write a config file under `workspacePath/filename`.

Override real URLs per environment with Kaniko build args when you wire deploy manually, for example:

```yaml
build:admin:
  extends: .build-kaniko
  variables:
    KANIKO_DOCKERFILE: "admin.Dockerfile"
    KANIKO_IMAGE_NAME: "admin"
  # Example — pass through GitLab CI variables as build-args (requires Kaniko extra flags or Dockerfile ENV from CI)
```

If a Kaniko build fails during `config:*` or `nx build`, open the `build:admin` / `build:satudata` job log; missing or invalid env vars are the most common cause.

---

## Local verification (before push)

From the repo root (same commands the Dockerfiles use):

```bash
corepack enable && corepack prepare pnpm@latest --activate
pnpm install --frozen-lockfile

# Builds (match CI)
pnpm run build:prod:admin
pnpm run build:prod:satudata

# Tests (match CI)
export NODE_OPTIONS=--max_old_space_size=8192
pnpm exec nx run-many -t test -p admin,satudata --parallel=2 --ci --code-coverage
```

Docker build locally:

```bash
docker build -f admin.Dockerfile -t datahub-admin:local .
docker build -f satudata.Dockerfile -t datahub-satudata:local .
```

---

## Enabling deploy later (one app per target)

The platform Helm deploy job assumes **one release name** (`CI_PROJECT_NAME`) and **one image** per deploy. For two apps in one GitLab project you have two supported patterns.

### Pattern A — Two deployment targets (same GitLab project)

Use the Management API (or manual wiring) to add targets, e.g. `admin` and `satudata`, each with:

- Its own `APP_HOST` (env-scoped CI variables)
- `EXTRA_HELM_ARGS` pointing at the correct image, for example:

  ```text
  --set image.repository=$CI_REGISTRY_IMAGE/admin
  ```

- Generated deploy jobs in `.dsoaas/deploy-targets.gitlab-ci.yml` (API-managed projects)

You will also need **separate Helm release names** (e.g. `datahub-admin`, `datahub-satudata`) — today the template uses `CI_PROJECT_NAME` only. Until the chart/pipeline supports `HELM_RELEASE_NAME` per target, options are:

- **Two GitLab projects** (simplest operationally), or
- **Custom deploy jobs** in `.gitlab-ci.yml` that extend `.deploy-helm` with `helm upgrade --install datahub-admin …` and a different `--set image.repository`

### Pattern B — Two GitLab projects

Split `admin` and `satudata` into separate repos (or mirror subtrees). Each gets the default single-`Dockerfile` pipeline. Use this if teams want independent permissions, pipelines, and Sonar project keys.

### chart-values per app

Commit optional overrides next to the Dockerfiles, e.g. `chart-values-admin.yaml`, and pass them in custom deploy:

```yaml
helm upgrade --install datahub-admin … --values chart-values-admin.yaml
```

Typical SPA overrides:

```yaml
service:
  targetPort: 80
probes:
  liveness:
    path: /
  readiness:
    path: /
```

---

## Checklist after changing CI

1. Push `.gitlab-ci.yml`, Dockerfiles, and `sonar-project.properties`.
2. Push platform pipeline change if your runner uses a pinned include ref (project uses `main` / default branch of `auto-devops-pipeline`).
3. Open **CI/CD → Pipelines** — expect stages: `build` (2 jobs), `test`, security jobs, `sonar:scan` (if vars set), **no** deploy.
4. Confirm images under **Deploy → Container Registry**: `…/admin:tag` and `…/satudata:tag`.

---

## Related docs

- [Manual onboarding](06_manual_onboarding.md) — include line, `DEPLOY_*_REF=none`, CI variables
- [Deployments](05_deployments.md) — how Helm deploy works for single-app projects
- [Repo and CI/CD](02_repo_and_ci.md) — finding your GitLab project and reading pipeline logs
