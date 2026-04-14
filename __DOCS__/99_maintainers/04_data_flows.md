# Data Flows

This document traces the key runtime flows through the platform using sequence diagrams. Each flow shows the exact services involved, the protocol used, and what happens at each step.

---

## 1. Project provisioning (`POST /projects`)

This is the central flow of the platform. An operator (or automated system) calls the Management API to create a new project, which cascades into GitLab, Vault, Kong, and optionally Cloudflare.

```mermaid
sequenceDiagram
    actor Operator
    participant API as Management API
    participant GitLab
    participant Vault
    participant Kong
    participant CF as Cloudflare API

    Operator->>API: POST /projects {clientName, projectName, templateSlug, capabilities}
    Note over API: CombinedAuthGuard validates API key or JWT

    API->>GitLab: GET /groups (find or create groupPath[0])
    GitLab-->>API: group ID
    API->>GitLab: GET/POST /groups (walk groupPath segments)
    GitLab-->>API: leaf group ID

    API->>GitLab: GET /projects (find template by slug)
    GitLab-->>API: template project
    API->>GitLab: POST /projects/:templateId/fork {namespace_id, name}
    GitLab-->>API: forked project {id, web_url}

    opt configs[] is not empty
        API->>GitLab: GET /projects/:id/repository/files/.gitlab-ci.yml
        GitLab-->>API: existing CI YAML (or 404)
        Note over API: merge include entries (deduplicate)
        API->>GitLab: PUT /projects/:id/repository/files/.gitlab-ci.yml
        GitLab-->>API: 200
    end

    API->>Vault: POST /v1/secret/data/projects/{clientName}/{projectName}
    Note over API,Vault: {PROJECT_NAME, CLIENT_NAME, GITLAB_PROJECT_ID, DEPLOYMENT_ENV, ...envVars}
    Vault-->>API: 200

    opt capabilities.deployable is set
        API->>Kong: PUT /services/{clientName}-{projectName}-service
        Note over API,Kong: upstream = http://{clientName}-{projectName}:3000
        Kong-->>API: 200
        API->>Kong: PUT /services/{name}/routes/{name}-route
        Note over API,Kong: hosts = [domain]
        Kong-->>API: 200

        opt Cloudflare configured
            API->>CF: POST /zones/{zoneId}/dns_records
            Note over API,CF: CNAME {hostname} → {tunnelId}.cfargotunnel.com
            CF-->>API: 200 (or error — non-critical)
        end

        opt autoDeploy = true
            API->>GitLab: POST /projects/:id/pipeline {ref: main}
            GitLab-->>API: 201 (or error — non-critical)
        end
    end

    API-->>Operator: 201 ProjectInfoDto
```

**Key behaviors:**
- The group hierarchy walk is idempotent. If the group already exists, it is reused.
- The fork operation is not idempotent. If a project with the same name already exists in the group, GitLab returns 409 and the provisioning fails.
- Vault write is always performed regardless of capabilities.
- Cloudflare and pipeline trigger failures are logged as warnings and do not fail the overall request.

---

## 2. Inbound request routing (browser → deployed app)

How an HTTP request from a developer's browser reaches a deployed application.

```mermaid
sequenceDiagram
    actor Browser
    participant CF as Cloudflare Edge
    participant cloudflared as cloudflared agent
    participant Traefik
    participant oauth2proxy as oauth2-proxy
    participant Keycloak
    participant Kong
    participant App as Deployed App Container

    Browser->>CF: HTTPS GET https://myapp.apps.yourdomain.com/api
    CF->>cloudflared: forward via tunnel (outbound connection)
    cloudflared->>Traefik: HTTP GET http://traefik:80/api\nHost: myapp.apps.yourdomain.com

    Note over Traefik: kong-catchall rule (priority 1) matches
    Note over Traefik: no oidc-auth middleware on catchall

    Traefik->>Kong: HTTP GET http://kong:8000/api\nHost: myapp.apps.yourdomain.com

    Note over Kong: host-based route matches myapp.apps.yourdomain.com
    Note over Kong: upstream = http://{clientName}-{projectName}:3000

    Kong->>App: HTTP GET http://{clientName}-{projectName}:3000/api

    App-->>Kong: 200
    Kong-->>Traefik: 200
    Traefik-->>cloudflared: 200
    cloudflared-->>CF: 200
    CF-->>Browser: 200 (HTTPS)
```

**Notes:**
- The `kong-catchall` router does **not** have the `oidc-auth` middleware attached. Only the Traefik dashboard and Kong Admin routes are OIDC-protected. Deployed applications must implement their own authentication.
- TLS is terminated at the Cloudflare edge (CDN mode) or by Traefik (if using direct DNS). In both cases, internal traffic is plain HTTP.
- The deployed app container must be on the `devops-network` and use the naming convention `{clientName}-{projectName}` as the container name.

---

## 3. Authentication flow (browser → OIDC-protected service)

How a user authenticates to a platform service protected by the `oidc-auth` ForwardAuth middleware (e.g. Traefik dashboard, Kong Admin).

