# Adding tiered OIDC with oauth2-proxy (Traefik ForwardAuth)

This guide explains **how to extend** the platform when you need **more than one authorization policy** for browser flows that use [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) in front of tools that do not speak OIDC themselves. You do that by **adding oauth2-proxy instances** (and matching Traefik ForwardAuth middlewares and Keycloak clients)—not by flipping a single “tiers” switch.

---

## What exists today

The repo runs **three** oauth2-proxy containers:

| Instance | Middleware | Surfaces | Default groups |
|----------|------------|----------|----------------|
| **`oauth2-proxy`** | `oidc-auth@file` | Operator UIs via Docker labels (Traefik dashboard, MinIO console, console, …) | `admins` (`OAUTH2_PROXY_ALLOWED_GROUPS`) |
| **`oauth2-proxy-apps`** | (reverse proxy, opt-in per path — see below) | Specific app-zone paths only, e.g. `/app/*` on `*.dev.apps.<DOMAIN>` / `*.stg.apps.<DOMAIN>` | `admins,users` (`OAUTH2_PROXY_APPS_ALLOWED_GROUPS`) |
| **`oauth2-proxy-devtools`** | `oidc-auth-devtools@file` | Shared DevTools UIs (Grafana Explore) | `admins,users` (`OAUTH2_PROXY_DEVTOOLS_ALLOWED_GROUPS`) |

`oauth2-proxy-devtools` is ForwardAuth-only (`static://202`). It **reuses** the `oauth2-proxy-apps` Keycloak client, cookie name/secret, and callback on `OAUTH_APPS_DOMAIN` so login completes on the apps proxy while DevTools routers only validate the session.

