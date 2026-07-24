# Deployments and URLs

← [Back to Developer Guide](index.md)

When the Management API provisions a **deployable** project, it writes Auto DevOps (or template) CI, seeds Vault, records hostnames in MongoDB, and ensures Kubernetes namespaces exist. Your running service is exposed through **Ingress** inside k3d; the outer Traefik instance forwards `*.apps.<DOMAIN>` / `*.dev.apps.<DOMAIN>` / `*.stg.apps.<DOMAIN>` traffic into the cluster (see [`traefik/dynamic/k3d-passthrough.yml`](../../traefik/dynamic/k3d-passthrough.yml)).

---

## Where your app listens

The **`dsoaas-app`** Helm chart defaults the Service **`targetPort` to 80** so clusters do not need per-repo port overrides. Use **`EXPOSE 80`** and set your process to listen on port **80** inside the container (for Node, `ENV PORT=80` is typical). Older templates that listen on **3000** should either switch to 80 or override chart values consistently. Ingress maps HTTP from inner Traefik to that Service port.

---

## Hostnames

Typical patterns (exact values come from your project's `appHosts` in MongoDB and CI variables such as `APP_HOST`):

- **Development:** `https://<effectiveSlug>.dev.apps.<DOMAIN>` — **ungated by default.** No platform-level login gate unless your team explicitly registered a gated path (see below); rely on your own application auth for APIs.
- **Staging:** `https://<effectiveSlug>.stg.apps.<DOMAIN>` — same, ungated by default.
- **Production:** `https://<effectiveSlug>.apps.<DOMAIN>` — no platform-level login gate; rely on application auth if needed.

**Opting into platform SSO for a specific path** (e.g. a frontend's UI, not its API): ask platform ops to add a `Host() && PathPrefix()` router to [`traefik/dynamic/oauth2-proxy-apps-gated-paths.yml`](../../traefik/dynamic/oauth2-proxy-apps-gated-paths.yml) in `devsecops-platform` — see [how to gate a new app path](../02_admin/08_oauth2_proxy_tiers_and_forwardauth.md#how-to-gate-a-new-app-path). Only that path prefix on that host requires DSOaaS Keycloak login (groups **`admins`** or **`users`**); everything else on the same host (including your APIs) stays ungated.

---

## Verifying a deployment

1. **GitLab pipeline** — the latest pipeline for your default branch should pass build and deploy stages.
2. **Ingress** — in the target namespace (`dev`, `stg`, or `prod`), `kubectl get ingress` should list a host rule matching your app zone.
3. **HTTP check** — from a browser, open the hostname while logged into DSOaaS Keycloak (dev/stg require platform login first). For scripted checks, unauthenticated `curl` to dev/stg URLs returns **302** to Keycloak — use in-cluster probes or authenticated sessions instead.

---

## Troubleshooting

- **404 from inner Traefik** — Ingress host or path does not match the request; confirm chart values and GitLab environment-scoped variables.
- **TLS errors on the public hostname** — outer Traefik certificate SANs must cover your devops and apps zones; check `acme.json` / Traefik logs.
- **Pod not ready** — inspect Deployment events and image pull errors in the namespace.
