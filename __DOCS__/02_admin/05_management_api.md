# Management API

← [Back to Admin Guide](index.md)

The Management API automates project setup: GitLab repository or Auto DevOps project, Vault secrets, MongoDB registry records, and Kubernetes preparation for deployable workloads. **GraphQL** at `POST /graphql` is the supported interface for creates, deletes, and other mutations. REST exposes **read-only** project listing plus **deprecated** stubs that return **410 Gone** for legacy `POST`/`DELETE /projects` callers.

For the full controller and DTO reference (including GraphQL behaviour and deprecation payloads), see the maintainer guide: [Management API (maintainer)](../99_maintainers/03_management_api.md).

## Checking that the API is healthy

Visit `https://api.devops.yourdomain.com/health` in a browser. A healthy stack returns:

```json
{"status":"ok","mongo":"ok","vault":"ok"}
```

If `status` is `degraded`, check MongoDB connectivity and Vault (`mongo` / `vault` fields). Tail logs with:

```bash
docker compose logs -f api
```

---

## Authentication

The API supports two authentication methods:

**API key** — Include your API key in a header on every request:

```
X-API-Key: your-api-key-here
```

The API key is set in `.env` as `API_KEY`. If you've left that variable empty, the API runs without authentication (useful during development, but not recommended for a running platform).

**OIDC/JWT** — If you're calling the API from a browser or another service using Keycloak SSO, you can pass a JWT bearer token instead:

```
Authorization: Bearer <token>
```

---

## GraphQL (`POST /graphql`)

Use Apollo-compatible clients against **`POST /graphql`**. The schema is code-first from the NestJS module under `api/src/projects/graphql/`.

**Primary mutations** include `createProject`, `registerGitLabProject`, `upsertDeploymentTarget`, `removeDeploymentTarget`, `setDeploymentTargetHostname`, `deleteProject`, `migrateProjectToAutoDevops`, Sonar config, and audit queries.

Example `createProject` variables (illustrative):

```json
{
  "input": {
    "clientName": "acme",
    "projectName": "webapp",
    "templateSlug": "nestjs-app",
    "capabilities": { "deployable": {} }
  }
}
```

**What happens (high level):**

1. GitLab groups and project are created or forked.
2. CI includes are merged when `configs` are requested.
3. Vault paths under `projects/...` are seeded.
4. For deployable projects: namespaces / CI variables / pipeline triggers run per `ProjectsService`.
5. A `Project` document is stored in MongoDB.

Non-critical steps (for example optional pipeline triggers) log warnings without failing the whole mutation—see service logs for detail.

---

## REST compatibility

**List projects**

```
GET /projects
```

Returns Mongo-backed `ProjectResponseDto` objects (document `id` is the MongoDB ObjectId string).

**Get one project**

```
GET /projects/:id
```

`:id` must be a MongoDB ObjectId. Returns `404` when missing.

**Legacy writes (deprecated)**

```
POST /projects
DELETE /projects/:id
```

Return **410 Gone** with JSON fields `message`, `graphqlEndpoint`, and `hint` pointing callers to the GraphQL mutations.

---

## Capabilities (GraphQL / REST DTOs)

The `capabilities` object controls optional HTTP hosting and package publishing metadata.

**`deployable`** — HTTP application with per-environment hostnames driven by Auto DevOps + k3d Ingress (no compose-level gateway).

**`publishable`** — Adds GitLab package registry metadata.

Projects may set **both**, **one**, or **neither** capability.

---

## Deployment targets

Each project has a **`deploymentTargets`** array (not limited to dev/stg/prod). Standard keys `dev`, `stg`, and `prod` map to the shared pipeline jobs; extra keys (e.g. `prod-alt`) get a generated job in **`.dsoaas/deploy-targets.gitlab-ci.yml`**.

| Mutation | Purpose |
| -------- | ------- |
| `upsertDeploymentTarget` | Enable/disable a target, set branch ref, sync Vault + GitLab CI, optional K8s teardown when disabling |
| `removeDeploymentTarget` | Remove target from registry, tear down K8s, delete env-scoped CI vars |
| `setDeploymentTargetHostname` | Override `APP_HOST` for any target key |

**Deploy deactivation:** set `DEPLOY_<KEY>_REF` to **`none`** (only this value). The API uses `none` when a target is disabled.

**`registerGitLabProject`:** adopt an existing GitLab project by numeric `gitlabProjectId` (409 if already registered). Optionally wires Auto DevOps the same as `createProject`. Use `branchOptions` (`defaultBranch`, per-env `deployRefs`, or `useDefaultBranchForAllDeployTargets`) when the repo does not use `main` / `develop` / `staging`.

**`migrateProjectToAutoDevops`:** optional `input.branchOptions` with the same shape — overrides deploy refs before CI sync and triggers the pipeline on `defaultBranch` (falls back to the GitLab project default branch).

**`reconcileGitLabProjects`:** scan GitLab for projects not in MongoDB and backfill them as `legacyV1: true` with minimal Vault seeding (no deploy wiring). Also archives active registry rows when GitLab marks the project for deletion. **Not run on API startup** — call explicitly from the Management UI or GraphQL when you want detection.

**`deleteProject`:** tears down **all** deployment targets in K8s, deletes Vault, removes the MongoDB record, then attempts GitLab project delete **without** bulk registry/package purge. If GitLab refuses deletion (artifacts in use elsewhere), the API logs a warning and still unregisters the project from the platform.

---

## Making API requests

```bash
# Example: list projects (REST)
curl https://api.devops.yourdomain.com/projects \
  -H "X-API-Key: your-api-key"

# Example: GraphQL query (shape depends on your schema)
curl -X POST https://api.devops.yourdomain.com/graphql \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"query":"mutation($input:CreateProjectInput!){ createProject(input:$input){ id gitlabPath } }","variables":{"input":{"clientName":"acme","projectName":"webapp","templateSlug":"nestjs-app"}}}'
```

Interactive **Swagger** for the REST shim lives at `https://api.devops.yourdomain.com/api/docs`. Use **Apollo Sandbox** (non-production) or an IDE plugin for GraphQL.

---

## Current limitations

Provisioning mutations run synchronously in the request thread—there is no external job queue.

Template versioning is minimal: projects do not auto-track template semver bumps.

Deletion is best-effort across GitLab, Vault, and MongoDB; verify unusual projects manually if a step logs warnings.
