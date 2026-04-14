# Management API Internals

The Management API is a NestJS 11 application located at `api/`. It is the orchestration layer of the platform — the only service that directly talks to GitLab, Kong, Vault, and Cloudflare on behalf of operators and CI/CD automation.

---

## Module tree

```mermaid
graph TD
    AppModule["AppModule\n(root)"]
    ConfigModule["AppConfigModule\n(ConfigModule.forRoot)"]
    PassportModule["PassportModule\ndefaultStrategy: oidc-jwt"]
    HttpModule["HttpModule\n@nestjs/axios"]
    GitLabModule["GitLabModule"]
    KongModule["KongModule"]
    VaultModule["VaultModule"]
    CloudflareModule["CloudflareModule"]
    ConfigsModule["ConfigsModule"]
    TemplatesModule["TemplatesModule"]
    ProjectsModule["ProjectsModule"]

    OidcJwtStrategy["OidcJwtStrategy\n(global provider)"]
    AppController["AppController\n/health"]

    AppModule --> ConfigModule
    AppModule --> PassportModule
    AppModule --> HttpModule
    AppModule --> GitLabModule
    AppModule --> KongModule
    AppModule --> VaultModule
    AppModule --> CloudflareModule
    AppModule --> ConfigsModule
    AppModule --> TemplatesModule
    AppModule --> ProjectsModule
    AppModule --> OidcJwtStrategy
    AppModule --> AppController

    ProjectsModule --> GitLabModule
    ProjectsModule --> KongModule
    ProjectsModule --> VaultModule
    ProjectsModule --> CloudflareModule
    TemplatesModule --> GitLabModule
    ConfigsModule --> GitLabModule
```

`HttpModule` is imported at the root level and is available to all feature modules because it is `@Global()` in NestJS or re-exported. Each service that needs HTTP calls injects `HttpService` from `@nestjs/axios`.

---

## Request lifecycle

Every inbound HTTP request passes through these layers in order:

```mermaid
graph LR
    Request["Inbound Request"]
    LogInt["LoggingInterceptor\nlog start + duration"]
    AuthGuard["CombinedAuthGuard\nAPI key or OIDC JWT"]
    Controller["Controller method\n@Body / @Param validation"]
    Service["Service\nbusiness logic"]
    ExFilter["GlobalExceptionFilter\nformat error response"]
    Response["Outbound Response"]

    Request --> LogInt --> AuthGuard --> Controller --> Service --> Response
    Service -->|"throws"| ExFilter --> Response
    Controller -->|"ValidationPipe throws"| ExFilter
    AuthGuard -->|"401/403"| ExFilter
```

### LoggingInterceptor (`api/src/common/interceptors/logging.interceptor.ts`)

Logs at `debug` level on entry (`--> METHOD /path`) and at `log` level on exit (`<-- METHOD /path 42ms`) using NestJS Logger with context `HTTP`.

### CombinedAuthGuard (`api/src/common/guards/combined-auth.guard.ts`)

Evaluates authentication in this order:

1. **API key check**: if `X-API-Key` header is present, compare it against the `apiKey` config value.
   - Match → allow.
   - Mismatch → throw `UnauthorizedException`.
2. **OIDC JWT check**: if `Authorization: Bearer <token>` is present and `oidc.issuerUrl` is configured, delegate to `AuthGuard('oidc-jwt')`.
   - Valid JWT → allow.
   - Invalid JWT → throw `UnauthorizedException`.
3. **Dev mode**: if neither `apiKey` nor `oidc.issuerUrl` is configured, allow all requests (log a warning). This state should never exist in production.
4. **Missing auth**: if auth mechanisms are configured but no credentials were supplied → `UnauthorizedException`.

### OidcJwtStrategy (`api/src/common/guards/oidc-jwt.strategy.ts`)

