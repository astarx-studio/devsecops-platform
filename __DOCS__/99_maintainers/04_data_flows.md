# Data Flows

← [Back to Maintainer Guide](index.md)

This document traces the key runtime flows through the platform using sequence diagrams. Each flow shows the exact services involved, the protocol used, and what happens at each step.

---

## 1. Project provisioning (GraphQL `createProject`)

This is the central flow of the platform. An operator (or automated system) calls the Management API via **`POST /graphql`** with the `createProject` mutation, which cascades into GitLab, OpenBao (Vault), Kubernetes (k3d), and MongoDB.

```mermaid
sequenceDiagram
    actor Operator
    participant API as Management API
    participant GitLab
    participant Vault
    participant K8s as Kubernetes (k3d)
    participant Mongo as MongoDB

    Operator->>API: POST /graphql mutation createProject
    Note over API: CombinedAuthGuard validates API key or JWT

    API->>GitLab: GET /groups (find or create groupPath[0])
    GitLab-->>API: group ID
    API->>GitLab: GET/POST /groups (walk groupPath segments)
    GitLab-->>API: leaf group ID

    API->>GitLab: GET /projects (find template by slug) / create project
    GitLab-->>API: GitLab project

    opt configs[] is not empty
        API->>GitLab: GET/PUT .gitlab-ci.yml (merge includes)
        GitLab-->>API: 200
    end

    API->>Vault: POST /v1/secret/data/projects/...
    Note over API,Vault: env + template defaults
    Vault-->>API: 200

    opt deployable capability
        API->>K8s: ensure namespaces / cluster prep
        K8s-->>API: ok (or skipped if kubeconfig missing)
        API->>GitLab: set CI variables, trigger pipeline (optional)
        GitLab-->>API: 200 / 201
    end

    API->>Mongo: persist Project document
    Mongo-->>API: acknowledged

    API-->>Operator: Project (GraphQL response)
```

**Key behaviors:**
- The group hierarchy walk is idempotent. If the group already exists, it is reused.
- GitLab project creation or fork must succeed; duplicate names in the same namespace still fail with GitLab `409`.
- Vault write is always performed for the project secret path.
- Kubernetes steps degrade gracefully when an environment's kubeconfig is absent.

---

## 2. Inbound request routing (browser → deployed app on k3d)

How an HTTPS request reaches an application pod when using the **outer Traefik → k3d passthrough → inner Traefik → Ingress** path.

```mermaid
sequenceDiagram
    actor Browser
    participant CF as Cloudflare Edge
    participant cloudflared as cloudflared agent
    participant Outer as Traefik (compose)
    participant Inner as Traefik (k3d)
    participant Ing as Ingress / Service
    participant Pod as Application Pod

    Browser->>CF: HTTPS GET https://myapp.dev.apps.yourdomain.com/
    CF->>cloudflared: tunnel forward (optional)
    cloudflared->>Outer: HTTPS GET (Host: myapp.dev.apps.yourdomain.com)

    Note over Outer: HostRegexp matches app zone (see traefik/dynamic/k3d-passthrough.yml)
    Outer->>Inner: HTTP (TLS already terminated) to in-cluster Traefik NodePort

    Inner->>Ing: route by Ingress host + path
    Ing->>Pod: HTTP to workload Service

    Pod-->>Ing: 200
    Ing-->>Inner: 200
    Inner-->>Outer: 200
    Outer-->>cloudflared: 200
    cloudflared-->>CF: 200
    CF-->>Browser: 200
```

**Notes:**
- App-zone routers generally do **not** attach `oidc-auth@file`; applications implement their own auth. Operator tools (Traefik dashboard, MinIO console, etc.) attach ForwardAuth via Docker labels.
- When not using Cloudflare Tunnel, traffic can reach Traefik directly on `10443` with the same Host-based routing model.
- Inner routing is standard Kubernetes; the platform CI templates produce the Ingress and Helm release.

---

## 3. Authentication flow (browser → OIDC-protected operator UI)

How a user authenticates to a platform surface protected by the `oidc-auth` ForwardAuth middleware (for example the Traefik dashboard).

