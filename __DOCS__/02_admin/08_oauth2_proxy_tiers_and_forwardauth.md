# Adding tiered OIDC with oauth2-proxy (Traefik ForwardAuth)

This guide explains **how to extend** the platform when you need **more than one authorization policy** for browser flows that use [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) in front of tools that do not speak OIDC themselves. You do that by **adding oauth2-proxy instances** (and matching Traefik ForwardAuth middlewares and Keycloak clients)—not by flipping a single “tiers” switch.

---

## What exists today

The repo runs **one** `oauth2-proxy` container. Traefik’s ForwardAuth middleware **`oidc-auth`** is defined in [`traefik/dynamic/forward-auth.yml`](../../traefik/dynamic/forward-auth.yml) and delegates login checks to **`http://oauth2-proxy:4180/`**. Operator surfaces that need SSO attach that middleware via **Docker labels** in [`docker-compose.yml`](../../docker-compose.yml) (for example the Traefik dashboard and MinIO console).

---

## Why you would add another tier

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
