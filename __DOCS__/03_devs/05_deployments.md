# Deployments and URLs

← [Back to Developer Guide](index.md)

When the Management API provisions a **deployable** project, it writes Auto DevOps (or template) CI, seeds Vault, records hostnames in MongoDB, and ensures Kubernetes namespaces exist. Your running service is exposed through **Ingress** inside k3d; the outer Traefik instance forwards `*.apps.<DOMAIN>` / `*.dev.apps.<DOMAIN>` / `*.stg.apps.<DOMAIN>` traffic into the cluster (see [`traefik/dynamic/k3d-passthrough.yml`](../../traefik/dynamic/k3d-passthrough.yml)).

---

## Where your app listens

The **`dsoaas-app`** Helm chart defaults the Service **`targetPort` to 80** so clusters do not need per-repo port overrides. Use **`EXPOSE 80`** and set your process to listen on port **80** inside the container (for Node, `ENV PORT=80` is typical). Older templates that listen on **3000** should either switch to 80 or override chart values consistently. Ingress maps HTTP from inner Traefik to that Service port.

Images default to **`imagePullPolicy: Always`**. Deploys also stamp a unique `dsoaas-deploy-id` annotation so a rebuild that reuses the same tag still rolls pods and pulls the newest digest (important for Vite/BUILD bake fixes).

---

## Hostnames