```mermaid
sequenceDiagram
    actor User
    participant Traefik
    participant oauth2proxy as oauth2-proxy
    participant Keycloak
    participant Service as Protected Service (e.g. Kong Admin)

    User->>Traefik: GET https://gw-admin.devops.yourdomain.com
    Traefik->>oauth2proxy: GET http://oauth2-proxy:4180/oauth2/auth\n(ForwardAuth check)
    Note over oauth2proxy: no session cookie found
    oauth2proxy-->>Traefik: 401 + redirect headers
    Traefik-->>User: 302 → https://oauth.devops.yourdomain.com/oauth2/sign_in

    User->>oauth2proxy: GET /oauth2/sign_in
    oauth2proxy-->>User: 302 → Keycloak login page

    User->>Keycloak: GET /realms/devops/protocol/openid-connect/auth\n?client_id=oauth2-proxy&...
    Keycloak-->>User: HTML login form

    User->>Keycloak: POST credentials
    Keycloak-->>User: 302 → /oauth2/callback?code=...

    User->>oauth2proxy: GET /oauth2/callback?code=...
    oauth2proxy->>Keycloak: POST /token (code exchange)
    Keycloak-->>oauth2proxy: access_token, id_token, refresh_token
    Note over oauth2proxy: encrypt session → Set-Cookie: _oauth2_proxy=...
    oauth2proxy-->>User: 302 → original URL + session cookie

    User->>Traefik: GET https://gw-admin.devops.yourdomain.com (+ cookie)
    Traefik->>oauth2proxy: GET /oauth2/auth (+ cookie)
    Note over oauth2proxy: valid session cookie → inject X-Auth-Request-* headers
    oauth2proxy-->>Traefik: 200 + auth headers
    Traefik->>Service: GET (+ forwarded auth headers)
    Service-->>Traefik: 200
    Traefik-->>User: 200
```

---

## 4. Management API JWT authentication flow

How a CI/CD pipeline or automated tool authenticates to the Management API using a Keycloak-issued JWT.

```mermaid
sequenceDiagram
    participant CI as GitLab CI Job
    participant Keycloak
    participant API as Management API
    participant Vault

    CI->>Keycloak: POST /realms/devops/protocol/openid-connect/token\n{grant_type=client_credentials, client_id=management-api, client_secret=...}
    Keycloak-->>CI: {access_token: "eyJ...", expires_in: 300}

    CI->>API: POST /projects\nAuthorization: Bearer eyJ...
    Note over API: CombinedAuthGuard detects Bearer token
    Note over API: OidcJwtStrategy fetches JWKS from\nhttp://keycloak:8080/realms/devops/protocol/openid-connect/certs
    Note over API: Validates: signature, issuer, audience, expiry
    API->>Vault: POST /v1/secret/data/projects/...
    Vault-->>API: 200
    API-->>CI: 201 ProjectInfoDto
```

**Notes:**
- The `management-api` Keycloak client has service accounts enabled, allowing `client_credentials` grant.
- The JWT `iss` claim is the external issuer URL. The JWKS are fetched from the internal URL for efficiency. These two URLs can differ; the strategy is configured with both explicitly.
- Token TTL is 300 seconds by default (Keycloak default for access tokens). For long-running CI jobs, implement token refresh.

---

## 5. Vault secrets access from a deployed app

How an application container retrieves its secrets from Vault at runtime.

```mermaid
sequenceDiagram
    participant App as App Container
    participant Keycloak
    participant Vault

    Note over App: Startup: read VAULT_ADDR, VAULT_ROLE, VAULT_CLIENT_ID/SECRET from env

    App->>Keycloak: POST /realms/devops/protocol/openid-connect/token\n{grant_type=client_credentials}
    Keycloak-->>App: {access_token: "eyJ..."}

    App->>Vault: POST /v1/auth/oidc/login\n{role=default, jwt=eyJ...}
    Vault-->>App: {client_token: "hvs.xxx"}

    App->>Vault: GET /v1/secret/data/projects/{clientName}/{projectName}\nX-Vault-Token: hvs.xxx
    Vault-->>App: {data: {PROJECT_NAME, CLIENT_NAME, ...custom secrets}}

    Note over App: inject secrets into runtime config / env
```

**Notes:**
- This flow requires the application to implement Vault OIDC authentication. The `nestjs-app` template does not include this by default; it would need to be added per project.
- The `vault-oidc-init` one-shot container configures the `oidc` auth method and creates the `default` role. Applications should bind to this role.
- If the project uses a simpler approach (e.g. GitLab CI injects secrets as masked variables before pipeline runs), the Vault OIDC flow is not needed at runtime.

---

## 6. Project deletion (`DELETE /projects/:id`)

```mermaid
sequenceDiagram
    actor Operator
    participant API as Management API
    participant GitLab
    participant Kong
    participant CF as Cloudflare API
    participant Vault

    Operator->>API: DELETE /projects/:id

    API->>GitLab: GET /projects/:id
    GitLab-->>API: {path_with_namespace: "clients/acme/webapp", ...}
    Note over API: derive clientName, projectName, hostname

    API->>Kong: DELETE /services/{name}/routes/{name}-route
    Note over API: non-critical — continues on error
    API->>Kong: DELETE /services/{name}
    Note over API: non-critical — continues on error

    API->>CF: GET /zones/{zoneId}/dns_records?name={hostname}&type=CNAME
    CF-->>API: [{id: "abc"}]
    API->>CF: DELETE /zones/{zoneId}/dns_records/abc
    Note over API: non-critical — continues on error

    API->>Vault: DELETE /v1/secret/metadata/projects/{clientName}/{projectName}
    Note over API: non-critical — continues on error

    API->>GitLab: DELETE /projects/:id
    GitLab-->>API: 202 (async deletion)

    API-->>Operator: 204
```

**Note:** GitLab project deletion is asynchronous. The API returns 202 from GitLab and the Management API immediately returns 204. The actual deletion completes in the background. The Vault path deletion (`/metadata/`) removes all versions of the secret permanently.
