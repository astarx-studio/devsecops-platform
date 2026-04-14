# Reset From Zero

← [Back to Infra Guide](index.md)

This procedure wipes the platform completely and rebuilds it from scratch. Use it when you want to start fresh, or to verify that the documentation and configuration actually work end-to-end.

**Warning: this deletes all data.** That includes all GitLab repositories, all Vault secrets, all Keycloak users, and all CI/CD history. There is no undo.

---

## Step 1 — Stop the platform

```bash
docker compose down
```

---

## Step 2 — Delete all persistent data

```bash
rm -rf ./.vols
```

This removes everything stored by the platform. After this point, all services will start as if they've never run before.

---

## Step 3 — Recreate your `.env`

If you're testing that the documentation works from nothing:

```bash
cp sample.env .env
```

Then fill in all the values again. Refer to the [environment configuration guide](02_env.md) for where to get each value.

If you're just doing a data reset (not a configuration reset), you can keep your existing `.env` — but review it to make sure all the values are still correct.

---

## Step 4 — Validate the configuration

```bash
docker compose config
```

This should print the full resolved compose configuration without errors. If it complains about a missing variable, fix it in `.env` before continuing.

---

## Step 5 — Start the platform

```bash
docker compose up -d
```

Wait for everything to initialize. GitLab in particular takes several minutes on first boot. See [Bootstrap](03_bootstrap.md) for what to watch for and how to know when it's ready.

If you need external access via Cloudflare Tunnel, also start the tunnel:

```bash
docker compose --profile cftunnel up -d
```

---

## Step 6 — Post-boot setup

After a fresh start, a few things need to be done manually because they depend on resources that only exist after the platform is running:

**GitLab Runner token**

1. Log in to GitLab as root
2. Go to **Admin Area → CI/CD → Runners → New instance runner**
3. Create a runner, copy the token (starts with `glrt-`)
4. Put it in `.env` as `GITLAB_RUNNER_TOKEN`
5. `docker compose up -d --no-deps --force-recreate gitlab-runner`

**GitLab Personal Access Token for the Management API**

1. In GitLab, go to your profile → **Access Tokens**
2. Create a token with the `api` scope
3. Put it in `.env` as `GITLAB_ROOT_TOKEN`
4. Recreate the API: `docker compose up -d --no-deps --force-recreate api`

**GitLab groups for templates and configs**

1. In GitLab, create a group called `templates`
2. Create another group called `configs`
3. Note the numeric ID of each group (visible in the group's settings page)
4. Put them in `.env` as `GITLAB_TEMPLATE_GROUP_ID` and `GITLAB_CONFIG_GROUP_ID`
5. Recreate the API: `docker compose up -d --no-deps --force-recreate api`

---

## Validation checklist

Work through this list to confirm everything is functional:

- [ ] `docker compose ps` shows all services as `healthy`
- [ ] `https://gitlab.devops.yourdomain.com` loads with a valid HTTPS certificate
- [ ] You can log in to GitLab as root using the password from `.env`
- [ ] `https://auth.devops.yourdomain.com` loads the Keycloak welcome screen
- [ ] You can log in to the Keycloak admin console using `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`
- [ ] `https://vault.devops.yourdomain.com` shows the Vault login screen
- [ ] You can log in to Vault using the `VAULT_DEV_ROOT_TOKEN_ID` value from `.env`
- [ ] `https://api.devops.yourdomain.com/health` returns `{"status":"ok"}`
- [ ] GitLab SSO login (via Keycloak) works: on the GitLab login page, click "Sign in with Keycloak" and complete the flow
- [ ] GitLab can send a test email: Admin Area → Settings → Email → **Send test email**
- [ ] Keycloak can reach SMTP: Keycloak admin → Realm Settings → Email → **Test connection**

If any step fails, refer to [Bootstrap — Common Issues](03_bootstrap.md#common-issues-during-first-boot) for troubleshooting guidance.

---

## A known limitation with Keycloak

Keycloak's realm configuration (users, OIDC clients, SMTP settings) comes from `keycloak/realm-export.json`, which is imported on first boot. If Keycloak has already run and its database already contains the realm, the import **does not overwrite** existing settings.

This is why the reset procedure deletes `.vols/keycloak-db/` — it forces Keycloak to start from a blank database so the import applies cleanly. If you ever need to change Keycloak configuration on an existing installation without a full reset, do it through the Keycloak admin console directly (Realm Settings → Email, Clients → client secrets, etc.).
