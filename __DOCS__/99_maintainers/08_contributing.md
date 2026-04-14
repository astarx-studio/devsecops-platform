# Contributing

← [Back to Maintainer Guide](index.md)

This document covers how to set up a local development environment, run the test suite, add new services to the platform, and extend the Management API.

---

## Prerequisites

- Docker Engine 24+ and Docker Compose v2.
- Node.js 20+ and pnpm 9+.
- A valid `.env` file. Copy `sample.env` and fill in real values. You do not need a running Cloudflare tunnel or ACME-issued certificates for local development.

---

## Management API local development

The Management API (`api/`) is the only service that requires a local Node.js environment for development. All other services run inside Docker.

### Setup

```sh
cd api
pnpm install
```

### Running in development mode

For local development against a running Docker Compose stack, use:

```sh
pnpm run start:dev
```

This starts the NestJS app in watch mode (`ts-node` + `@nestjs/cli`). It connects to the services in Docker using the URLs in your `.env` (e.g. `KONG_ADMIN_URL=http://localhost:18001`, `VAULT_URL=http://localhost:18200`).

You will need to adjust your `.env` to use `localhost` + host-exposed ports for the `api` process's environment when running outside Docker:

| Variable | Docker value | Local dev value |
|---|---|---|
| `GITLAB_URL` | `http://gitlab` | `http://localhost` (or the public URL) |
| `KONG_ADMIN_URL` | `http://kong:8001` | `http://localhost:18001` |
| `VAULT_URL` | `http://vault:8200` | `http://localhost:18200` |
| `OIDC_JWKS_URL` | `http://keycloak:8080/realms/devops/...` | Use the public URL (`https://auth.devops.yourdomain.com/realms/devops/protocol/openid-connect/certs`) — Keycloak has no host-exposed port |

### Building

```sh
pnpm run build
```

Compiles TypeScript to `dist/`. The Dockerfile uses this exact command.

### Swagger UI

When the app is running, visit `http://localhost:3000/api/docs` for the OpenAPI UI.

---

## Running tests

### Unit tests

```sh
cd api
pnpm run test
```

Runs all `*.spec.ts` files via Jest with `ts-jest`. No running Docker services required — all external dependencies are mocked.

```sh
pnpm run test:watch     # watch mode
pnpm run test:cov       # with coverage report
```

### End-to-end tests

```sh
pnpm run test:e2e
```

Runs `test/**/*.e2e-spec.ts`. These also mock external services and do not require a running stack.

### Test structure

```
api/
├── src/
│   ├── **/*.spec.ts          # Unit tests (colocated with source)
│   └── ...
└── test/
    ├── **/*.e2e-spec.ts      # E2E tests
    └── helpers/
        ├── mock-providers.ts  # Centralized mock providers and TEST_CONFIG
        └── e2e-module.ts      # NestJS test module factory
```

**`mock-providers.ts`** defines `TEST_CONFIG` — the config values injected into all tests. When you add a new config key, add a matching test value here:

```typescript
const TEST_CONFIG: Record<string, unknown> = {
  domain: 'test.net',
  gitlabDomain: 'gitlab.devops.test.net',
  // ... add your new key here
};
```

**`e2e-module.ts`** creates a full NestJS testing module with mocked services. Use it for integration-style tests that exercise multiple layers.

### Lint and type check

```sh
pnpm run lint      # ESLint
pnpm run lint:fix  # ESLint with auto-fix
```

TypeScript type checking is performed as part of `pnpm run build`. Run it separately with:

```sh
npx tsc --noEmit
```

---

## Adding a new service to the platform

Follow these steps when adding a Docker Compose service to the platform stack.

### 1. Add to `docker-compose.yml`

Define the service, including:
- A `healthcheck` (required for services that others depend on).
- `networks: devops-network` membership.
- `depends_on` with `condition: service_healthy` where appropriate.
- A `restart: unless-stopped` policy.

```yaml
myservice:
  image: example/myservice:latest
  restart: unless-stopped
  environment:
    FOO: ${MY_FOO}
  networks:
    - devops-network
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
    interval: 15s
    timeout: 5s
    retries: 3
    start_period: 30s
```

### 2. Add domain alias (if publicly accessible)

Add a network alias to the `traefik` service's network block in `docker-compose.yml`:

```yaml
traefik:
  networks:
    devops-network:
      aliases:
        - ${MY_SERVICE_DOMAIN}
```

Add `MY_SERVICE_DOMAIN` to `sample.env` with a comment explaining the value.

### 3. Add a Kong route (if routed via Kong)

Add an entry to `kong/kong.template.yml`:

```yaml
services:
  - name: myservice-service
    url: http://myservice:8080
    routes:
      - name: myservice-route
        hosts: ["${MY_SERVICE_DOMAIN}"]
        protocols: ["http", "https"]
        strip_path: false
        preserve_host: true
```

### 4. Add a Traefik route (if bypassing Kong)

Add Docker labels to the service in `docker-compose.yml`:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.myservice.rule=Host(`${MY_SERVICE_DOMAIN}`)"
  - "traefik.http.routers.myservice.entrypoints=websecure"
  - "traefik.http.routers.myservice.tls.certresolver=letsencrypt"
  - "traefik.http.routers.myservice.middlewares=oidc-auth@file"  # if protected
  - "traefik.http.services.myservice-svc.loadbalancer.server.port=8080"
