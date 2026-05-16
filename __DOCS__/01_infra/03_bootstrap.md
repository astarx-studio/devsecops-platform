# Starting the Platform for the First Time

← [Back to Infra Guide](index.md)

Once your `.env` file is filled in, you're ready to start the platform. This page walks you through the first boot, what to expect, and how to tell if everything came up correctly.

---

## Before you start

Double-check that your `.env` file is in place and the required fields are filled. You can ask Docker Compose to validate the file for you — this catches things like missing variables or syntax errors:

```bash
docker compose config
```

If this command prints a long YAML output without errors, you're good to go. If it complains about a missing variable, go back to your `.env` and fill it in.

---

## Starting everything

Run this from the project root (the folder that contains `docker-compose.yml`). The command depends on which public ingress mode you chose during [prerequisites](01_prereqs.md#choosing-a-public-ingress-mode):

**Direct (default) — no additional profile:**
```bash
docker compose up -d
```

**Cloudflare Tunnel:**
```bash
docker compose --profile cftunnel up -d
```

**VPN edge (WireGuard):**
```bash
docker compose --profile vpnedge up -d
```

The `--profile` flag activates the extra profile-gated service (`cloudflared` or `wireguard`) alongside all the core services. If you omit it, only the core platform starts.

The `-d` flag means "detached" — it runs everything in the background so you get your terminal back immediately.

Docker will pull any missing images (this may take a few minutes on first run), create the internal network, and start all containers.

---

## Full stack bootstrap (Docker + k3d + Vault auth)

After the Compose stack is healthy and `.env` contains GitLab and Vault tokens plus `GITLAB_CONFIG_GROUP_ID`, you can run the **orchestrated** bootstrap (Compose is already expected up — the script runs `docker compose up -d` again idempotently, waits for GitLab, then k3d and Kubernetes steps):

```bash
make bootstrap
```

Equivalent:

```bash
./bootstrap/bootstrap.sh
```

**Optional environment:**

| Variable | Effect |
|---|---|
| `COMPOSE_EXTRA_ARGS` | Example: `--profile cftunnel` or `--profile vpnedge` passed to `docker compose up`. |
| `SKIP_SEED=1` | Skip [`bootstrap/seed-platform-projects.sh`](../../bootstrap/seed-platform-projects.sh) (GitLab API sync of shared config repos). |
| `SKIP_SMOKE=1` | Skip [`bootstrap/smoke-test.sh`](../../bootstrap/smoke-test.sh). |

**Post-bootstrap checks only:**

```bash
make smoke
```

Order inside `bootstrap/bootstrap.sh`: **prereqs** → **docker compose up** → **wait GitLab** → **k3d-cluster** → **k8s-primitives** → **vault-k8s-auth** → **runner-rbac** → **seed** → **smoke**. Compose starts **MinIO** with GitLab; artifact uploads depend on MinIO being healthy (see `docker-compose` service order). Details and pitfalls (NodePort, passthrough, `HostRegexp`) are in [k3d and Kubernetes](06_k3d_and_k8s.md).

### End-to-end smoke deploy (optional)

`make smoke` only checks infrastructure (k3d, Traefik, ESO, Management API `/health`). To validate **provisioning → GitLab CI → deploy → HTTPS** in one go (typically three to eight minutes with a registered runner), run:

```bash
./bootstrap/smoke-deploy.sh
```

Optional: `./bootstrap/smoke-deploy.sh --cleanup` deletes the throwaway project from the Management API after a successful URL check. Required `.env` entries include `API_KEY`, `GITLAB_ROOT_TOKEN`, and `GITLAB_DOMAIN`. Override defaults with `SMOKE_SLUG`, `SMOKE_GROUP_PATH` (slash-separated parent path, for example `clients/acme`), `SMOKE_TIMEOUT`, and `API_LOCAL_PORT` if needed. The Make target does not pass flags; invoke the script directly for `--cleanup`.

> **VPN edge only:** after the stack is up and the `wireguard` container is healthy, continue with the **Edge VM bootstrap** steps in [Networking — VPN edge ingress](../99_maintainers/05_networking.md#edge-vm-bootstrap-fresh-ubuntu) to configure the cloud VM. The platform is reachable locally before this step; the edge VM makes it reachable from the internet.

---

## What to expect

Not everything starts at the same speed. Here's roughly what happens:

- **Traefik and MongoDB** come up in seconds. Traefik will start requesting HTTPS certificates from Let's Encrypt via DNS-01 challenge. The certificate issuance process waits 60 seconds for DNS propagation before validation, so expect about 90–120 seconds for the first certificate to be ready.
- **Keycloak** takes about 30–90 seconds to fully initialize.
- **GitLab** is the slowest. On first boot it can take **3–10 minutes** to finish initializing. This is normal — it's running database migrations and setting up internal configurations. If you open GitLab in a browser too soon, you may get a 502 error. Just wait and refresh.
- **The Management API** waits for GitLab and Keycloak to be healthy before it considers itself ready.

---

## Watching the logs

You can watch what's happening in real time:

```bash
# Watch all services at once
docker compose logs -f

# Watch just GitLab (most useful during first boot)
docker compose logs -f gitlab

# Watch Keycloak
docker compose logs -f keycloak
```

Press `Ctrl+C` to stop watching without stopping the services.

---

## Checking health status

Once things have had a few minutes to start:

```bash
docker compose ps
```

This shows each service, its status, and whether its health check is passing. You want to see `healthy` or `running` for all services. A service stuck in `starting` is still initializing — give it more time.

---

## Confirming the platform is up

Once all services are healthy, try opening these in a browser (replace `yourdomain.com` with your actual domain):

| Service | URL | Expected result |
|---|---|---|
| GitLab | `https://gitlab.devops.yourdomain.com` | Login page |
| Keycloak | `https://auth.devops.yourdomain.com` | Keycloak welcome page |
| OpenBao | `https://vault.devops.yourdomain.com` | OpenBao UI login |
| Traefik dashboard | `https://traefik.devops.yourdomain.com` | Traefik UI behind oauth2-proxy (after login) |
| Management API | `https://api.devops.yourdomain.com/health` | `{"status":"ok"}` in plain text |

If you see HTTPS padlock icons in your browser and the pages load, certificates are working. If you see a certificate warning, Traefik may still be in the process of issuing the certificate — wait a minute and try again.

> **VPN edge only:** these URLs will load on your local network immediately. From outside your network, they will only work after you complete the [Edge VM bootstrap](../99_maintainers/05_networking.md#edge-vm-bootstrap-fresh-ubuntu). On first load from outside, open `https://gw.devops.yourdomain.com` (small response) then `https://gitlab.devops.yourdomain.com` (large response) to exercise the full path.

---

## Common issues during first boot

**GitLab takes very long or shows 502 errors**

This is normal for the first boot. GitLab runs database migrations and configuration setup before it's usable. Wait 5–10 minutes and refresh. If it's been more than 15 minutes, check the logs:

```bash
docker compose logs -f gitlab
```

Look for lines mentioning errors or panics.

---

**Certificate errors in the browser (invalid SSL / "not secure")**

This usually means Traefik hasn't finished issuing the certificate yet. Check the Traefik logs:

```bash
docker compose logs -f traefik
```

If you see messages about `DNS challenge` or `ACME`, it's in progress. If you see errors mentioning `rate limit`, you've hit Let's Encrypt's limit for certificate requests. This can happen if you've made many failed attempts — the limit resets after a week.

If you see errors about `invalid token` or `permission denied`, your `CLOUDFLARE_API_TOKEN` may not have the right permissions. Go back to [the prerequisites](01_prereqs.md#a-cloudflare-api-token) and verify the token has Zone/DNS/Edit and Zone/Zone/Read permissions.

---

**Keycloak starts but services can't log in via SSO**

This is usually an OIDC issuer configuration issue. Each service needs to be able to reach Keycloak using a consistent URL. In this platform, the issuer URL is always the public HTTPS URL (`https://auth.devops.yourdomain.com`), and internal containers reach it through the Docker network via Traefik.

If you're seeing redirects loop or token exchange fails, check:
- Does `https://auth.devops.yourdomain.com` load correctly in a browser?
- Are your `KC_CLIENT_SECRET_*` values in `.env` matching the values in `keycloak/realm-export.json`?
- Has Keycloak finished its first-time initialization? (Check `docker compose logs -f keycloak`)

---

**SMTP test emails don't arrive**

GitLab and Keycloak will boot fine even if SMTP is misconfigured — they just won't be able to send email. After the platform is up, you can test SMTP from within each tool (see [GitLab admin](../02_admin/02_gitlab.md) and [Keycloak admin](../02_admin/03_keycloak.md)).

---

Once you've confirmed the platform is running, you can start on the [admin setup tasks](../02_admin/index.md), continue to [k3d and Kubernetes](06_k3d_and_k8s.md) if you use Auto DevOps, or move on to [day-to-day operations](04_operations.md).
