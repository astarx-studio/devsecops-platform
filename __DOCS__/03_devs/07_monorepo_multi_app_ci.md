# Monorepo CI — Multiple Apps in One GitLab Project

← [Back to Developer Guide](index.md)

Some repositories ship more than one deployable surface from a single GitLab project. A typical **Nx monorepo** ships **portal** and **reports** (or similar) as separate apps with separate Docker images, while **tests and Sonar** run once for the whole repo.

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
| `KANIKO_DOCKERFILE` | `Dockerfile` | `portal.Dockerfile` |
| `KANIKO_IMAGE_NAME` | *(empty)* | `portal` → image `…/registry/project/portal:sha` |

---

## Example monorepo layout

```
example-monorepo/
  portal.Dockerfile         # builds portal SPA → nginx
  reports.Dockerfile        # builds reports SPA → nginx
  nginx-pwa.conf            # SPA routing for both images
  .gitlab-ci.yml            # include + overrides (see repo)
  sonar-project.properties  # workspace-wide Sonar paths
  apps/portal/              # Nx app
  apps/reports/             # Nx app
  package.json              # build:prod:portal, build:prod:reports, nx test
```

**Package scripts** (root `package.json`):

- `pnpm run build:prod:portal` — production build for portal
- `pnpm run build:prod:reports` — production build for reports
- `pnpm exec nx run-many -t test -p portal,reports` — unit tests for both apps

Legacy per-app `.gitlab-ci.yml` under `apps/*` (Docker-in-Docker, SSH deploy) is **not** used with Auto DevOps v2. The root `.gitlab-ci.yml` replaces that model.

---

## Current pipeline behaviour (build + test, no deploy)

Your repo root `.gitlab-ci.yml` (in the GitLab clone) typically does the following.

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
| `build:portal` | `portal.Dockerfile` | `$CI_REGISTRY_IMAGE/portal:$CI_COMMIT_SHORT_SHA` |
| `build:reports` | `reports.Dockerfile` | `$CI_REGISTRY_IMAGE/reports:$CI_COMMIT_SHORT_SHA` |

The default `build` job is disabled (`rules: [{ when: never }]`) because there is no single root `Dockerfile` for the whole monorepo.

### Shared test and Sonar

The `test` job uses **`docker:24` as the CI image** and runs Node/pnpm inside `docker run node:20-bookworm …`. Do not set `image: node:20-bookworm` on the job itself — GitLab Runner 18.10 can fail prepare environment with `gitlab-runner-build: not found` when the job image is Node and the helper is pulled in the same phase (Kaniko build jobs are unaffected).

| Job | What it runs |
|---|---|
| `test` | `nx run-many -t test -p portal,reports` with coverage artifacts (via nested `node:20-bookworm` container) |
| `sonar:scan` | Platform Sonar job; runs in parallel with `test` (not skipped on test failure). Lcov from `test` is only present when tests pass in the same pipeline. |

**Container scanning** is turned off for now (`container_scanning: when: never`) because the template expects a single `CS_IMAGE`. Re-enable per image when you add custom scan jobs.

### Security scans

SAST and secret detection still run from the included templates (repo-wide).

---

## GitLab CI variables to set

In **Settings → CI/CD → Variables** for the GitLab project:

| Variable | Required for | Notes |
|---|---|---|
| `SONAR_TOKEN` | Sonar | Masked; from platform admin |
| `SONAR_ALLOWED_BRANCHES` | Sonar | e.g. `main,staging,develop` |
| `SONAR_HOST_URL` | Dashboard links | Public Sonar URL |
| `KUBECONFIG_B64`, `APP_HOST`, … | Deploy only | Skip until you enable deploy |

No deploy variables are needed while `DEPLOY_*_REF` are `none`.

---

## Build-time environment (config scripts)

Production builds run `config:portal` / `config:reports` before `nx build`. Those scripts need at least:

- `NX_ENV=production` (selects `environment.prod.ts`)
- App-specific URLs and region keys (names depend on your Nx workspace)

`portal.Dockerfile` and `reports.Dockerfile` set **safe CI defaults** via `ARG`/`ENV` so Kaniko builds succeed without a monolithic `ENV` blob.

#### Vault env profiles (recommended for per-branch URLs)

Instead of hard-coding build args in `.gitlab-ci.yml`, use **BUILD** env profiles in the Management UI:

1. Upload a dotenv file per app with keys matching Dockerfile `ARG` names (any prefix — the platform does not filter keys).
2. Set **job selector** to `portal` or `reports` (same value as `KANIKO_IMAGE_NAME`).
3. Set **branches** to the refs you build from (e.g. `main`).

