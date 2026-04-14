# Templates

← [Back to Admin Guide](index.md)

Templates are the starting points that developers get when a new project is provisioned. When someone calls `POST /projects`, the platform forks a template repository into the client's GitLab group and gives the developer a working project structure with CI pipelines, a Dockerfile, and whatever else the template includes.

Templates live in a dedicated GitLab group. By default, this is the group whose numeric ID you set as `GITLAB_TEMPLATE_GROUP_ID` in `.env`.

---

## What a template is

A template is just a regular GitLab repository in the templates group. The naming convention is that its path (slug) is what you reference in provisioning requests. For example, a repo named `nestjs-app` under the templates group is referenced as `"templateSlug": "nestjs-app"` in `POST /projects`.

Templates can contain whatever you want — a `Dockerfile`, a pre-configured `.gitlab-ci.yml`, a `docker-compose.yml`, boilerplate source code, documentation, etc. The platform will fork the entire repository as-is. Developers then modify the code, not the project structure.

---

## Managing templates via the API

**List all available templates**

```
GET /templates
```

Returns a list of all repositories in the templates GitLab group.

---

**Get a specific template**

```
GET /templates/:slug
```

Returns details for a specific template by its slug (e.g. `nestjs-app`).

---

**Register a new template**

```
POST /templates
```

Creates a new GitLab repository in the templates group. You can optionally provide initial file content to pre-populate the repo:

```json
{
  "slug": "nestjs-app",
  "description": "Production-ready NestJS starter with Docker, CI/CD, and health checks",
  "files": {
    ".gitlab-ci.yml": "include:\n  - project: \"configs/node-pipeline\"\n    file: \"/.gitlab-ci.yml\"\n",
    "Dockerfile": "FROM node:20-alpine\nWORKDIR /app\n"
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `slug` | Yes | Lowercase identifier for the template. Becomes the GitLab repo path. |
| `description` | No | Human-readable description of what this template is for. |
| `files` | No | Map of file paths to content. If omitted, the repo is initialized with a README only. |

After creating a template via the API, you can push additional content to it using standard `git push` just like any GitLab repository.

---

**Delete a template**

```
DELETE /templates/:slug
```

Deletes the template repository from GitLab. This does not affect projects that were already forked from it — those are independent repositories.

---

## Example: creating a template manually in GitLab

If you prefer to create templates by hand rather than through the API:

1. Open your GitLab instance and navigate to the templates group
2. Create a new project with the slug you want (e.g. `nestjs-app`)
3. Push your template content to the main branch
4. The template is immediately available for use in `POST /projects`

The Management API and direct GitLab access are fully interchangeable — both create real GitLab repositories.

---

## Current limitations

Template versioning is minimal. When a project is forked, it gets a snapshot of the template at that moment. There's no mechanism to push template updates to existing projects or to pin projects to a specific template version. Any updates you make to a template after forking are not reflected in projects that already exist.
