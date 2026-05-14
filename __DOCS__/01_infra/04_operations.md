# Day-to-Day Operations

← [Back to Infra Guide](index.md)

Once the platform is running, here's what you'll commonly need to do to keep it healthy.

---

## Starting and stopping

To start (or restart) the full stack, include the profile for your chosen ingress mode:

```bash
# Direct (no extra profile)
docker compose up -d

# Cloudflare Tunnel
docker compose --profile cftunnel up -d

# VPN edge
docker compose --profile vpnedge up -d
```

To shut it all down gracefully (include the profile so Docker also stops the profile-gated container):

```bash
docker compose down
# or, if a profile was active:
docker compose --profile cftunnel down
docker compose --profile vpnedge down
```

This stops and removes the containers, but **does not delete any data** — everything in `.vols/` is preserved.

If you only want to restart a single service (for example, after changing its configuration in `.env`):

```bash
docker compose up -d --no-deps --force-recreate gitlab
```

Replace `gitlab` with the name of whichever service you want to restart. The `--force-recreate` flag is important — it ensures the container is rebuilt from scratch so it picks up any new environment variables.

> **Note**: `docker compose restart <service>` does not re-read environment variables from `.env`. Always use `up -d --force-recreate` if you've changed configuration.

---

## Viewing logs

To watch all services at once:

```bash
docker compose logs -f
```

To watch a specific service:

```bash
docker compose logs -f gitlab
docker compose logs -f keycloak
docker compose logs -f traefik
```

Press `Ctrl+C` to stop watching. The logs continue running in the background.

To see the last 100 lines of logs without following:

```bash
docker compose logs --tail=100 gitlab
```

---

## Checking service health

```bash
docker compose ps
```

This shows the current state of every container. A healthy service shows `healthy` in the Status column. If something shows `unhealthy` or keeps restarting, check its logs.

---

## Where data lives

All persistent data is stored under `.vols/` in the project root. This folder is git-ignored — it won't be committed to version control. It contains:

- `.vols/gitlab/` — GitLab repositories, registry images, uploads, and configuration
- `.vols/gitlab-runner/` — GitLab Runner configuration and build cache
- `.vols/vault/` — OpenBao secrets storage
- `.vols/keycloak-db/` — Keycloak database (users, realm configuration, OIDC clients)
- `.vols/mongo/` — MongoDB data (Management API registry)
- `.vols/traefik/` — ACME certificate storage (your Let's Encrypt certificates)

Treat this entire folder as sensitive. Anyone with access to these files can potentially extract secrets or impersonate users.

---

## Backups

The platform stores all durable state under **`.vols/`** plus your **`.env`** at the repo root. Both are git-ignored.

### Creating an archive

From the repository root:

```bash
make backup
```

This runs [`bootstrap/backup.sh`](../../bootstrap/backup.sh), which writes `backups/platform-<timestamp>.tar.gz` containing `.env` (if present) and `.vols/`, while skipping bulky rebuildable paths (for example GitLab build caches and logs, and local `node_modules`). The `backups/` directory is listed in `.gitignore` — treat archives as **sensitive** (they include secrets and full GitLab data).

**Retention:** keep a small number of recent archives on separate storage (external disk or object storage). Rotate old files manually; there is no built-in retention job.

### Restoring

1. Stop the stack so files are not locked: `docker compose down` (include `--profile …` if you use Cloudflare Tunnel or VPN edge).
2. Extract the archive:

```bash
make restore ARCHIVE=backups/platform-YYYYMMDD-HHMMSS.tar.gz
```

3. Start Compose again (`docker compose up -d` with the right profile), then re-run Kubernetes bootstrap steps if needed (`./bootstrap/bootstrap.sh` or the individual `bootstrap/*.sh` scripts after k3d).

`restore.sh` refuses to run while any Compose container for this project is still running.

### Reset without a backup

If you only need to wipe Kubernetes state but keep GitLab/Vault volumes, use `make reset`. For a full wipe including `.vols`, see [Reset from zero](05_reset_from_zero.md) and `make reset ARGS=--all` (interactive confirmation).

---

## Upgrading services

This platform pins specific image versions in `docker-compose.yml` to prevent unexpected behavior from automatic updates. To upgrade a service:

1. Update the image tag in `docker-compose.yml` (e.g., change `gitlab/gitlab-ce:18.10.1-ce.0` to a newer version)
2. Pull the new image: `docker compose pull <service-name>`
3. Recreate the container: `docker compose up -d --no-deps --force-recreate <service-name>`
4. Check logs for any migration errors: `docker compose logs -f <service-name>`

**GitLab upgrades require special care.** GitLab has a strict version upgrade path — you cannot skip from a very old version to a very new one without going through intermediate versions. Always check the [GitLab upgrade path tool](https://gitlab-com.gitlab.io/support/toolbox/upgrade-path/) before upgrading.

For other services, minor version bumps are generally safe. Major version bumps may have breaking changes — check the service's release notes before upgrading.