The pipeline loads profiles in **every** job that uses `.load-vault-env` (build, test, sonar, deploy). `dotenv_build_args` keys are exported as shell variables in that job and passed to Kaniko as `--build-arg` on build jobs. For a custom `test` job, prepend:

```yaml
before_script:
  - !reference [.load-vault-env, before_script]
  # … your install steps
```

For `sonar:scan` with test artifacts, extend the platform job and **keep** its work-dir `before_script`:

```yaml
sonar:scan:
  extends: .sonar-scan
  dependencies: [test]
  needs:
    - job: test
      artifacts: true
  before_script:
    - !reference [.sonar-scan, before_script]
    - # verify coverage.xml / sonar-project.properties
```

Alternatively use **raw file** delivery to write a config file under `workspacePath/filename`.

Override real URLs per environment with Kaniko build args when you wire deploy manually, for example:

```yaml
build:portal:
  extends: .build-kaniko
  variables:
    KANIKO_DOCKERFILE: "portal.Dockerfile"
    KANIKO_IMAGE_NAME: "portal"
  # Example — pass through GitLab CI variables as build-args (requires Kaniko extra flags or Dockerfile ENV from CI)
```

If a Kaniko build fails during `config:*` or `nx build`, open the per-app build job log; missing or invalid env vars are the most common cause.

---

## Local verification (before push)

From the repo root (same commands the Dockerfiles use):

```bash
corepack enable && corepack prepare pnpm@latest --activate
pnpm install --frozen-lockfile

# Builds (match CI)
pnpm run build:prod:portal
pnpm run build:prod:reports

# Tests (match CI)
export NODE_OPTIONS=--max_old_space_size=8192
pnpm exec nx run-many -t test -p portal,reports --parallel=2 --ci --code-coverage
```

Docker build locally:

```bash
docker build -f portal.Dockerfile -t portal:local .
docker build -f reports.Dockerfile -t reports:local .
```

---

## Deploying multiple apps (operator console / API)

Use **Deployment targets** in the operator console with one or more **App builds** rows per target (same model as a monorepo in one GitLab project).

For each app the Management API syncs:

| Artifact | Purpose |
|---|---|
| `.dsoaas/build-jobs.gitlab-ci.yml` | `build:<image>` Kaniko jobs; disables default `build` |
| `.dsoaas/deploy-targets.gitlab-ci.yml` | `deploy:<target>-<app>` jobs; disables template `deploy:dev` / `deploy:stg` / `deploy:prod` when per-app jobs exist |
| GitLab CI variables (scope `dev-portal`, etc.) | `APP_HOST`, `EXTRA_HELM_ARGS`, `HELM_RELEASE_NAME`, `KUBECONFIG_B64`, … |
| Root `.gitlab-ci.yml` | Managed `include:` only — **user jobs such as `test:` are preserved** |

Per-app Helm release name defaults to `{effectiveSlug}-{image}` (or `{effectiveSlug}` when image equals the project slug). The shared pipeline reads `HELM_RELEASE_NAME` (fallback `CI_PROJECT_NAME`).

Example: target `dev` with apps `portal` and `reports` on branch `develop` produces jobs `build:portal`, `build:reports`, `deploy:dev-portal`, `deploy:dev-reports`, and two reachable hostnames.

### Manual-only alternative

Without the API, set env-scoped `EXTRA_HELM_ARGS` and `HELM_RELEASE_NAME` yourself and add custom `deploy:*` / `build:*` jobs. Prefer the console to avoid clobbering root `.gitlab-ci.yml` overrides.

Full API field reference: [Deployment target apps](./08_deployment_target_apps.md).

### Two GitLab projects

Split apps into separate repos when teams need hard isolation (permissions, Sonar keys, independent lifecycles).

### chart-values per app

Commit optional overrides next to the Dockerfiles, e.g. `chart-values-portal.yaml`, and pass them in custom deploy:

```yaml
helm upgrade --install myapp-portal … --values chart-values-portal.yaml
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
4. Confirm images under **Deploy → Container Registry**: `…/portal:tag` and `…/reports:tag`.

---

## Related docs

- [Manual onboarding](06_manual_onboarding.md) — include line, `DEPLOY_*_REF=none`, CI variables
- [Deployments](05_deployments.md) — how Helm deploy works for single-app projects
- [Repo and CI/CD](02_repo_and_ci.md) — finding your GitLab project and reading pipeline logs