```

### 5. Register a Keycloak client (if SSO-integrated)

Add the client to `keycloak/realm-export.json`. The realm is only imported once on Keycloak's first boot. After that, apply changes via the Keycloak admin console or use the Keycloak Admin REST API in a one-shot init container.

### 6. Update `sample.env`

Add all new environment variables to `sample.env` with clear comments. Follow the existing sections. Never put real values in `sample.env` — use `yourdomain.com` as the placeholder domain.

### 7. Update documentation

- Add the service to `99_maintainers/02_services.md`.
- Update the startup order diagram in `99_maintainers/01_architecture.md` if it has `depends_on` implications.
- Update the network diagram in `99_maintainers/05_networking.md`.

---

## Extending the Management API

### Adding a new endpoint to an existing module

1. Add the route method to the controller with `@ApiOperation()`, `@ApiResponse()`, and appropriate decorators.
2. Implement the business logic in the service.
3. Write unit tests in `*.spec.ts` colocated with the service/controller.
4. Add a DTO if needed (`dto/my-new.dto.ts`), export it from `dto/index.ts`.

### Adding a new feature module

Follow the NestJS module pattern used by `templates`, `configs`, `projects`:

```sh
# Directory structure
api/src/myfeature/
  myfeature.module.ts
  myfeature.controller.ts
  myfeature.service.ts
  myfeature.service.spec.ts
  dto/
    create-myfeature.dto.ts
    myfeature-info.dto.ts
    index.ts
```

Register the module in `AppModule`:

```typescript
@Module({
  imports: [
    // ...existing modules
    MyFeatureModule,
  ],
})
export class AppModule {}
```

If the module needs `HttpService` (for external API calls), it is available globally from `HttpModule` — do not re-import it. Just inject `HttpService` in your service constructor.

### Adding a new external service integration

1. Create a module at `api/src/myintegration/`.
2. The service receives config via `ConfigService<AppConfiguration>`. Add the new config keys to `AppConfiguration` interface in `api/src/config/configuration.ts` and load them in the `configuration()` function.
3. Add corresponding environment variables to `sample.env`.
4. Add mock values to `TEST_CONFIG` in `api/test/helpers/mock-providers.ts`.
5. Export the module and add it to `AppModule` imports.

### Config key naming conventions

- Flat keys for top-level values: `domain`, `apiKey`, `logLevel`.
- Nested keys for service configs: `gitlab.url`, `vault.token`, `cloudflare.apiToken`.
- Access nested keys in code using `configService.get<string>('gitlab.url', { infer: true })`.
- Access nested keys in `TEST_CONFIG` as dot-notation strings: `'gitlab.url': 'http://gitlab'`.

---

## Environment variable conventions

- All new variables must appear in `sample.env` first.
- Use `yourdomain.com` as the placeholder domain (never real values).
- Add the variable to the appropriate section in `sample.env` (grouped by service or concern).
- If removing a variable, add it to `.env.deleted` with a removal date and reason.
- Never read `.env` files directly. The app reads from `process.env`, which Docker Compose populates from `.env`.

---

## Debugging runbook

### Service won't start

```sh
docker compose ps                    # check status
docker compose logs <service>        # view logs
docker compose logs --tail=50 <svc>  # recent logs only
```

### OpenBao is sealed after restart (production mode only)

In the current v1 setup (dev mode), OpenBao auto-unseals on every start. If you've switched to production mode:

```sh
docker exec vault bao status
docker exec vault bao operator unseal <key1>
docker exec vault bao operator unseal <key2>
docker exec vault bao operator unseal <key3>
```

### Keycloak realm not imported

The realm import only runs on first boot (when the database is empty). To re-import:
```sh
docker compose stop keycloak
docker compose rm -f keycloak
# Option A: Wipe the database (destructive)
rm -rf .vols/keycloak-db
docker compose up -d keycloak-db keycloak
# Option B: Apply changes via Keycloak admin console instead
```

### Kong routes missing after database wipe

Re-run the platform route seeding first:

```sh
docker compose run --rm kong-deck-sync
```

Then re-run provisioning for affected projects via `POST /projects`, or manually recreate routes via the Kong Admin API.

### Management API fails to connect to GitLab

Check that `GITLAB_URL=http://gitlab` (not the public hostname) and that the `api` container is on `devops-network`. Verify the `GITLAB_ROOT_TOKEN` is valid:

```sh
curl -H "PRIVATE-TOKEN: <token>" http://localhost:80/api/v4/projects
```

### Traefik certificate not issued

1. Check `docker logs traefik` for ACME errors.
2. Verify `CF_DNS_API_TOKEN` has `Zone:DNS:Edit` + `Zone:Zone:Read` permissions.
3. Check `.vols/traefik/certs/acme.json` — if it has `"Certificates": null` or is empty, Traefik hasn't obtained the cert yet.
4. On Windows Docker, `acme.json` may have wrong permissions — the entrypoint handles this automatically, but you can verify inside the container: `docker exec traefik ls -la /etc/traefik/certs/acme.json` (should be `600`).
5. Traefik waits 60 seconds after DNS record creation before validating (`propagation.delayBeforeChecks`). Check logs for "Checking DNS record propagation" to confirm the wait is happening.
6. Delete `acme.json` contents and restart Traefik to force a new challenge: `docker exec traefik sh -c 'echo "{}" > /etc/traefik/certs/acme.json'` then `docker compose restart traefik`.

### oauth2-proxy cookie issues

If users are redirected in a loop:
1. Verify `OAUTH2_PROXY_COOKIE_SECRET` is a valid 16/24/32-byte base64 string.
2. Verify `OAUTH2_PROXY_COOKIE_DOMAINS` matches `.devops.yourdomain.com` (note the leading dot).
3. Clear 