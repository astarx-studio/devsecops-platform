# GitLab Administration

← [Back to Admin Guide](index.md)

GitLab is the core development tool in this platform. It handles source code, CI/CD pipelines, Docker images (container registry), and package hosting — all in one place. This page covers the admin-level setup and maintenance tasks.

---

## Logging in

Go to `https://gitlab.devops.yourdomain.com` and log in with the `root` account using the `GITLAB_ROOT_PASSWORD` value from your `.env`.

You can also let users log in with their Keycloak credentials by clicking "Sign in with Keycloak" on the login page. The SSO integration is set up automatically as part of the platform.

---

## Setting up project groups

GitLab uses **groups** to organize repositories. The platform expects two specific groups to exist before the Management API can create new projects:

**Templates group** — This group holds "starter" repositories. When the Management API provisions a new project, it forks one of these templates into the client's group. Name it `templates`.

**Configs group** — This group holds shared CI/CD configuration files that can be included into any pipeline. Name it `configs`.

To create a group in GitLab:
1. Click the **+** button in the top navigation bar → **New group**
2. Choose **Create group**
3. Set the group name (e.g., `templates`)
4. Set visibility to **Internal** (so all authenticated users can access it) or **Private** (for stricter control)
5. Click **Create group**

After creating each group, find its **Group ID** — you'll need these for the `.env` file. The ID appears on the group's overview page, just below the group name. Put the template group's ID in `GITLAB_TEMPLATE_GROUP_ID` and the configs group's ID in `GITLAB_CONFIG_GROUP_ID`.

Once these are updated in `.env`, restart the API:

```bash
docker compose up -d --no-deps --force-recreate api
```

---

## Creating a Personal Access Token for the Management API

The Management API needs a GitLab token to create groups, fork repositories, and manage projects on your behalf. This should be done using the `root` account (or a dedicated service account if you prefer).

1. In GitLab, click your avatar in the top right → **Edit profile**
2. In the left sidebar, click **Access Tokens**
3. Click **Add new token**
4. Give it a name (e.g., `management-api`)
5. Under **Scopes**, check **api**
6. Set an expiry date or leave it blank for no expiry (note: no expiry is convenient but less secure)
7. Click **Create personal access token**
8. Copy the token immediately (it starts with `glpat-`) — you can't see it again after leaving the page

Put this token in `.env` as `GITLAB_ROOT_TOKEN`, then restart the API as shown above.

---

## Setting up the GitLab Runner

The GitLab Runner executes CI/CD jobs. Before it can run, it needs to be registered with GitLab.

1. Log in to GitLab as root
2. Go to **Admin Area** (the wrench icon) → **CI/CD** → **Runners**
3. Click **New instance runner**
4. Choose Linux as the platform and follow the prompts
5. On the final screen, copy the **authentication token** (starts with `glrt-`)
6. Put this token in `.env` as `GITLAB_RUNNER_TOKEN`
7. Start the runner container:

```bash
docker compose up -d --no-deps --force-recreate gitlab-runner
```

Once registered, the runner will appear in the Runners list as active. It uses Docker to run jobs in isolated containers, which means each pipeline job gets a clean environment.

---

## Testing email delivery

Once SMTP is configured in `.env` and the platform is running, you can send a test email directly from the GitLab admin panel:

1. Go to **Admin Area** → **Settings** → **Email**
2. Click **Send test email** and enter an email address

If the email arrives, SMTP is working. If it doesn't:
- Check GitLab logs: `docker compose logs -f gitlab | grep -i smtp`
- Verify your `SMTP_*` values in `.env` are correct
- Make sure your SMTP provider allows connections from your server's IP address (some providers have IP allowlists)

---

## SSO troubleshooting

If users report that clicking "Sign in with Keycloak" results in an error or a redirect loop:

- Verify that `KC_CLIENT_SECRET_GITLAB` in `.env` matches the secret for the `gitlab` client in Keycloak (Keycloak Admin → Clients → gitlab → Credentials)
- Make sure `https://auth.devops.yourdomain.com` is reachable and loads the Keycloak page
- Check GitLab's production log: `docker compose exec gitlab gitlab-ctl tail production`

---

## What requires manual intervention in v1

A few things can't be automated in the current version:

- **Runner registration** happens after first boot, as described above
- **GitLab group setup** (templates, configs) is a one-time manual step
- **GitLab upgrades** require attention — never skip major versions, and always check the [GitLab upgrade path tool](https://gitlab-com.gitlab.io/support/toolbox/upgrade-path/) before upgrading
