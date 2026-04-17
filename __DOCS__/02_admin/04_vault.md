# OpenBao Administration

← [Back to Admin Guide](index.md)

OpenBao is the secrets store for the platform. Instead of storing database passwords, API keys, or tokens in code or config files, they live in OpenBao, where access is controlled and audited.

---

## Accessing the OpenBao UI

Go to `https://vault.devops.yourdomain.com`. You'll see a login screen with a "Token" method selected by default.

To log in with the root token, enter the value of `VAULT_DEV_ROOT_TOKEN_ID` from your `.env` file.

Alternatively, if SSO is set up and working, you can log in using **OIDC** by selecting it from the method dropdown and clicking **Sign in with OIDC**. This redirects you to Keycloak for authentication.

---

## Admin access via SSO

If you're a member of the Keycloak `admins` group, you automatically get full admin access to OpenBao. The platform maps the `admins` group to OpenBao's `admin` policy through the OIDC auth method.

To log in as an admin using SSO:

1. Go to `https://vault.devops.yourdomain.com`
2. Click the "OIDC" method dropdown and select it
3. Click **Sign in with OIDC**
4. Authenticate with your Keycloak credentials (must be in the `admins` group)
5. You'll receive a Vault token with `admin` policy, granting full access

If you're not in the `admins` group, you'll be issued a token with the `default` policy (limited read access only).

---

## Understanding dev mode

In v1, OpenBao runs in **development mode**. This is the simplest way to get OpenBao running — it auto-unseals itself on startup using the root token you specified in `.env`, stores everything in memory (with file-backed persistence in `.vols/vault/`), and doesn't require manual initialization or unsealing.

The important thing to know: **dev mode is not a production secrets management setup.** The root token has unrestricted access to everything in OpenBao. If this server is accessed by untrusted parties, dev mode provides minimal protection.

For a team-internal DevOps platform running on a private server, dev mode is an acceptable starting point. Moving to a hardened OpenBao setup would involve switching to a non-dev server configuration, setting up auto-unseal (using a cloud KMS or HSM), and creating scoped policies for each service. That's outside the scope of v1.

---

## How secrets are organized

The platform uses OpenBao's **KV v2** (Key/Value) secrets engine. Secrets are organized by path, following this convention:

```
projects/{clientName}/{projectName}
```

For example, a project called `website` under client `acme` would have its secrets at:

```
projects/acme/website
```

When the Management API provisions a new project, it creates this path and seeds initial values (like a deployment token or database password placeholder).

---

## Viewing and editing secrets

In the OpenBao UI:

1. Log in
2. In the left sidebar, click **Secrets Engines** → `secret/` (the default KV engine)
3. Navigate the path tree to find the project you're looking for
4. Click on a secret to see its fields and values
5. Click **Edit** to update values

You can also create new secrets and paths manually through the UI for things the API doesn't handle automatically.

---

## Adding secrets via the CLI

If you prefer using the command line, you can run OpenBao commands directly inside the container:

```bash
docker compose exec vault bao kv put secret/projects/acme/website key=value other_key=other_value
```

To read a secret:

```bash
docker compose exec vault bao kv get secret/projects/acme/website
```

The `VAULT_ADDR` and `VAULT_TOKEN` environment variables are already set inside the container, so no additional authentication is needed.

---

## What isn't automated yet in v1

The Management API creates secret paths and seeds initial values, but there's no automated policy system. In a more mature setup, each project or service would get its own OpenBao policy — a set of rules defining which paths it's allowed to read or write. In v1, the root token is used for all access, which means everything can read everything.

If you need to restrict access (e.g., prevent one project's CI pipeline from reading another project's secrets), this would require creating per-project OpenBao tokens and policies. That's a manual step not covered in v1.
