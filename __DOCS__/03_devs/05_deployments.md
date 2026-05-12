# Deployments and URLs

← [Back to Developer Guide](index.md)

When the Management API provisions a **deployable** project, it writes Auto DevOps (or template) CI, seeds Vault, records hostnames in MongoDB, and ensures Kubernetes namespaces exist. Your running service is exposed through **Ingress** inside k3d; the outer Traefik instance forwards `*.apps.<DOMAIN>` / `*.dev.apps.<DOMAIN>` / `*.stg.apps.<DOMAIN>` traffic into the cluster (see [`traefik/dynamic/k3d-passthrough.yml`](../../traefik/dynamic/k3d-passthrough.yml)).

---

## Where your app listens

The Helm chart / Auto DevOps defaults expect your container to listen on the port configured in GitLab CI (commonly **3000** for Node templates). The Service and Ingress map external HTTP(S) to that container port.

---

## Hostnames

Typical patterns (exact values come from your project's `appHosts` in MongoDB and CI variables such as `APP_HOST`):

- **Development:** `https://<effectiveSlug>.dev.apps.<DOMAIN>`
- **Staging:** `https://<effectiveSlug>.stg.apps.<DOMAIN>`
- **Production:** `https://<effectiveSlug>.apps.<DOMAIN>`

---

## Verifying a deployment

1. **GitLab pipeline** — the latest pipeline for your default branch should pass build and deploy stages.
2. **Ingress** — in the target namespace (`dev`, `stg`, or `prod`), `kubectl get ingress` should list a host rule matching your app zone.
3. **HTTP check** — `curl -vk https://<hostname>/` from a machine that resolves DNS to your platform should return your application response (or a redirect you intentionally configure).

---

## Troubleshooting

- **404 from inner Traefik** — Ingress host or path does not match the request; confirm chart values and GitLab environment-scoped variables.
- **TLS errors on the public hostname** — outer Traefik certificate SANs must cover your devops and apps zones; check `acme.json` / Traefik logs.
- **Pod not ready** — inspect Deployment events and image pull errors in the namespace.
