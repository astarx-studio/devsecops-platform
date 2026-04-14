# Management API

← [Back to Admin Guide](index.md)

The Management API is a service built specifically for this platform. Its job is to automate the process of setting up a new development project — instead of manually creating a GitLab repository, registering a route in Kong, creating a secrets path in Vault, and optionally setting up a DNS record, you make one API call and it handles all of that in sequence.

---

## Checking that the API is healthy

Visit `https://api.devops.yourdomain.com/health` in a browser. You should see:

```json
{"status":"ok"}
```

If you see an error or can't connect, check the API service logs:

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

## What the API can do

**Check health**

```
GET /health
```

Returns `{"status":"ok"}` when the API is running.

---

**List all provisioned projects**

```
GET /projects
```

Returns a list of all projects that have been provisioned through the API.

---

**Get a specific project**

```
GET /projects/:id
```

Returns the details of a specific project by its numeric GitLab project ID.

---

**Provision a new project**

```
POST /projects
```

This is the main provisioning endpoint. You send it a JSON body describing what you want:

```json
{
  "clientName": "acme",
  "projectName": "webapp",
  "templateSlug": "nestjs-app",
  "capabilities": {
    "deployable": {}
  }
}
```

**All fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `clientName` | Yes | Lowercase identifier for the client/organization (e.g. `acme`). Used to organize the GitLab group hierarchy. |
| `projectName` | Yes | Lowercase identifier for the project (e.g. `webapp`). |
| `templateSlug` | Yes | Name of a repository in your GitLab `templates` group to fork. |
| `capabilities` | No | What infrastructure to set up for this project. See [Capabilities](#capabilities) below. |
| `configs` | No | Slugs of config repos to inject as GitLab CI `include:` directives. |
| `description` | No | Human-readable description passed to the GitLab project. |
| `envVars` | No | Additional key-value pairs seeded into Vault alongside the defaults. |
| `groupPath` | No | Custom GitLab group path. Defaults to `["clients", "{clientName}"]`. |

What happens when you call this:

1. A GitLab group is created under `clients/acme/` (if it doesn't already exist)
2. The `nestjs-app` template repository is forked into that group as `webapp`
3. If `configs` are specified, their CI include directives are injected into `.gitlab-ci.yml`
4. A secrets path is created in Vault at `projects/acme/webapp`
5. If `capabilities.deployable` is set: a Kong service and route are registered, and a DNS record is optionally created in Cloudflare (non-critical — project creation succeeds even if this fails)
6. If `capabilities.publishable` is set: package publishing metadata is attached to the project response

Each step is attempted independently. Non-critical steps (Cloudflare DNS, CI pipeline trigger) will log a warning and continue if they fail.

---

**Delete a project**

```
DELETE /projects/:id
```

Attempts to clean up all resources associated with the project in this order:

1. Remove the Kong service/route (if it exists — non-critical)
2. Remove the Cloudflare DNS record (non-critical)
3. Delete Vault secrets at the project path (non-critical)
4. Delete the GitLab project (this step is critical — it will throw if it fails)

Non-critical steps log warnings if they fail but do not stop the cleanup. You may need to verify Kong and Vault are clean if the project had unusual setup.

---

## Capabilities

The `capabilities` field is the primary way to control what infrastructure a project receives. A project can have any combination of capabilities — or none at all.

**No capabilities** (plain repository)

```json
{
  "clientName": "acme",
  "projectName": "shared-utils",
  "templateSlug": "nestjs-app"
}
```

Creates a GitLab repository and Vault secrets path. No domain, no Kong route, no package config.

---

**`deployable`** — HTTP application with a domain

```json
{
  "capabilities": {
    "deployable": {
      "domain": "webapp.apps.yourdomain.com",
      "autoDeploy": true
    }
  }
}
```

Both fields are optional. If `domain` is omitted, it defaults to `{projectName}.{APPS_DOMAIN}` (e.g. `webapp.apps.yourdomain.com`). If `autoDeploy` is omitted, it defaults to `true` (the CI pipeline is triggered after creation).

A deployable project gets:
- A Kong service and route pointing to `http://{clientName}-{projectName}:3000`
- Optional Cloudflare DNS record (if `CLOUDFLARE_ZONE_ID` is configured)
- The `appUrl` field in the response with the registered domain

---

**`publishable`** — Package publishing

```json
{
  "capabilities": {
    "publishable": {
      "packageName": "@acme/shared-utils"
    }
  }
}
```

`packageName` is optional and defaults to `@{clientName}/{projectName}`. The response includes a `registryUrl` pointing to the GitLab package registry for this project.

---

**Both capabilities**

```json
{
  "capabilities": {
    "deployable": {},
    "publishable": {}
  }
}
```

Gets everything — domain, Kong route, and package registry.

---

## Making API requests

You can call the API using any HTTP client. For example, using `curl`:

```bash
# Provision a simple deployable project
curl -X POST https://api.devops.yourdomain.com/projects \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "clientName": "acme",
    "projectName": "webapp",
    "templateSlug": "nestjs-app",
    "capabilities": { "deployable": {} }
  }'

# List all projects
curl https://api.devops.yourdomain.com/projects \
  -H "X-API-Key: your-api-key"

# Delete a project by its GitLab project ID
curl -X DELETE https://api.devops.yourdomain.com/projects/42 \
  -H "X-API-Key: your-api-key"
```

The API has interactive Swagger documentation at `https://api.devops.yourdomain.com/api/docs` where you can explore and test all endpoints directly in the browser.

Or use a GUI tool like [Insomnia](https://insomnia.rest/) or [Postman](https://www.postman.com/) — just set the `X-API-Key` header on every request.

---

## Current limitations

Provisioning happens synchronously — the API call blocks until all steps are complete. For a simple project this usually takes 5–15 seconds. There's no background job queue, so if a step hangs, the entire request hangs.

Template versioning is minimal — there's no mechanism to pin a project to a specific version of a template or receive updates when the template changes.

The delete operation attempts a best-effort cleanup but does not guarantee that all resources are removed if individual steps fail. After deletion, it's worth verifying in Kong and Vault that nothing was left behind.