Typical patterns (exact values come from your project's `appHosts` in MongoDB and CI variables such as `APP_HOST`):

- **Development:** `https://<effectiveSlug>.dev.apps.<DOMAIN>` — **ungated by default.** No platform-level login gate unless your team explicitly registered a gated path (see below); rely on your own application auth for APIs.
- **Staging:** `https://<effectiveSlug>.stg.apps.<DOMAIN>` — same, ungated by default.
- **Production:** `https://<effectiveSlug>.apps.<DOMAIN>` — no platform-level login gate; rely on application auth if needed.

**Opting into platform SSO for a specific path** (e.g. a frontend's UI, not its API): ask platform ops to add a `Host() && PathPrefix()` router to [`traefik/dynamic/oauth2-proxy-apps-gated-paths.yml`](../../traefik/dynamic/oauth2-proxy-apps-gated-paths.yml) in `devsecops-platform` — see [how to gate a new app path](../02_admin/08_oauth2_proxy_tiers_and_forwardauth.md#how-to-gate-a-new-app-path). Only that path prefix on that host requires DSOaaS Keycloak login (groups **`admins`** or **`users`**); everything else on the same host (including your APIs) stays ungated.

---

## Convert a console project to tag deploys

A project created in the operator console deploys when you push the branch stored in `deployRef` (`develop`, `staging`, and `main` unless you changed them). Tag deploys use the same cluster, Vault paths, and CI variables. You change which Git ref starts the deploy job.

The console writes three CI pieces:

| File                                   | What it does today                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Root `.gitlab-ci.yml`                  | Includes `configs/auto-devops-pipeline` file `/.gitlab-ci.yml` (branch gates), plus the two local files below           |
| `.dsoaas/build-jobs.gitlab-ci.yml`     | Turns the stock `build` job off (`when: never`) and adds `build:<image>` when `$CI_COMMIT_BRANCH` equals `DEPLOY_*_REF` |
| `.dsoaas/deploy-targets.gitlab-ci.yml` | Turns stock `deploy:dev`, `deploy:stg`, and `deploy:prod` off, and adds `deploy:<target>-<app>` on the same branch rule |

`APP_HOST`, `KUBECONFIG_B64`, `KUBE_NAMESPACE`, `HELM_RELEASE_NAME`, and `VAULT_PROJECT_PATH` are scoped to `dev-<app>`, `stg-<app>`, and `prod-<app>`. The generated deploy job's `environment.name` matches that scope. You **MUST** keep those environment names. The stock jobs named `dev` / `stg` / `prod` do not see those variables.

### 1. Confirm the tag pipeline is on GitLab

The config project `configs/auto-devops-pipeline` **MUST** contain `/.gitlab-ci.tags.yml`. That file ships in this repo and is copied when the config project is seeded. If the include fails with a missing file, ask an admin to sync `configs/auto-devops-pipeline` before you change the app.

### 2. Point the app at the tag pipeline

In the app's root `.gitlab-ci.yml`, change only the shared-pipeline `file`. Leave the local `.dsoaas` includes and any `test:` job you added.

```yaml
include:
  - project: "system/devsecops-platform/configs/auto-devops-pipeline"
    file: "/.gitlab-ci.tags.yml"
  - local: .dsoaas/deploy-targets.gitlab-ci.yml
    rules:
      - exists:
          - .dsoaas/deploy-targets.gitlab-ci.yml
  - local: .dsoaas/build-jobs.gitlab-ci.yml
    rules:
      - exists:
          - .dsoaas/build-jobs.gitlab-ci.yml
```

That include alone does not deploy on tags. The `.dsoaas` files still wait for a branch and still disable the stock jobs.

With `/.gitlab-ci.tags.yml`, a normal **branch push does not start a pipeline** (no build/test without a tag). Release CI runs when you push a matching tag. To run build/test on every branch push again, set project variable `DSOAAS_RUN_BRANCH_PIPELINES` to `true` (no environment scope). Merge requests and **Run pipeline** in the GitLab UI still run CI without that variable.

### 3. Retarget the generated jobs

Edit the two `.dsoaas` files in the app repo. Do not change job names, `extends`, `variables`, or `environment.name`.

**Builds** (`.dsoaas/build-jobs.gitlab-ci.yml`). Keep `build:` at `when: never`. On each `build:<image>` job, replace the `DEPLOY_*_REF` branch rules with branch builds plus the three tag patterns:

```yaml
build:portal:
  extends: .build-kaniko
  variables:
    KANIKO_DOCKERFILE: "portal.Dockerfile"
    KANIKO_IMAGE_NAME: "portal"
  rules:
    - if: "$CI_COMMIT_BRANCH"
      when: on_success
    - if: "$CI_COMMIT_TAG =~ $DEPLOY_DEV_TAG_PATTERN"
      when: on_success
    - if: "$CI_COMMIT_TAG =~ $DEPLOY_STG_TAG_PATTERN"
      when: on_success
    - if: "$CI_COMMIT_TAG =~ $DEPLOY_PROD_TAG_PATTERN"
      when: on_success
```

**Deploys** (`.dsoaas/deploy-targets.gitlab-ci.yml`). Keep `deploy:dev`, `deploy:stg`, and `deploy:prod` at `when: never`. On each `deploy:<target>-<app>` job, replace the branch rule with that target's tag pattern.

```yaml
deploy:dev-portal:
  extends: .deploy-helm
  resource_group: deploy-dev
  variables:
    DEPLOY_ENV: dev
  environment:
    name: dev-portal
    url: https://$APP_HOST
  rules:
    - if: '$DEPLOY_DEV_TAG_PATTERN == "none"'
      when: never
    - if: "$CI_COMMIT_TAG =~ $DEPLOY_DEV_TAG_PATTERN"
      when: on_success

deploy:prod-portal:
  extends: .deploy-helm
  resource_group: deploy-prod
  variables:
    DEPLOY_ENV: prod
  environment:
    name: prod-portal
    url: https://$APP_HOST
  rules:
    - if: '$DEPLOY_PROD_TAG_PATTERN == "none"'
      when: never
    - if: "$CI_COMMIT_TAG =~ $DEPLOY_PROD_TAG_PATTERN"
      when: manual
      allow_failure: false
```

Use `DEPLOY_STG_TAG_PATTERN` and `when: on_success` for staging jobs. A full commented sample lives in `configs/auto-devops-pipeline/ci/deploy-targets.tags.example.yml`.

Default patterns (already set by the tag pipeline; override under GitLab **Settings → CI/CD → Variables** with no environment scope):

| Tag you push                      | Environment | Trigger       | Variable                                                     |
| --------------------------------- | ----------- | ------------- | ------------------------------------------------------------ |
| `0.166.0-dev.1` or `v1.2.3-dev.1` | dev         | automatic     | `DEPLOY_DEV_TAG_PATTERN` = `/^v?[0-9]+\.[0-9]+\.[0-9]+-dev/` |
| `0.166.0-rc.1` or `v1.2.3-rc.1`   | stg         | automatic     | `DEPLOY_STG_TAG_PATTERN` = `/^v?[0-9]+\.[0-9]+\.[0-9]+-rc/`  |
| `0.166.0` or `v1.2.3`             | prod        | manual (Play) | `DEPLOY_PROD_TAG_PATTERN` = `/^v?[0-9]+\.[0-9]+\.[0-9]+$/`   |

Set a pattern to `none` to disable that environment. In the GitLab UI the prod pattern uses one `$`. You **MAY** leave `DEPLOY_*_REF` as the console wrote them; tag jobs do not read those variables.

The image published from a tag pipeline is the Git tag (`v1.2.3`). Branch builds stay `<short-sha>-<branch>`.

### 4. Push a tag and check the pipeline

```bash
git tag v0.1.0-dev.1
git push origin v0.1.0-dev.1
```

The pipeline **MUST** show `build:<image>` and `deploy:dev-<app>`. A push to `develop` **MUST** still build and **MUST NOT** create a deploy job. `v0.1.0` **MUST** show `deploy:prod-<app>` as a manual job.

Sonar on a tag stays skipped until `SONAR_TOKEN` and `SONAR_ALLOWED_TAGS` are set. `SONAR_ALLOWED_TAGS=*` scans every tag.

### 5. Saving in the console puts branch rules back

A deployment-target save in the operator console rewrites the root include to `/.gitlab-ci.yml` and regenerates both `.dsoaas` files with branch rules. After every console save you **MUST** repeat steps 2 and 3 before the next tag deploy. Custom `test:` jobs outside `include:` are kept.

---

## Verifying a deployment

1. **GitLab pipeline** — the latest pipeline for your default branch should pass build and deploy stages.
2. **Ingress** — in the target namespace (`dev`, `stg`, or `prod`), `kubectl get ingress` should list a host rule matching your app zone.
3. **HTTP check** — from a browser, open the hostname while logged into DSOaaS Keycloak (dev/stg require platform login first). For scripted checks, unauthenticated `curl` to dev/stg URLs returns **302** to Keycloak — use in-cluster probes or authenticated sessions instead.

---

## Troubleshooting

- **404 from inner Traefik** — Ingress host or path does not match the request; confirm chart values and GitLab environment-scoped variables.
- **TLS errors on the public hostname** — outer Traefik certificate SANs must cover your devops and apps zones; check `acme.json` / Traefik logs.
- **Pod not ready** — inspect Deployment events and image pull errors in the namespace.
