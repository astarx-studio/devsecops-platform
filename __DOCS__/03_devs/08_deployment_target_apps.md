# Deployment targets — per-app build and deploy

One **deployment target** (e.g. `dev`, `prod`, `prod-alt`) can host multiple **apps** in a single GitLab project. Each app has its own Dockerfile path, container image suffix, ingress host, Kaniko build job, Helm release, and env-scoped CI variables.

Use the operator console **Deployment targets** dialog (**App builds** section) or the `upsertDeploymentTarget` GraphQL mutation.

---

## Data model

| Level                    | Fields                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Target                   | `targetKey`, `kubeNamespace`, `clusterProfile`, `deployRef`, `enabled`, `teardownK8sOnDisable`       |
| App (min one per target) | `name`, `image`, `dockerfile` (optional, default `Dockerfile`), `host` (resolved on save if omitted) |

**Host derivation** (platform `appsDomain`):

- Non-prod: `<appName>.<targetKey>.apps.<appsDomain>`
- `prod` target only: `<appName>.<appsDomain>`
- Custom keys such as `prod-alt` use the non-prod pattern.

**Helm release name:** `{effectiveSlug}-{image}` when `image` differs from the project slug; otherwise `{effectiveSlug}`.

**GitLab CI variable scope:** `{targetKey}-{appName}` (e.g. `dev-admin`).

---

## GraphQL example

```graphql
mutation {
  upsertDeploymentTarget(
    id: "<mongo-project-id>"
    input: {
      targetKey: "prod"
      deployRef: "main"
      kubeNamespace: "production"
      clusterProfile: PROD
      enabled: true
      teardownK8sOnDisable: true
      apps: [
        {
          name: "portal"
          image: "portal"
          dockerfile: "portal.Dockerfile"
          host: "portal.apps.example.com"
        }
        { name: "reports", image: "reports", dockerfile: "reports.Dockerfile" }
      ]
    }
  ) {
    id
    appsDomain
    deploymentTargets {
      key
      apps {
        name
        image
        host
        dockerfile
      }
    }
  }
}
```

Empty `host` on an app is filled by the API using the derivation rules above.

---

## What the API syncs to GitLab

| File                                   | Content                                                                                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.dsoaas/build-jobs.gitlab-ci.yml`     | `build:<image>` Kaniko jobs; disables default `build` via `rules: [{ when: never }]`                                                                                       |
| `.dsoaas/deploy-targets.gitlab-ci.yml` | `deploy:<target>-<app>` jobs; disables template `deploy:dev` / `deploy:stg` / `deploy:prod` when per-app jobs exist for that target                                        |
| Root `.gitlab-ci.yml`                  | **Only** the top-level `include:` list is managed; other keys (`test:`, `variables:`, custom `build:*`) are preserved                                                      |
| GitLab CI/CD variables                 | Per-app: `APP_HOST`, `EXTRA_HELM_ARGS`, `HELM_RELEASE_NAME`, `KUBE_NAMESPACE`, `VAULT_PROJECT_PATH`, `DEPLOY_ENV`, `KUBECONFIG_B64`; global per target: `DEPLOY_<KEY>_REF` |

All `.dsoaas/*` fragment updates and the root `include:` merge are pushed in **one Git commit** per save (one pipeline run).

The shared pipeline (`configs/auto-devops-pipeline`) uses `HELM_RELEASE_NAME` (fallback `CI_PROJECT_NAME`) for `helm upgrade`, status, and rollback.

---

## Standard targets with multiple apps

When `dev`, `stg`, or `prod` have `apps[]`, the API:

- Writes per-app deploy jobs and build jobs (not a single shared `deploy:prod` with one host).
- Disables the stock `deploy:dev` / `deploy:stg` / `deploy:prod` jobs in the generated fragment so they do not collide with per-app jobs.

Vault runtime paths remain `{vaultBasePath}/{targetKey}` for all apps in that target (not per-app yet).

---

## Legacy projects

Targets saved before `apps[]` exist are migrated on read to one synthetic app: name and image = `effectiveSlug`, dockerfile = `Dockerfile`, host = `appHost`.

---

## Troubleshooting CI sync

| Symptom                                                         | Cause                                                                            | Recovery                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Pipeline fails on `.dsoaas/deploy-targets.gitlab-ci.yml`        | Malformed generated YAML (fixed in API: disable block must precede per-app jobs) | Rebuild **api**, re-save the deployment target in the console                                    |
| Custom `test:` jobs disappeared from root `.gitlab-ci.yml`      | Full-file YAML parse failed and merge fell back to managed-only                  | Restore root file from Git history, fix syntax, re-save target; check console **ciSyncWarnings** |
| Console shows a yellow warning after Save                       | Root file was not updated or line-based include merge was used                   | Read the warning text; verify `test:` and `!reference` blocks in GitLab                          |
| Duplicate `build:<image>` in `.dsoaas/build-jobs.gitlab-ci.yml` | Same image listed on dev, stg, and prod (fixed: one Kaniko job per image)        | Rebuild **api**, re-save a deployment target                                                     |
| Multiple `# Managed by DSOaaS` lines in root `.gitlab-ci.yml`   | Repeated fallback merges stacked headers (fixed: strip before merge)             | Re-save target after **api** rebuild, or clean up headers once in Git                            |
| Removed all targets but dev/stg/prod return in the console      | Empty `deploymentTargets: []` was treated as missing (fixed)                     | Rebuild **api**; removing last target keeps the list empty                                       |

---

## Related docs

- [Monorepo / multi-app CI](./07_monorepo_multi_app_ci.md) — manual YAML patterns and verification
- [Management API](../02_admin/05_management_api.md) — mutations and CI variable keys
- [Manual onboarding](./06_manual_onboarding.md) — branch overrides and preserved root CI
