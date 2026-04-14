# Shared CI/CD Configs

← [Back to Admin Guide](index.md)

Config repos are shared CI/CD pipeline definitions that can be injected into any project. They let you maintain common pipeline logic — linting, testing, building, publishing, deploying — in one place, and have all your projects automatically benefit from updates to that logic.

They live in a dedicated GitLab group (the one whose ID is set as `GITLAB_CONFIG_GROUP_ID` in `.env`).

---

## How configs work

A config repo is a GitLab project that contains a `.gitlab-ci.yml` file with [hidden jobs](https://docs.gitlab.com/ee/ci/jobs/index.html#hide-a-job) — jobs whose names start with a dot (`.`). Hidden jobs define stages and scripts but don't run by themselves. Project pipelines extend them using GitLab's `extends:` keyword.

When you provision a project with a `configs` field, the platform adds an `include:` directive to the project's `.gitlab-ci.yml` that pulls in the config repo. The result looks like this:

```yaml
# .gitlab-ci.yml in your project
include:
  - project: "configs/node-pipeline"
    file: "/.gitlab-ci.yml"

lint:
  extends: .lint   # from node-pipeline config
  
test:
  extends: .test   # from node-pipeline config
```

Every time the config repo is updated, all projects that include it automatically pick up the changes on their next pipeline run — no changes needed in the individual projects.

---

## Managing configs via the API

**List all available config repos**

```
GET /configs
```

Returns a list of all repositories in the configs GitLab group.

---

**Get a specific config**

```
GET /configs/:slug
```

Returns details for a specific config repo by its slug.

---

**Create a new config repo**

```
POST /configs
```

Creates a GitLab repository in the configs group with an initial `.gitlab-ci.yml` file:

```json
{
  "slug": "node-pipeline",
  "description": "Reusable CI/CD stages for Node.js projects",
  "ciContent": ".lint:\n  stage: lint\n  image: node:20-alpine\n  script:\n    - pnpm install --frozen-lockfile\n    - pnpm run lint\n"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `slug` | Yes | Lowercase identifier for the config repo. |
| `description` | No | Human-readable description. |
| `ciContent` | Yes | The content for the `.gitlab-ci.yml` file with hidden job definitions. |

---

**Update a file in a config repo**

```
PUT /configs/:slug/files
```

Updates (or creates) a file within the config repo and commits the change:

```json
{
  "filePath": ".gitlab-ci.yml",
  "content": ".lint:\n  stage: lint\n  image: node:20-alpine\n  ...",
  "commitMessage": "chore: update lint stage to use pnpm v9"
}
```

This is how you roll out updates to all projects that use this config — update the file here, and every project's next pipeline run will use the new version.

---

**Delete a config repo**

```
DELETE /configs/:slug
```

Deletes the config repo from GitLab. Projects that include it will start failing their pipelines on the next run because the `include:` reference will no longer resolve. Make sure to remove the include directive from any projects that depend on it before deleting.

---

## Injecting configs during project creation

When calling `POST /projects`, include a `configs` field with the slugs you want to inject:

```json
{
  "clientName": "acme",
  "projectName": "webapp",
  "templateSlug": "nestjs-app",
  "configs": ["node-pipeline", "docker-pipeline"]
}
```

The platform will add `include:` directives for both config repos to the project's `.gitlab-ci.yml` at creation time. The injection is idempotent — if an include already exists, it's not added twice.

---

## Current limitations

Config injection only happens at project creation time via `POST /projects`. If you create a config repo after a project already exists, you'd need to manually add the `include:` directive to the project's `.gitlab-ci.yml`. There's no endpoint to inject configs into an existing project.

Config updates are not versioned — there's no way to pin a project to a specific version of a config or test a config change in isolation before rolling it out to all projects.
