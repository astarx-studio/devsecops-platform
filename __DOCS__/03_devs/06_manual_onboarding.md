# Manual Onboarding — Opt Into Deployment Without the API

← [Back to Developer Guide](index.md)

Most projects on this platform are created through the Management API, which scaffolds everything for you. But you can also bring an existing repository (or create a new one in GitLab directly) and opt it into the shared deployment pipeline by hand. This page is the step-by-step recipe.

---

## When to use this

Use manual onboarding when:

- You already have a repository and want to add deployment without re-provisioning it.
- You want a special CI flow (custom stages, alternate triggers, monorepo paths) that doesn't fit the API's defaults. See [Monorepo / multi-app CI](07_monorepo_multi_app_ci.md) for multiple images in one repository.
- You're experimenting outside the API's managed group path (e.g., a personal scratch project).
- You don't have access to the Management API for some reason (no API key, the API is down, etc.).

Use the API (`mutation createProject`) instead when:

- You want the platform to track the project (it appears in `query { projects }`, gets reconciled, can be migrated/listed).
- You want the GitLab group hierarchy and Vault seeds and Kubernetes namespaces taken care of automatically.
- The project will be long-lived and managed by an admin.

Manual-onboarded projects work fine — they get the same build / deploy / Ingress flow as API-managed ones — they just aren't recorded in the platform's MongoDB registry. The API can't see them, and you take on the small bit of setup the API would otherwise do for you.

---

## Prerequisites

Before you start, you need:

- A **GitLab account** (Keycloak-backed) and permission to create or push to the project.
- A **`Dockerfile`** in your repo. The pipeline uses Kaniko to build container images and requires a Dockerfile at the project root.
- **CI variable values from your platform admin** — specifically `KUBECONFIG_B64` for each environment you want to deploy to. These can be copied from the values already set on the `configs` GitLab group, or generated from `.vols/kubeconfigs/kubeconfig-{env}.yaml` on the platform host.

If you don't have admin access to the runner kubeconfig, ask your platform admin for the three base64 strings (one per env: dev, stg, prod).

---

## The recipe

There are four steps. After all four, every push to a trigger branch produces a build and, where matching, a deploy.

### Step 1 — Repository files

Add these to your repo root:

```
your-project/
  Dockerfile                # required
  .gitlab-ci.yml            # required
  chart-values.yaml         # optional — per-app Helm overrides
```

A minimal `.gitlab-ci.yml` opts you into the platform's shared pipeline:

```yaml
include:
  - project: "system/devsecops-platform/configs/auto-devops-pipeline"
    file: "/.gitlab-ci.yml"
```

That single `include:` gives you the same three stages that API-provisioned projects get:

1. **build** — Kaniko builds your Dockerfile and pushes to the GitLab Container Registry.
2. **test** — Placeholder that succeeds by default. Override it in your `.gitlab-ci.yml` to run real tests.
3. **deploy** — `helm upgrade --install` into the matching k3d namespace, but only when the branch matches one of the configured deploy refs (see [step 4](#step-4--push-to-a-trigger-branch)).

The shared pipeline also brings GitLab's SAST, Secret Detection, and Container Scanning jobs in the `test` stage.

`chart-values.yaml` is optional. It's where you override Helm chart defaults for things like container port, probes, replica count, or resource limits. The chart's project metadata (path, env, host) is injected by the pipeline at deploy time — don't duplicate it here. A typical NestJS override:

```yaml
service:
  targetPort: 3000

probes:
  liveness:
    path: /health
  readiness:
    path: /health

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 512Mi
```

### Step 2 — CI variables (env-scoped)

The pipeline needs four variables per environment. Set them in GitLab project → **Settings → CI/CD → Variables** → **Add variable**. For each, expand the **Environment scope** field and pick `dev`, `stg`, or `prod` so the right value is selected when the right deploy job runs.

| Key | Value (dev example) | Env scope | Masked |
|---|---|---|---|
| `KUBE_NAMESPACE` | `dev` | `dev` | no |
| `APP_HOST` | `your-project.dev.apps.<DOMAIN>` | `dev` | no |
| `VAULT_PROJECT_PATH` | `projects/playground/your-project` | `dev` | no |
| `KUBECONFIG_B64` | *(see note below)* | `dev` | **yes** |

For BUILD-time env profiles (Management API uploads), the API also sets these **global** (no env scope) variables:

| Key | Purpose |
|---|---|
| `VAULT_ADDR` | Vault API URL for CI |
| `VAULT_TOKEN` | Read token for env profile paths under `VAULT_PROJECT_PATH` |

Repeat for `stg` and `prod` scopes. The prod row's `APP_HOST` drops the env prefix (e.g., `your-project.apps.<DOMAIN>`), while dev and stg use `*.dev.apps.<DOMAIN>` and `*.stg.apps.<DOMAIN>` respectively.

#### About `KUBECONFIG_B64`

This variable holds a base64-encoded kubeconfig pointing at the platform's k3d cluster, scoped to a `gitlab-deployer` service account in the matching namespace. It's the credential the deploy job uses to run `helm upgrade`.

The platform's `bootstrap/runner-rbac.sh` script sets `KUBECONFIG_B64` on the `configs` GitLab group at three env scopes. **Project-level CI variables only inherit from the project's own group hierarchy** — so projects that aren't descended from `configs/` (i.e., almost all real projects) don't automatically receive this value. You need to copy it in by hand.

Two ways to obtain the value:

1. **Copy from the `configs` group** — In GitLab, browse to `configs` → Settings → CI/CD → Variables. Find `KUBECONFIG_B64` for the env scope you want, click the eye icon to reveal, and paste the value into your project's variable.

2. **Generate from the host** — If you have shell access to the platform server:

   ```bash
   base64 -w0 < .vols/kubeconfigs/kubeconfig-dev.yaml
   ```

   The output is the variable value. Repeat for `kubeconfig-stg.yaml` and `kubeconfig-prod.yaml`.

Treat these values like passwords — they grant deploy permission into the named namespace. Always mark the variable as **Masked** in GitLab.

### Step 3 — Vault secrets (optional)

If your application reads secrets at runtime (database URL, API keys, signing keys, etc.), seed them in Vault. The platform's `dsoaas-app` Helm chart creates an `ExternalSecret` per release that pulls from a specific Vault path, and ESO syncs it into a K8s `Secret` that your pod consumes via `envFrom`.

The Vault path is whatever you set as `VAULT_PROJECT_PATH` in Step 2, with the environment appended. For the dev example above, that's:

```
secret/data/projects/playground/your-project/dev
```

To write secrets from the platform host:

```bash
docker exec -e VAULT_TOKEN="$VAULT_ROOT_TOKEN" vault \
  vault kv put secret/projects/playground/your-project/dev \
    DATABASE_URL=postgres://... \
    API_KEY=...
```

Every key you write becomes an environment variable in the running pod — no further wiring needed. The chart's Deployment uses `envFrom: secretRef`, so all keys flow through automatically. Pods automatically restart when Vault values change, thanks to the platform's Reloader install (typically within `refreshInterval`, default 5 minutes).

You can also leave the Vault path empty. For **static frontends** that bake config at build time only, disable runtime injection in `chart-values.yaml`:

```yaml
externalSecret:
  enabled: false
```

API-managed projects set this automatically when you have no RUNTIME env profiles.

#### Branch-scoped env profiles (Management API)

If you use the Management API, admins can upload env/config files per branch without committing them to Git:

| Phase | When it applies | Typical use |
|---|---|---|
| **BUILD** | Kaniko image build | Dotenv → Docker `ARG`s, or a raw file at `workspacePath/filename` (e.g. `application.properties`) |
| **RUNTIME** | Running pod | Key/value pairs merged into Vault at `{VAULT_PROJECT_PATH}/{targetKey}` and synced via ExternalSecret |

- **Branches** — exact `CI_COMMIT_REF_NAME` (e.g. `main`, `develop`).
- **Deployment targets** — RUNTIME profiles select one or more target keys (`dev`, `stg`, `prod`, or custom keys like `prod-alt`). Vault path is always `{VAULT_PROJECT_PATH}/{targetKey}`; the deploy job sets `DEPLOY_ENV` to that key.
- **Monorepos** — optional `jobSelector` matches `KANIKO_IMAGE_NAME` so each build job loads only its profiles.

BUILD profiles require global CI variables `VAULT_ADDR`, `VAULT_TOKEN`, and `VAULT_PROJECT_PATH` (set by the API at provision time). The pipeline hook `.load-vault-env` runs in **build, test, sonar, and deploy** jobs:

- **`dotenv_build_args`** — keys become **shell environment variables** in that job (and Kaniko `--build-arg` in build jobs).
- **`raw_file`** — file is written under the repo workspace in that job (each job reloads from Vault).

Override jobs must re-include the hook if you replace `before_script`:

```yaml
before_script:
  - !reference [.load-vault-env, before_script]
```

Monorepo jobs can set `ENV_PROFILE_JOB_SELECTOR` (or `KANIKO_IMAGE_NAME` on build jobs) to match profile `jobSelector`. GitLab security template jobs (SAST, etc.) are separate includes and do not load Vault profiles unless you add the hook there too.

For hand-onboarded repos without the API, seed Vault manually as above, or ask an admin to register the project so uploads go through `uploadEnvProfile`.

### Step 4 — Push to a trigger branch

The shared pipeline maps branch names to environments by exact equality. By default:

| Branch | Environment | Trigger |
|---|---|---|
| `develop` | dev | auto on push |
| `staging` | stg | auto on push |
| `main` | prod | **manual** (click "Play" in the GitLab pipeline UI) |
| anything else | none | builds and tests run; no deploy |

So to trigger your first dev deploy:

```bash
git checkout -b develop
git add .
git commit -m "initial deploy"
git push origin develop
```

Watch the pipeline under GitLab project → **CI/CD → Pipelines**. The deploy job logs end with `Deployed your-project to dev at https://your-project.dev.apps.<DOMAIN>` on success. The URL should answer within a minute or two of the job finishing.

---

## Customising deployment behaviour

### Use different branch names

The default branches (`develop`, `staging`, `main`) are just env-var defaults. Override per-project by setting CI variables (Settings → CI/CD → Variables, no env scope needed):

```
DEPLOY_DEV_REF  = trunk
DEPLOY_STG_REF  = release/staging
DEPLOY_PROD_REF = release/prod
```

Now pushing to `trunk` deploys to dev, and so on.

### Disable a specific environment

Set that target’s `DEPLOY_*_REF` CI variable to **`none`** (the only supported disable keyword). The shared pipeline and generated `.dsoaas/deploy-targets.gitlab-ci.yml` jobs skip deploy when the ref is `none`.

Via the Management API:

```graphql
mutation {
  upsertDeploymentTarget(
    id: "<mongo-project-id>"
    input: { targetKey: "prod", enabled: false, teardownK8sOnDisable: true }
  ) { id deploymentTargets { key deployRef enabled } }
}
```

Or in GitLab: **Settings → CI/CD → Variables** → set `DEPLOY_PROD_REF` = `none`.

### Custom deployment targets (e.g. prod-alt)

Use `upsertDeploymentTarget` with a new `targetKey` (DNS label, e.g. `prod-alt`). The API seeds Vault, env-scoped CI variables, ensures the namespace on the chosen cluster profile, and commits **`.dsoaas/deploy-targets.gitlab-ci.yml`** with a matching `deploy:prod-alt` job.

### Register an existing GitLab repo

When the repository already exists in GitLab:

```graphql
mutation {
  registerGitLabProject(input: {
    gitlabProjectId: 12345
    capabilities: { deployable: true }
  }) { id gitlabPath deploymentTargets { key appHost deployRef enabled } }
}
```

### Manual approval on dev too

```yaml
deploy:dev:
  rules:
    - if: '$CI_COMMIT_BRANCH == $DEPLOY_DEV_REF'
      when: manual
```

Now even pushes to the dev branch require a click before they deploy.

### Pattern-matching branches

The default rules use `==` exact equality. To deploy any `feature/*` branch to dev, override:

```yaml
deploy:dev:
  rules:
    - if: '$CI_COMMIT_BRANCH =~ /^feature\/.*$/'
      when: on_success
    - if: '$CI_COMMIT_BRANCH == "develop"'
      when: on_success
```

Beware: multiple feature branches share the same Helm release name (`$CI_PROJECT_NAME`) and so collide on the same K8s Deployment in `dev`. The last push wins. For true per-branch review apps, you'd extend the chart with a per-branch release suffix — out of scope here.

### Re-running a deployment

- Retry the failed job: GitLab pipeline view → ↻ on the job.
- Re-run the whole pipeline: ↻ on the pipeline header.
- Trigger without a code change: `git commit --allow-empty -m "redeploy" && git push`.
- Trigger from UI: GitLab → **CI/CD → Pipelines → Run pipeline**, pick the branch.

### Disable CI entirely for one push

Add `[skip ci]` to the commit message. Useful for doc-only edits.

---

## Troubleshooting

**Pipeline never starts after a push**

Confirm the GitLab Runner is alive (project → **Settings → CI/CD → Runners** shows at least one green/active runner). If the branch you pushed doesn't match any deploy ref, the pipeline runs build + test only — that's expected, not a bug.

**`deploy:*` job logs say `error: kubeconfig file not found` or `helm: no available release name`**

`KUBECONFIG_B64` is missing for that env scope. In GitLab → project → Settings → CI/CD → Variables, check that `KUBECONFIG_B64` exists with the right Environment scope (`dev`, `stg`, or `prod`). Re-do step 2.

**`deploy:*` says `Error: namespace "xxx" not found`**

The cluster doesn't have that namespace. The platform's bootstrap creates `dev`, `stg`, `prod` by default. If you're using non-standard env names, ask your admin to create matching namespaces and `gitlab-deployer` ServiceAccount + RBAC there.

**Pod stuck in `CrashLoopBackOff` after deploy with `envFrom: secret "your-project" not found`**

The `ExternalSecret` hasn't materialised the K8s Secret yet, or you haven't seeded any Vault values at the expected path. Check:

```bash
kubectl --kubeconfig=<your dev kubeconfig> -n dev \
  describe externalsecret your-project
```

The status should show `Ready: true`. If not, the message usually says why — typical causes: Vault path empty (seed at least one key), `ClusterSecretStore` not ready (platform issue, ping admin), or the `VAULT_PROJECT_PATH` CI variable doesn't match what's in Vault.

**Application URL returns 404 from outer Traefik**

Either the Ingress doesn't exist (check `kubectl -n dev get ingress`), or its `host:` doesn't match what you typed. Confirm the `APP_HOST` CI variable produced the host you expected by checking the deploy job's logs near the `--set ingress.host=...` line.

**Deploy succeeds, app appears, but `https://your-project.dev.apps.<DOMAIN>` shows a TLS error**

Outer Traefik's wildcard cert covers `*.apps.<DOMAIN>`, `*.dev.apps.<DOMAIN>`, and `*.stg.apps.<DOMAIN>`. If your hostname doesn't match the wildcard pattern (e.g., you used `your.project.dev.apps.<DOMAIN>` with a dot in the slug), the cert won't cover it. Pick a host that fits the single-label wildcard.

---

## SonarQube opt-in

The shared pipeline includes a **`sonar:scan`** job (stage `test`). It runs only when you set project CI variables (Settings → CI/CD → Variables):

| Variable | Required | Example |
|---|---|---|
| `SONAR_ALLOWED_BRANCHES` | Yes (comma-separated) | `develop,staging,main` |
| `SONAR_TOKEN` | Yes | Analysis token from Sonar UI (masked) |
| `SONAR_HOST_URL` | Recommended | `https://sonarqube.devops.yourdomain.com` |
| `SONAR_HOST_URL_INTERNAL` | Optional | `http://sonarqube:9000` (default in template) |
| `SONAR_GATE_POLICY_JSON` | Optional | `{"dev":"optional","stg":"required","prod":"required","other":"optional"}` |

**Defaults when `SONAR_GATE_POLICY_JSON` is omitted:** dev branch (`DEPLOY_DEV_REF`) = optional gate; staging and production refs = required; any other branch = optional.

Each allowed branch is analyzed as a separate Sonar project key: `{project_path_slug}_{branch_slug}` (Community Build workaround for multi-branch analysis).

**Vault:** Manual onboarding usually stores the token only in GitLab. API-managed projects also copy the token to Vault under `projects/<path>/sonar` for rotation.

**Shared defaults:** Optional baseline `sonar-project.properties` lives in the `configs/sonar-defaults` GitLab repo — copy into your app root or merge the exclusions you need.

**Commit status:** Passing or failing Quality Gate appears on the commit as `sonarqube/quality-gate` with a link to the Sonar dashboard.

---

## When to migrate to API-provisioned

Manual onboarding is fine indefinitely, but the API gives you a few things you can't easily get back later:

- The project appears in `query { projects }` and can be listed/filtered by env, group path, capabilities.
- Audit log entries for create / delete / migration events.
- Per-env secret seeding via `envScopedVars`.
- Hostname overrides via `setHostnameOverride` mutation (no manual CI variable juggling).

If you decide to "promote" a manual-onboarded project to API-managed later, run the **`reconcileGitLabProjects`** mutation (Management UI: **Detect from GitLab** on the Projects list) — your project shows up as `legacyV1: true` with `provisioning: 'template'`. From there, you can either accept the legacy state or run additional API mutations to update the record. This scan does **not** run automatically when the API restarts.

---

## See also

- [Your day-to-day workflow](01_workflow_overview.md) — the big picture of working on the platform.
- [GitLab repos and CI/CD](02_repo_and_ci.md) — pipeline anatomy and runner basics.
- [Secrets](04_secrets.md) — how Vault secrets flow into your application.
- [Deployments](05_deployments.md) — what happens after a successful build, URL conventions, troubleshooting.
