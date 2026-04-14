# Day-to-Day Operations

← [Back to Infra Guide](index.md)

Once the platform is running, here's what you'll commonly need to do to keep it healthy.

---

## Starting and stopping

To start (or restart) the full stack:

```bash
docker compose up -d
```

To shut it all down gracefully:

```bash
docker compose down
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
- `.vols/kong-db/` — Kong database (routes, services, plugins)
- `.vols/traefik/` — ACME certificate storage (your Let's Encrypt certificates)

Treat this entire folder as sensitive. Anyone with access to these files can potentially extract secrets or impersonate users.

---

## Backups

There's no automated backup system in v1. At minimum, periodically copy the `.vols/` folder to a separate location (an external drive, object storage, or a different server).

If the platform goes down and you restore `.vols/` from a backup, you can bring the stack back up with `docker compose up -d` and pick up from where you left off — as long as the `.env` file is also preserved.

The most critical folders to back up are:

- `.vols/gitlab/` — losing this means losing all repositories
- `.vols/vault/` — losing this means losing stored OpenBao secrets
- `.vols/keycloak-db/` — losing this means losing users and SSO configuration

If you lose `.vols/kong-db/` or `.vols/traefik/`, Kong and Traefik will reinitialize from their configuration files, and Traefik will request new certificates automatically.

---

## Upgrading services

This platform pins specific image versions in `docker-compose.yml` to prevent unexpected behavior from automatic updates. To upgrade a service:

1. Update the image tag in `docker-compose.yml` (e.g., change `gitlab/gitlab-ce:18.10.1-ce.0` to a newer version)
2. Pull the new image: `docker compose pull <service-name>`
3. Recreate the container: `docker compose up -d --no-deps --force-recreate <service-name>`
4. Check logs for any migration errors: `docker compose logs -f <service-name>`

**GitLab upgrades require special care.** GitLab has a strict version upgrade path — you cannot skip from a very old version to a very new one without going through intermediate versions. Always check the [GitLab upgrade path tool](https://gitlab-com.gitlab.io/support/toolbox/upgrade-path/) before upgrading.

For other services, minor version bumps are generally safe. Major version bumps may have breaking changes — check the service's release notes before upgrading.