Passport strategy (`passport-jwt`, name `oidc-jwt`):
- **Algorithm**: RS256.
- **JWKS**: fetched from `oidc.jwksUrl` (the internal Keycloak endpoint: `http://keycloak:8080/realms/devops/protocol/openid-connect/certs`).
- **Issuer**: validated against `oidc.issuerUrl` (the external Keycloak URL: `https://auth.devops.yourdomain.com/realms/devops`).
- **Audience**: validated against `oidc.audience` (e.g. `management-api`).
- **`validate(payload)`**: maps `sub`, `preferred_username` → `username`, `email`, `realm_roles` → `roles`. Returns the user object attached to `request.user`.

The separation of JWKS URL (internal) from issuer URL (external) is intentional: the JWT `iss` claim contains the external URL, while the JWKS endpoint is resolved internally for performance and reliability.

### GlobalExceptionFilter (`api/src/common/filters/http-exception.filter.ts`)

Catches all unhandled exceptions. Returns a JSON body:

```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "timestamp": "2026-04-13T00:00:00.000Z",
  "path": "/projects"
}
```

- `HttpException` subclasses use their own status code and message.
- All other errors → 500 + generic message (stack traces never exposed in responses).
- 5xx errors logged at `error` level with stack trace. 4xx logged at `warn` level.

### ValidationPipe

Applied globally in `main.ts`. Uses `class-validator` and `class-transformer`:
- `whitelist: true` — strips unknown properties.
- `forbidNonWhitelisted: true` — throws 400 on unknown properties.
- `transform: true` — auto-converts primitive types.

---

## Configuration (`api/src/config/configuration.ts`)

The `AppConfiguration` interface defines the entire config shape. Values are loaded from `process.env` at startup by the NestJS `ConfigModule`.

```typescript
interface AppConfiguration {
  port: number;          // API_PORT (default: 3000)
  host: string;          // API_HOST (default: 0.0.0.0)
  domain: string;        // DOMAIN (required)
  appsDomain: string;    // APPS_DOMAIN (default: apps.{DOMAIN})
  gitlabDomain: string;  // GITLAB_DOMAIN (default: gitlab.devops.{DOMAIN})
  apiKey?: string;       // API_KEY (optional)
  logLevel: string;      // LOG_LEVEL (default: info)
  gitlab: {
    url: string;               // GITLAB_URL (default: http://gitlab)
    token: string;             // GITLAB_ROOT_TOKEN (required)
    templateGroupId: number;   // GITLAB_TEMPLATE_GROUP_ID (required)
    configGroupId: number;     // GITLAB_CONFIG_GROUP_ID (required)
  };
  kong: {
    adminUrl: string;          // KONG_ADMIN_URL (default: http://kong:8001)
  };
  vault: {
    url: string;               // VAULT_URL (default: http://vault:8200)
    token: string;             // VAULT_DEV_ROOT_TOKEN_ID (required)
  };
  cloudflare: {
    apiToken?: string;         // CLOUDFLARE_API_TOKEN (optional)
    zoneId?: string;           // CLOUDFLARE_ZONE_ID (optional)
    tunnelId?: string;         // CLOUDFLARE_TUNNEL_ID (optional)
  };
  oidc: {
    issuerUrl?: string;        // OIDC_ISSUER_URL (optional)
    jwksUrl?: string;          // OIDC_JWKS_URL (optional)
    audience?: string;         // OIDC_AUDIENCE (optional)
  };
}
```

**Required variables** (will throw on startup if missing): `DOMAIN`, `GITLAB_ROOT_TOKEN`, `GITLAB_TEMPLATE_GROUP_ID`, `GITLAB_CONFIG_GROUP_ID`, `VAULT_DEV_ROOT_TOKEN_ID`.

---

## API endpoints

All endpoints are documented via Swagger at `GET /api/docs` (OpenAPI UI). The raw JSON spec is at `GET /api/docs-json`. The base path is `/`.

### AppController

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Returns `{ status: "ok" }`. Used by Docker health check and load balancers. |

---

### ProjectsController (`/projects`)

Auth: `CombinedAuthGuard` on all endpoints. Swagger security: `api-key`, `Bearer`.

#### `POST /projects`

Creates a new project and provisions all associated resources.

