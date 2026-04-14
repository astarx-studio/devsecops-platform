# Keycloak Administration

← [Back to Admin Guide](index.md)

Keycloak is the login and identity management system for the platform. Every user account lives here, and every tool that supports SSO (GitLab, Vault, the Management API) is registered here as a "client."

---

## Accessing the admin console

Go to `https://auth.devops.yourdomain.com` and click **Administration Console**. Log in with `KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD` (the values from your `.env`).

Once inside, make sure you're working in the **devops** realm — it's shown in the dropdown at the top of the left sidebar. The "master" realm is Keycloak's internal admin realm and you shouldn't make changes there.

---

## How the realm configuration works

When the platform starts for the first time on a fresh database, it automatically imports the realm configuration from `keycloak/realm-export.json`. This file defines everything: the realm settings, all the OIDC clients (for GitLab, Vault, the API, and oauth2-proxy), and the email configuration.

This import happens once, at first boot. After that, Keycloak stores everything in its database, and the JSON file is no longer read. This means:

- If you change something in `realm-export.json` after the platform has already booted, those changes won't take effect automatically. You'd need to apply them through the Keycloak admin UI, or do a full reset (see [Reset from Zero](../01_infra/05_reset_from_zero.md)).
- If you want your configuration changes to survive a reset, update `realm-export.json` in addition to making changes in the UI.

---

## Managing users

To create a new user:

1. In the Keycloak admin console, go to **Users** in the left sidebar
2. Click **Add user**
3. Fill in the **Username** (required) and optionally **Email**, **First name**, **Last name**
4. Click **Create**
5. Go to the **Credentials** tab and click **Set password** to assign a temporary or permanent password

To disable a user (for example, if someone leaves the team):

1. Open the user in the **Users** list
2. Toggle **Enabled** to off
3. Click **Save**

This immediately prevents them from logging in to any platform tool.

---

## Managing OIDC client secrets

Each tool that uses SSO has a "client" in Keycloak with a secret. These secrets are also stored in `.env` and must match. If they ever get out of sync, logins will fail.

To view or regenerate a client secret:

1. Go to **Clients** in the left sidebar
2. Click the client you want (e.g., `gitlab`)
3. Click the **Credentials** tab
4. You can see the current secret or click **Regenerate** to get a new one

If you regenerate a secret, you must also update the corresponding `KC_CLIENT_SECRET_*` variable in `.env` and restart the affected service.

---

## Configuring email (SMTP)

Keycloak sends emails for password resets and email verification. On a fresh installation, the SMTP settings come from `realm-export.json`, which is pre-populated with your `SMTP_*` environment variables.

If you need to update SMTP settings on an existing installation (without a full reset):

1. Go to **Realm settings** in the left sidebar
2. Click the **Email** tab
3. Fill in the SMTP details:
   - **From**: your `SMTP_FROM_EMAIL` value
   - **From display name**: your `SMTP_FROM_NAME` value
   - **Reply-to**: same as From
   - **Host**: your `SMTP_HOST` value
   - **Port**: your `SMTP_PORT` value (typically `587`)
   - Under **Authentication**: enable it and fill in **Username** and **Password**
   - Enable **StartTLS**
4. Click **Test connection** to verify it works
5. Save

---

## Things that require a full reset to change

In v1, a few settings are difficult to change on a running installation:

- The realm name (`devops`) is baked into service configurations. Changing it would require updating all OIDC client configurations across GitLab, Vault, and the Management API.
- Client IDs and redirect URIs are set in `realm-export.json` and applied at first import. If you need to change them on a live system, do it through the Keycloak admin UI for each client individually.

For a clean slate approach, the [Reset from Zero](../01_infra/05_reset_from_zero.md) procedure is the safest path.

---

## A note on Keycloak's "start-dev" mode

In v1, Keycloak runs in development mode (`start-dev`). This is intentional — it removes some of the startup complexity (certificate trust, cluster configuration) that would be required for a production-hardened setup.

The practical implications are:

- It starts faster and with fewer configuration requirements
- It is **not recommended** for handling real sensitive data at scale — but for a team-internal DevOps platform, it's a reasonable trade-off
- Keycloak itself will show a warning in the admin UI about running in development mode — this is expected

Hardening Keycloak for production would involve switching to the `start` command, configuring TLS properly within Keycloak, and potentially setting up a clustered database. That's outside the scope of v1.