**Gating is opt-in per `Host + PathPrefix`, not per zone.** [`traefik/dynamic/k3d-passthrough.yml`](../../traefik/dynamic/k3d-passthrough.yml) routes all three app zones (prod, stg, dev) straight to `k3d-ingress` (ungated) at priority 10. [`traefik/dynamic/oauth2-proxy-apps-gated-paths.yml`](../../traefik/dynamic/oauth2-proxy-apps-gated-paths.yml) adds narrower `Host() && PathPrefix()` routers at priority 100 that intercept only the paths that must require a platform SSO session (typically a frontend's UI path, e.g. `/app`) before those requests reach `oauth2-proxy-apps-upstream`. Everything else on the same host — APIs, health checks, GraphQL, etc. — falls through to the ungated priority-10 router.

This means: **APIs are never gated at this layer.** They're expected to enforce their own app-level auth (JWT, etc.), so local dev tooling, CI smoke checks, and service-to-service calls can reach dev/stg APIs directly without a browser SSO session. Only paths you explicitly add to `oauth2-proxy-apps-gated-paths.yml` require platform login.

ForwardAuth middlewares in [`traefik/dynamic/forward-auth.yml`](../../traefik/dynamic/forward-auth.yml):

- **`oidc-auth`** → **`http://oauth2-proxy:4180/`** (operators)
- **`oidc-auth-devtools`** → **`http://oauth2-proxy-devtools:4182/`** (Grafana / shared DevTools)
- Optional **`oidc-auth-apps`** → **`/oauth2/auth`** on apps proxy if you attach ForwardAuth manually; the shipped app-zone path uses reverse-proxy mode instead.

Callback hostnames: **`OAUTH_DOMAIN`** (operator) and **`OAUTH_APPS_DOMAIN`** (app zones). Both must resolve to Traefik and appear in Keycloak client redirect URIs.

---

## How to gate a new app path

To require platform SSO login for a new app's UI (or any other path you want gated), add a router to [`traefik/dynamic/oauth2-proxy-apps-gated-paths.yml`](../../traefik/dynamic/oauth2-proxy-apps-gated-paths.yml) — no other file needs to change, and no restart is needed (the file provider watches for changes):

```yaml
http:
  routers:
    gated-<name>-<env>-ui:
      rule: "Host(`<host>`) && PathPrefix(`<path-prefix>`)"
      entryPoints:
        - websecure
      service: oauth2-proxy-apps-upstream
      priority: 100
```

- `priority: 100` must stay higher than the `priority: 10` ungated zone routers in `k3d-passthrough.yml`, or the ungated router wins the match.
- `service: oauth2-proxy-apps-upstream` is defined once in `k3d-passthrough.yml` and reused here — Traefik's file provider merges services across all files in `traefik/dynamic/`.
- Do **not** gate `/api/*` paths this way — see the "APIs are never gated" note above.
- Duplicate the block per environment (dev/stg) with the matching host.

---

## Existing Keycloak realms (manual client patch)

`realm-export.json` is applied on **first** Keycloak import only. On an already-running platform, create the **`oauth2-proxy-apps`** client in the Keycloak admin UI (or import the client JSON) before starting `oauth2-proxy-apps`:

1. **Clients → Create** — client ID `oauth2-proxy-apps`, confidential, standard flow enabled.
2. **Valid redirect URIs:** `https://${OAUTH_APPS_DOMAIN}/oauth2/callback`
3. **Web origins:** `https://${OAUTH_APPS_DOMAIN}`
4. **Client scopes:** include `groups` (same as the stock `oauth2-proxy` client).
5. **Credentials** — set the secret to match **`KC_CLIENT_SECRET_OAUTH2_PROXY_APPS`** in `.env`.

Then add the new `.env` keys from `sample.env`, run `bootstrap/patch-keycloak-oauth2-proxy-apps.sh` (falls back to `bootstrap/seed-keycloak-oauth2-proxy-apps-db.sh` when Admin API login fails), then `docker compose up -d oauth2-proxy-apps traefik`, and verify a dev/stg hostname redirects to Keycloak for unauthenticated browsers.

---

Typical reasons:

- **Different routes need different group lists** (for example Traefik dashboard only for `admins`, but another hostname should allow `staff` without opening admin UIs to them).
- **Different cookie/session domains** or **different callback URLs** so sessions do not collide.
- **Different token lifetimes** or **different IdP clients** for audit separation.

---

## The moving pieces (checklist)

| Piece | What to duplicate / extend |
|-------|----------------------------|
| **Compose** | Second `oauth2-proxy-*` service on another listen port (e.g. `4181`) with its own `OAUTH2_PROXY_*` env block, especially `OAUTH2_PROXY_REDIRECT_URL`, `OAUTH2_PROXY_CLIENT_ID` / `SECRET`, `OAUTH2_PROXY_COOKIE_SECRET`, and allowlists. |
| **Traefik file provider** | Add a second middleware next to `oidc-auth` in `traefik/dynamic/forward-auth.yml` (or a new file in `traefik/dynamic/`) pointing `forwardAuth.address` at the second proxy’s `/` endpoint. |
| **Docker labels** | Attach `your-middleware@file` only on the routers that should use that tier. |
| **Keycloak** | New confidential client (or additional redirect URIs if you intentionally share a client), secrets in `.env`, and matching entries in `keycloak/realm-export.json` for repeatable imports. |
| **DNS / TLS** | Hostname for the extra callback must resolve to Traefik and be covered by ACME SANs (wildcard `*.devops.<DOMAIN>` usually covers `oauth-internal.devops.<DOMAIN>` style names). |

---

## ForwardAuth addressing (oauth2-proxy v7+)

The stock middleware uses the proxy **root** URL so unauthenticated users receive the **302** to Keycloak. `oauth2-proxy` is configured with `OAUTH2_PROXY_UPSTREAMS=static://202` so ForwardAuth checks return **202** when the session is valid.

---

## Router wiring patterns

| Mechanism | Best for | Typical keys |
|-----------|----------|--------------|
| **Docker labels** on a Compose service | Per-service hostnames (`traefik.http.routers.*`) | `rule`, `middlewares`, `tls.certresolver`, `priority` |
| **File provider YAML** | Shared middlewares and k3d passthrough routers | `http.middlewares.*`, `http.routers.*` in `traefik/dynamic/*.yml` |

When two routers could match the same host, set explicit **`priority`** on file routers (see [`traefik/dynamic/k3d-passthrough.yml`](../../traefik/dynamic/k3d-passthrough.yml) for examples).

---

## Worked pattern: `oidc-auth-internal@file`

1. **Compose** — copy the existing `oauth2-proxy` service block to `oauth2-proxy-internal`, change ports (`4181`), redirect URL host (`OAUTH_INTERNAL_DOMAIN`), client credentials, cookie secret, and `OAUTH2_PROXY_ALLOWED_GROUPS`.
2. **`forward-auth.yml`** — add:

```yaml
http:
  middlewares:
    oidc-auth-internal:
      forwardAuth:
        address: "http://oauth2-proxy-internal:4181/"
        trustForwardHeader: true
        authResponseHeaders:
          - "X-Auth-Request-User"
          - "X-Auth-Request-Email"
          - "X-Auth-Request-Access-Token"
```

3. **Labels** — on the internal-only router, use `oidc-auth-internal@file` instead of `oidc-auth@file`.
4. **Keycloak** — create `oauth2-proxy-internal` (or equivalent) with redirect URI `https://${OAUTH_INTERNAL_DOMAIN}/oauth2/callback`, then import or admin-console sync.

Bring containers up (`docker compose up -d traefik oauth2-proxy oauth2-proxy-internal …`) and verify with two users: one inside the new allowlist and one outside (expect **403** after IdP login for the outsider).

---

## Tier vocabulary (examples only)

| Tier (example name) | Intended surfaces | How it maps |
|--------------------|-------------------|-------------|
| **admin** | Highest-privilege operator UIs | Matches the default single-proxy setup when `OAUTH2_PROXY_ALLOWED_GROUPS=admins`. |
| **internal** | Staff-only tools | Duplicate proxy + middleware + client with a wider group list. |
| **external** | Separate callback domain for internet-facing demos | Same pattern with stricter redirect URI allowlists. |

Names are **not** enforced in code—they are documentation labels for how you split policies.

---

## Traefik recap

- **ForwardAuth** runs **before** the backend request; oauth2-proxy decides **302** vs **202**.
- **TLS** terminates at Traefik; oauth2-proxy sees HTTP inside the bridge network.
- **Session cookies** are scoped by `OAUTH2_PROXY_COOKIE_DOMAINS`; misconfiguration is the most common source of redirect loops.

---

## Further reading

- [Access and SSO](01_access_and_sso.md)
- [Networking — file provider](../../99_maintainers/05_networking.md)