**Request body (`CreateProjectDto`):**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `clientName` | `string` | Yes | — | Client identifier. Used as GitLab group name and Kong service prefix. Must match `/^[a-z0-9-]+$/`. |
| `projectName` | `string` | Yes | — | Project identifier. Used as GitLab project name and Kong service name suffix. Must match `/^[a-z0-9-]+$/`. |
| `templateSlug` | `string` | Yes | — | Slug of the template project in the `templates` GitLab group. |
| `description` | `string` | No | — | Optional project description passed to GitLab. |
| `groupPath` | `string[]` | No | `["clients", clientName]` | GitLab group path segments. Groups are created if they do not exist. |
| `configs` | `string[]` | No | `[]` | Array of config repo slugs to inject as `.gitlab-ci.yml` includes. |
| `envVars` | `Record<string, string>` | No | `{}` | Extra key-value pairs written to Vault alongside the standard keys. |
| `capabilities` | `ProjectCapabilities` | No | `{}` | Opt-in capabilities (see below). |

**`ProjectCapabilities`:**

| Field | Type | Description |
|---|---|---|
| `deployable` | `DeployableCapability \| null` | If set, creates a Kong route and optionally a Cloudflare DNS record. |
| `publishable` | `PublishableCapability \| null` | If set, sets a package name and registry URL. |

**`DeployableCapability`:**

| Field | Type | Default | Description |
|---|---|---|---|
| `domain` | `string` | `{projectName}.{APPS_DOMAIN}` | Public hostname for the deployed app. |
| `autoDeploy` | `boolean` | `true` | Whether to trigger a GitLab pipeline immediately after provisioning. |

**`PublishableCapability`:**

| Field | Type | Default | Description |
|---|---|---|---|
| `packageName` | `string` | `@{clientName}/{projectName}` | npm package name for the GitLab package registry. |

**Response (`ProjectInfoDto`, 201):**

| Field | Type | Always present | Description |
|---|---|---|---|
| `id` | `number` | Yes | GitLab project ID |
| `name` | `string` | Yes | Project name |
| `clientName` | `string` | Yes | Client name |
| `gitlabUrl` | `string` | Yes | GitLab web URL |
| `vaultPath` | `string` | Yes | Vault KV path (e.g. `projects/acme/webapp`) |
| `configs` | `string[]` | No | Injected config slugs |
| `appUrl` | `string` | No | Public hostname (only if deployable) |
| `kongServiceName` | `string` | No | Kong service name (only if deployable) |
| `cloudflareConfigured` | `boolean` | No | Whether Cloudflare DNS was set (only if deployable) |
| `packageName` | `string` | No | npm package name (only if publishable) |
| `registryUrl` | `string` | No | GitLab package registry URL (only if publishable) |

**Provisioning steps (in order):**
1. Create GitLab group hierarchy from `groupPath`.
2. Fork the template project into the target group.
3. Inject CI config `include:` entries into `.gitlab-ci.yml`.
4. Write Vault secrets at `secret/data/projects/{clientName}/{projectName}`.
5. If `deployable`: register Kong service + route; attempt Cloudflare DNS (non-critical); optionally trigger pipeline (non-critical).
6. If `publishable`: compute package name + registry URL.

**Error behavior:** Steps 1–4 are critical (failure aborts and returns an error). Steps 5b, 5c, and 6 are non-critical (logged as warnings, do not fail the request).

---

#### `GET /projects`

Returns all GitLab projects the root token has access to, mapped to `ProjectInfoDto[]`.

Note: `appUrl`, `kongServiceName`, `cloudflareConfigured`, `packageName`, and `registryUrl` are not populated in the list response — only `id`, `name`, `clientName`, `gitlabUrl`, and `vaultPath`.

---

#### `GET /projects/:id`

Returns a single project by GitLab project ID. Returns 404 if the project does not exist.

---

#### `DELETE /projects/:id`

Attempts to clean up all resources associated with a project. Steps are non-critical except the final GitLab deletion:

