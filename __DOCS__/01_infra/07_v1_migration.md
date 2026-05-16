# Importing legacy v1 projects (operator workflow)

← [Back to Infra Guide](index.md)

Phase 5 in this repository already executed the production cutover from the Kong-era stack to Traefik + k3d + Auto DevOps. You should **not** need a bulk “migrate v1” run on a normal install.

This page exists for the rare case where you are **importing state from an older platform** (for example restoring GitLab projects that were never registered in the Management API MongoDB, or finishing a partial migration). There is **no automated `migrate-v1` script** in the Makefile by design — the workflow is API-driven and must be applied per project.

---

## Prerequisites

- Management API running with a valid `API_KEY` and `GITLAB_ROOT_TOKEN` in `.env`.
- Projects you intend to migrate are represented in MongoDB with `legacyV1: true` (the API’s startup reconciliation can create these rows for GitLab projects that exist but were never provisioned through v2).
- GitLab Runner is registered and able to run pipelines for the target groups.

---

## Discover legacy projects

Use GraphQL (Sandbox at `http://127.0.0.1:<API_HOST_PORT>/graphql` in development, or your deployed API URL) with the `X-API-Key` header:

```graphql
query {
  projects(filter: { legacyV1: true }, page: 0, perPage: 50) {
    id
    gitlabPath
    projectSlug
    legacyV1
  }
}
```

Note each `id` (MongoDB ObjectId string) you plan to migrate.

---

## Migrate one project

For each `id`, call:

```graphql
mutation {
  migrateProjectToAutoDevops(id: "<PROJECT_ID_FROM_QUERY>") {
    id
    gitlabPath
    legacyV1
    effectiveSlug
  }
}
```

The resolver runs `ProjectsService.migrateProjectToAutoDevops`: it rewrites `.gitlab-ci.yml` toward the shared Auto DevOps include, aligns CI variables, and clears `legacyV1` when the operation succeeds. If the project is not marked legacy, the mutation fails fast.

---

## After the mutation

1. Open the GitLab project pipeline for the default branch and confirm stages complete.
2. Verify dev/stg/prod hostnames from the Management API `projects` query or admin docs.
3. For compose-only v1 workloads, decommission old compose stacks separately (outside this repo) once traffic has moved.

---

## Makefile pointer

`make migrate-v1` prints the path to this file and exits successfully — it is a **documentation pointer**, not an automation step.
