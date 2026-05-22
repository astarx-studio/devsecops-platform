# OpenBao Administration

← [Back to Admin Guide](index.md)

OpenBao is the secrets store for the platform. Instead of storing database passwords, API keys, or tokens in code or config files, they live in OpenBao, where access is controlled and audited.

---

## Accessing the OpenBao UI

Go to `https://vault.devops.yourdomain.com`. You'll see a login screen with a "Token" method selected by default.

To log in with the root token, use the value of `VAULT_ROOT_TOKEN` from your `.env` file (after first bootstrap, copy from `.vols/vault/root-token` on the host).

Alternatively, if SSO is set up and working, you can log in using **OIDC** by selecting it from the method dropdown and clicking **Sign in with OIDC**. This redirects you to Keycloak for authentication. Leave **Role** blank or enter `default`.

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

## Production mode (PostgreSQL)

OpenBao runs as a **production server** with data stored in the platform's shared **PostgreSQL** database (`VAULT_DB_*` in `.env`). It is **not** auto-unsealed like old dev mode.

- **First install:** `make bootstrap` or `make vault-bootstrap` initializes the cluster, writes unseal keys under `.vols/vault/`, and configures OIDC.
- **After reboot:** run `make vault-bootstrap` (or `docker compose run --rm vault-prod-bootstrap`) so OpenBao unseals from `.vols/vault/unseal-keys`. You do not re-enter keys in the UI unless that file is missing.

The Management API uses `VAULT_ROOT_TOKEN` from `.env` for server-to-server access. Keep that token secret; prefer OIDC for human UI access.

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

If you prefer using the command line, authenticate with the root token, then run:

```bash
docker compose exec -e VAULT_TOKEN=<root-token> vault bao kv put secret/projects/acme/website key=value other_key=other_value
```

To read a secret:

```bash
docker compose exec -e VAULT_TOKEN=<root-token> vault bao kv get secret/projects/acme/website
```

---

## What isn't automated yet in v1

The Management API creates secret paths and seeds initial values, but there's no automated policy system. In a more mature setup, each project or service would get its own OpenBao policy — a set of rules defining which paths it's allowed to read or write. In v1, the root token is used for all access, which means everything can read everything.

If you need to restrict access (e.g., prevent one project's CI pipeline from reading another project's secrets), this would require creating per-project OpenBao tokens and policies. That's a manual step not covered in v1.