1. Remove Kong service `{clientName}-{projectName}-service` (non-critical).
2. Remove Cloudflare DNS record for `{projectName}.{APPS_DOMAIN}` (non-critical).
3. Delete Vault secrets at `secret/metadata/projects/{clientName}/{projectName}` (non-critical).
4. Delete the GitLab project (critical — returns error if this fails).

Returns 204 on success.

---

### TemplatesController (`/templates`)

Auth: `CombinedAuthGuard`.

Templates are GitLab projects in the group identified by `GITLAB_TEMPLATE_GROUP_ID`. They serve as the source repositories for project forks.

| Method | Path | Body / Params | Response | Description |
|---|---|---|---|---|
| `GET` | `/templates` | — | `TemplateInfoDto[]` (200) | List all template projects. |
| `GET` | `/templates/:slug` | `slug` | `TemplateInfoDto` (200, 404) | Get template details including file tree. |
| `POST` | `/templates` | `CreateTemplateDto` | `TemplateInfoDto` (201, 409) | Create a new template project. |
| `DELETE` | `/templates/:slug` | `slug` | 204 | Delete a template project permanently. |

**`CreateTemplateDto`:**

| Field | Type | Required | Description |
|---|---|---|---|
| `slug` | `string` | Yes | Project path/slug. Must match `/^[a-z0-9-]+$/`. |
| `description` | `string` | No | Project description. |
| `files` | `Record<string, string>` | No | Map of `{ "path/to/file": "content" }` to seed the template repo. |

**`TemplateInfoDto`:**

| Field | Type | Description |
|---|---|---|
| `id` | `number` | GitLab project ID |
| `slug` | `string` | Project path |
| `name` | `string` | Project name |
| `description` | `string \| null` | Optional description |
| `gitlabUrl` | `string` | GitLab web URL |
| `defaultBranch` | `string` | Default branch name |
| `files` | `GitLabTreeItem[]` | Only present on `GET /:slug` (recursive tree) |

---

### ConfigsController (`/configs`)

Auth: `CombinedAuthGuard`.

Configs are GitLab projects in the group identified by `GITLAB_CONFIG_GROUP_ID`. Each config repo contains a `.gitlab-ci.yml` that defines reusable hidden CI job templates.

| Method | Path | Body / Params | Response | Description |
|---|---|---|---|---|
| `GET` | `/configs` | — | `ConfigInfoDto[]` (200) | List all config repos. |
| `GET` | `/configs/:slug` | `slug` | `ConfigInfoDto` (200, 404) | Get config repo details including file tree. |
| `POST` | `/configs` | `CreateConfigDto` | `ConfigInfoDto` (201, 409) | Create a new config repo. |
| `PUT` | `/configs/:slug/files` | `slug` + `UpdateConfigFilesDto` | 204 | Upsert a file in the config repo. |
| `DELETE` | `/configs/:slug` | `slug` | 204 | Delete a config repo permanently. |

**`CreateConfigDto`:**

| Field | Type | Required | Description |
|---|---|---|---|
| `slug` | `string` | Yes | Repo path/slug. |
| `description` | `string` | No | Description. |
| `ciContent` | `string` | Yes | Initial content for `.gitlab-ci.yml`. |

**`UpdateConfigFilesDto`:**

| Field | Type | Required | Description |
|---|---|---|---|
| `filePath` | `string` | Yes | Path to the file within the repo (e.g. `.gitlab-ci.yml`). |
| `content` | `string` | Yes | New file content. |
| `commitMessage` | `string` | No | Git commit message. |

---

## Service internals

### GitLabService (`api/src/gitlab/gitlab.service.ts`)

HTTP client for the GitLab REST API v4. Authenticates all requests with `PRIVATE-TOKEN: ${GITLAB_ROOT_TOKEN}`.