```mermaid
sequenceDiagram
    actor User
    participant Traefik
    participant oauth2proxy as oauth2-proxy
    participant Keycloak
    participant Service as Protected upstream (e.g. Traefik dashboard)

    User->>Traefik: GET https://traefik.devops.yourdomain.com
    Traefik->>oauth2proxy: GET http://oauth2-proxy:4180/ (ForwardAuth check)
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

    User->>Traefik: GET https://traefik.devops.yourdomain.com (+ cookie)
    Traefik->>oauth2proxy: GET / (+ cookie)
    Note over oauth2proxy: valid session cookie → inject X-Auth-Request-* headers
    oauth2proxy-->>Traefik: 202 + auth headers
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

    CI->>API: POST /graphql (Bearer)\nmutation or query as needed
    Note over API: CombinedAuthGuard detects Bearer token
    Note over API: OidcJwtStrategy fetches JWKS from\nhttp://keycloak:8080/realms/devops/protocol/openid-connect/certs
    Note over API: Validates: signature, issuer, audience, expiry
    API->>Vault: POST /v1/secret/data/projects/...
    Note over API,Vault: OpenBao handles this request
    Vault-->>API: 200
    API-->>CI: 200 GraphQL payload
```

**Notes:**
- The `management-api` Keycloak client has service accounts enabled, allowing `client_credentials` grant.
- The JWT `iss` claim is the external issuer URL. The JWKS are fetched from the internal URL for efficiency. These two URLs can differ; the strategy is configured with both explicitly.
- Token TTL is 300 seconds by default (Keycloak default for access tokens). For long-running CI jobs, implement token refresh.

---

## 5. OpenBao secrets access from a deployed app

How an application container retrieves its secrets from OpenBao at runtime.

```mermaid
sequenceDiagram
    participant App as App Container
    participant Keycloak
    participant Vault

    Note over App: Startup: read VAULT_ADDR, VAULT_ROLE, VAULT_CLIENT_ID/SECRET from env

    App->>Keycloak: POST /realms/devops/protocol/openid-connect/token\n{grant_type=client_credentials}
    Keycloak-->>App: {access_token: "eyJ..."}

    App->>Vault: POST /v1/auth/oidc/login\n{role=default, jwt=eyJ...}
    Note over App,Vault: OpenBao handles OIDC authentication
    Vault-->>App: {client_token: "hvs.xxx"}

    App->>Vault: GET /v1/secret/data/projects/{clientName}/{projectName}\nX-Vault-Token: hvs.xxx
    Note over App,Vault: OpenBao KV v2 API endpoint
    Vault-->>App: {data: {PROJECT_NAME, CLIENT_NAME, ...custom secrets}}

    Note over App: inject secrets into runtime config / env
```

**Notes:**
- This flow requires the application to implement OpenBao OIDC authentication. The `nestjs-app` template does not include this by default; it would need to be added per project.
- The `vault-oidc-init` one-shot container configures the `oidc` auth method and creates the `default` role. Applications should bind to this role.
- If the project uses a simpler approach (e.g. GitLab CI injects secrets as masked variables before pipeline runs), the OpenBao OIDC flow is not needed at runtime.

---

## 6. Project deletion (GraphQL `deleteProject`)

```mermaid
sequenceDiagram
    actor Operator
    participant API as Management API
    participant GitLab
    participant Vault
    participant Mongo as MongoDB

    Operator->>API: POST /graphql mutation deleteProject

    API->>GitLab: GET /projects/:id (resolve paths)
    GitLab-->>API: project metadata

    API->>GitLab: DELETE /projects/:id
    GitLab-->>API: 202 (async deletion)

    API->>Vault: DELETE /v1/secret/metadata/projects/...
    Note over API: non-critical — continues on error

    API->>Mongo: remove Project / audit records
    Mongo-->>API: acknowledged

    API-->>Operator: Boolean
```

**Note:** GitLab project deletion is asynchronous. The API receives `202` from GitLab while MongoDB and Vault cleanup are attempted in the service implementation; callers should treat the mutation as logically complete once the API returns.

---