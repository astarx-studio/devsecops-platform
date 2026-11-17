# Vulnerability Assessment: operations

← [User manual](index.md)

For the operator who installs and maintains the VA stack. Users of the service read the [user manual](index.md).

---

## What it is

| Item | Value |
|---|---|
| Purpose | Manual vulnerability scans of the web apps and APIs hosted on this platform, with one fixed-layout report per scan |
| Compose project | `va` (`va/docker-compose.yml`), independent of the main stack, same pattern as `devtools/` |
| Launcher | `https://va.devops.<DOMAIN>` (`oidc-auth@file`, Keycloak group `admins`) |
| DefectDojo | `https://va-dojo.devops.<DOMAIN>` (`oidc-auth@file`; users are signed in from their platform identity, see [Sign-in](#sign-in)) |
| Scanners | OWASP ZAP, Nuclei, testssl.sh, Trivy (one-shot containers per scan), OpenVAS/GVM (always running) |
| Footprint | About 8 to 10 GB RAM idle, up to about 20 GB during a scan; about 25 GB disk for images and feeds |

```
Browser ─► Traefik ─► oidc-auth@file
             ├─ va.devops.<DOMAIN>      ─► va-launcher
             └─ va-dojo.devops.<DOMAIN> ─► va-dojo-nginx ─► va-dojo-uwsgi

va-launcher ─ Docker socket ─► ZAP / Nuclei / testssl.sh / Trivy (per scan)
            ─ gvmd socket   ─► OpenVAS (gvmd ─► ospd-openvas)
            ─ HTTP          ─► DefectDojo API (import findings, read them back for the report)
```

The launcher is one process: the web app plus a worker thread that runs one scan at a time. All state is in `va-postgres` (database `va_launcher`) and the data directory.

---

## Install

Prerequisites: the main stack is up (Traefik, Keycloak, oauth2-proxy), and `*.devops.<DOMAIN>` resolves to Traefik. No new DNS record, certificate or Keycloak client is needed.

1. **Storage (Windows host).** Scan data must not fill the repo's drive:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File D:\devsecops-platform\va\setup-storage.ps1
   ```

   This makes `va\.vols` a junction to `C:\dsoaas-va\vols` (pass `-DataRoot` for another location) and writes a marker file. It is safe to re-run. On a host that should keep data in `va/.vols` directly, skip this and set `VA_REQUIRE_STORAGE_MARKER=false`.

2. **Configuration.** Copy `va/sample.env` to `va/.env` and fill in every `change-me`. The file explains each value. `VA_ALLOWED_DOMAINS` decides what may be scanned.

3. **Start.**

   ```bash
   make va-up
   ```

   `make va-up` refuses to start if the storage marker is missing.

4. **Wait for the feeds.** OpenVAS loads its vulnerability feeds on first start; this takes 30 to 90 minutes. The launcher blocks scans and says so until it is done.

   ```bash
   make va-feed-status
   ```

5. **Traefik aliases (optional).** `VA_DOMAIN` and `VA_DOJO_DOMAIN` are also network aliases on the `traefik` service in the main `docker-compose.yml`. They only matter for containers that call these hostnames from inside `devops-network`; nothing in the VA stack does. They take effect the next time Traefik is recreated, so there is no need to restart Traefik for this install.

---

## Sign-in

Both hostnames use the platform's operator SSO (`oidc-auth@file`, Keycloak group `admins`). Neither app has a separate login for people.

Each Traefik router runs three middlewares in order:

1. `va-*-strip` deletes any `X-Auth-Request-Email` and `X-VA-Proxy-Secret` the client sent.
2. `oidc-auth@file` (oauth2-proxy) checks the platform session and sets `X-Auth-Request-Email`.
3. `va-*-secret` adds `X-VA-Proxy-Secret` (`VA_PROXY_SECRET` in `va/.env`).

The secret proves a request came through all three. Without it:

- **Launcher:** refuses every request except `/healthz` with 403. This matters because the launcher holds the Docker socket, and any container on `devops-network` (k3d pods included) can reach it directly.
- **DefectDojo:** ignores the identity header and falls back to its own authentication. That is how the launcher calls DefectDojo's API, as the local `admin` user with `VA_DOJO_ADMIN_PASSWORD`.

**DefectDojo accounts.** Open-source DefectDojo 3.x has no SSO of its own (its Keycloak, OIDC, SAML and remote-user options moved to the paid edition), so `va/dojo-settings/va_sso.py` adds it. DefectDojo copies that folder into its settings at start. On a user's first visit it creates an account named after their platform email, as a superuser (only `admins` get past oauth2-proxy), with no password. An existing account keeps whatever rights were set in DefectDojo; deactivating it in DefectDojo stops that person's automatic sign-in.

**Logout** in DefectDojo goes to `VA_SIGNOUT_URL`: oauth2-proxy's sign-out, then Keycloak's logout page. A DefectDojo-only logout would be undone by the next request.

**The local `admin` account** stays for the launcher's API access (`VA_DOJO_ADMIN_PASSWORD`). Browsers cannot use it: every browser request carries the secret, so it is signed in as the platform user. If Keycloak is down, DefectDojo is unreachable like every other operator UI.

**Rotating `VA_PROXY_SECRET`:** change it in `va/.env`, then `make va-up`. Traefik picks up the new label value when the containers are recreated.

---

## Storage

| Data | Location | Notes |
|---|---|---|
| Reports, raw tool output, uploads, Nuclei templates, Trivy cache | `va/.vols/launcher` → `C:\dsoaas-va\vols\launcher` | Bind mount through the junction |
| `va-postgres`, `va-valkey`, DefectDojo media | Named volumes `va-postgres-data`, `va-valkey-data`, `va-dojo-media` | Inside Docker's own disk (`docker_data.vhdx`, on `C:`) |
| OpenVAS database, feeds, sockets | Named volumes `va-gvm-*` | Same. They must be named volumes: gvmd, Postgres and the scanner talk over unix sockets, which do not work on Windows bind mounts |

Raw tool output under `launcher/scans/` is deleted after `VA_RAW_RETENTION_DAYS` (default 30). Reports under `launcher/reports/` are kept.

Uploaded API definitions and auth scripts under `launcher/uploads/` are encrypted with `VA_SECRET_KEY`.

---

## Routine tasks

| Task | How |
|---|---|
| Status | `make va-status` |
| Stop / start | `make va-down` / `make va-up`. Data is kept. A scan that was running is marked failed. |
| Update OpenVAS feeds | `make va-feed-update`. Feeds ship as container images; this pulls newer ones and reloads. Scans are blocked while they load. Do this weekly. |
| Update Nuclei templates | Automatic: Nuclei refreshes its templates in `launcher/cache/nuclei-templates` when a scan starts. |
| Update scanners | `docker pull` the images named in `va/.env` (`VA_ZAP_IMAGE`, …). The next scan uses them, and the report records the image digest. |
| Update DefectDojo | Change `VA_DOJO_VERSION`, then `make va-up`. The initializer applies database migrations. Read DefectDojo's release notes first. |
| Launcher tests | `make va-test` |
| Add an allowed domain | Edit `VA_ALLOWED_DOMAINS` in `va/.env`, then `make va-up`. |
| Change the OpenVAS password | Edit `VA_GVM_PASSWORD`, then `make va-up` (the `gvmd-set-password` one-shot applies it). |
| Change the DefectDojo `admin` password | This is the launcher's API account. Change it in DefectDojo's UI **and** in `VA_DOJO_ADMIN_PASSWORD`, then `make va-up`. The env value alone is only applied when the database is first created. |

### Backup

Not covered by `make backup`. To back up:

- `C:\dsoaas-va\vols\launcher\reports` (the reports).
- `va-postgres`: `docker exec va-postgres pg_dumpall -U defectdojo > va-postgres.sql` (launcher state and all findings).
- `va/.env`. Without `VA_SECRET_KEY`, stored logins and uploads cannot be decrypted.

OpenVAS data does not need a backup; it is rebuilt from the feeds.

---

## Security notes

- **The launcher holds the Docker socket.** Anyone who can reach it can start containers on the host. It accepts only requests that came through Traefik's SSO check (see [Sign-in](#sign-in)). Do not widen that check to `oidc-auth-devtools`, and keep `VA_PROXY_SECRET` set.
- **Allowlist.** Targets, login URLs, token URLs and API-definition servers must be under `VA_ALLOWED_DOMAINS`. IP addresses are refused. ZAP's scope is the target's exact origin, so redirects to other hosts are not followed into.
- **Secrets.** Login profiles, variable overrides and uploads are encrypted with `VA_SECRET_KEY`. ZAP's plan file (which contains credentials) is deleted when ZAP exits, and tool logs are redacted before they are written.
- **DefectDojo images** are pulled from Docker Hub, not `registry.defectdojo.com`, which logs who pulls. Set `DD_IMAGE_REGISTRY` to change that.
- **OpenVAS scans the public address** of the target host. With the VPN edge, that is the edge VM. Scanning your own cloud instances normally needs no notice to the provider, but check your provider's policy.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Launcher banner: "…has no .va-storage marker" | Run `va/setup-storage.ps1`, then `docker restart va-launcher`. |
| "OpenVAS is not ready" for more than two hours | `docker logs va-gvm-gvmd --tail 50` and `make va-feed-status`. If `va-gvm-set-password` exited non-zero, run `docker compose -p va -f va/docker-compose.yml --env-file va/.env up -d gvmd-set-password`. |
| "DefectDojo is not reachable" | `docker logs va-dojo-initializer` (first start takes several minutes), then `va-dojo-uwsgi`. A login failure means `VA_DOJO_ADMIN_PASSWORD` no longer matches the admin account. |
| DefectDojo shows its own login form after the platform sign-in | The secret did not arrive: `VA_PROXY_SECRET` differs between Traefik's label and the containers (recreate both with `make va-up`), or `docker logs va-dojo-uwsgi` lacks "Overriding DefectDojo's local_settings.py" (the `dojo-settings` mount is missing). |
| Launcher answers "Use https://va.devops…" with 403 | The request did not come through Traefik, or the secret changed without recreating `va-launcher`. |
| A scanner fails immediately with a mount error | The launcher passes the host path of its data directory to scanner containers. `docker inspect va-launcher` must show a bind mount at `/data`. |
| Internal-route scans cannot connect | The launcher pins the target's hostname to the `traefik` container's address on `devops-network`. Check `VA_TRAEFIK_CONTAINER` and `VA_INGRESS_NETWORK`. Use the Public route as a workaround. |
| ZAP is killed mid-scan | Memory limit. Raise `VA_SCANNER_MEM_LIMIT` (default `4g`). |
| Leftover `va-zap-*` / `va-nuclei-*` containers after a crash | `docker rm -f $(docker ps -aq --filter label=va.scan=true)` |

---

## Not in this version

Scheduled scans, CI triggers, notifications, access for non-admins, secrets in OpenBao, and token refresh during a scan. Database tables are created on start without migrations; a launcher upgrade that changes the schema will say so in its release notes.