| Method | Signature | Description |
|---|---|---|
| `createGroupHierarchy` | `(groupPath: string[]) => Promise<number>` | Walks `groupPath` segments; finds or creates each group; returns leaf group ID. |
| `forkTemplate` | `(templateSlug, targetGroupId, projectName) => Promise<GitLabProject>` | Resolves the template in the templates group by slug, then forks it into `targetGroupId`. |
| `listProjects` | `(groupId?: number) => Promise<GitLabProject[]>` | Lists all projects in a group, or all accessible projects. `per_page=100`, `simple=true`. |
| `getProject` | `(projectId: number) => Promise<GitLabProject>` | GET `/projects/:id`. |
| `deleteProject` | `(projectId: number) => Promise<void>` | DELETE `/projects/:id`. |
| `triggerPipeline` | `(projectId, ref?) => Promise<void>` | POST `/projects/:id/pipeline` with `ref` (default `main`). |
| `createNewProject` | `(groupId, name, description?, readme?) => Promise<GitLabProject>` | Creates a new project with `visibility: internal`. |
| `getFileContent` | `(projectId, filePath, ref?) => Promise<string \| null>` | GET file, base64-decode. Returns `null` on 404. |
| `upsertFile` | `(projectId, filePath, content, message) => Promise<void>` | Creates or updates a file in the repo. |
| `getProjectTree` | `(projectId, path?, ref, recursive) => Promise<GitLabTreeItem[]>` | Lists repository tree. |

**`GitLabProject` shape** (key fields used internally):
```typescript
{
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  web_url: string;
  default_branch: string;
}
```

---

### KongService (`api/src/kong/kong.service.ts`)

HTTP client for the Kong Admin API. No authentication (Admin API is only accessible internally).

| Method | Signature | Description |
|---|---|---|
| `registerService` | `(name, upstreamUrl, hosts[]) => Promise<{ serviceName, hosts }>` | PUT `/services/{name}` (upsert) with timeouts and retries. PUT `/services/{name}/routes/{name}-route` (upsert) with host matching. |
| `removeService` | `(name) => Promise<void>` | DELETE route `{name}-route`, then DELETE service. Best-effort; logs warnings, does not throw. |

**Kong service parameters set by `registerService`:**
- `connect_timeout`: 10000 ms
- `read_timeout`: 60000 ms
- `write_timeout`: 60000 ms
- `retries`: 3
- `strip_path`: false
- `preserve_host`: true

---

### VaultService (`api/src/vault/vault.service.ts`)

HTTP client for the Vault KV v2 API. Authenticates with `X-Vault-Token` header.

| Method | Signature | Description |
|---|---|---|
| `writeSecrets` | `(path, secrets) => Promise<void>` | POST `/v1/secret/data/{path}` with `{ data: secrets }`. |
| `deleteSecrets` | `(path) => Promise<void>` | DELETE `/v1/secret/metadata/{path}` (deletes all versions). Logs warning and swallows errors. |

Secret paths follow the pattern `projects/{clientName}/{projectName}`.

---

### CloudflareService (`api/src/cloudflare/cloudflare.service.ts`)

HTTP client for the Cloudflare API v4. Disabled (no-op) if `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ZONE_ID` is not set.

| Method | Signature | Description |
|---|---|---|
| `isConfigured` | `() => boolean` | Returns true if both `apiToken` and `zoneId` are set. Logs a warning once on first call if not configured. |
| `addDnsRecord` | `(hostname) => Promise<boolean>` | POST `/zones/{zoneId}/dns_records` — creates a CNAME pointing to `{tunnelId}.cfargotunnel.com`. Returns false if not configured or on error. |
| `removeDnsRecord` | `(hostname) => Promise<boolean>` | GET + DELETE DNS record by name + type CNAME. Returns false if not configured or on error. |

---

## Swagger / OpenAPI

The Swagger UI is served at `GET /api/docs`. The raw JSON spec is at `GET /api/docs-json`.

All DTOs are decorated with `@ApiProperty()` from `@nestjs/swagger`. The spec includes security definitions for `api-key` (header) and `Bearer` (JWT).

To regenerate the spec after changes:
```bash
pnpm run build
node -e "require('./dist/main').generateSpec()"
```
(If a `generateSpec` export exists; otherwise run the app and fetch `/api-json`.)
