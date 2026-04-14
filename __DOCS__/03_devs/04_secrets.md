# Secrets

← [Back to Developer Guide](index.md)

Secrets are sensitive values that your application needs at runtime — database passwords, external API keys, tokens, and similar things. This platform stores them in Vault, and they're made available to your CI/CD pipelines as environment variables.

---

## Where your secrets live

When your project was provisioned, a path was created in Vault specifically for it:

```
projects/<client-name>/<project-name>
```

For example, if your project is `api` under client `acme`, your secrets path is:

```
projects/acme/api
```

Secrets stored at this path are key-value pairs. For example:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | `postgres://user:pass@db:5432/mydb` |
| `THIRD_PARTY_API_KEY` | `sk_live_abc123...` |

---

## Viewing and adding secrets

You can access the Vault UI at `https://vault.devops.yourdomain.com`. Log in using your Keycloak credentials (select **OIDC** as the login method).

Once inside:

1. In the left sidebar, click **Secrets Engines** → `secret/`
2. Navigate to `projects/<your-client>/<your-project>`
3. Click **Create new version** to add or update values

If you're accessing Vault for the first time and don't see your project's path, ask your platform admin to verify it was created during provisioning.

---

## Using secrets in CI/CD pipelines

Vault integration with GitLab CI/CD pipelines requires the pipeline to authenticate with Vault and fetch the secrets it needs. The typical approach is to use the Vault CLI or the `vault` job in your pipeline.

A simple example using the Vault CLI in a pipeline job:

```yaml
deploy:
  image: hashicorp/vault:latest
  script:
    - export VAULT_ADDR=https://vault.devops.yourdomain.com
    - export VAULT_TOKEN=$VAULT_TOKEN  # Set this as a protected CI/CD variable
    - DATABASE_URL=$(vault kv get -field=DATABASE_URL secret/projects/acme/api)
    - echo "Using database URL"  # Use $DATABASE_URL in your actual command
```

For this to work, `VAULT_TOKEN` must be set as a CI/CD variable in your GitLab project settings (see [repos and CI/CD](02_repo_and_ci.md#using-cicd-variables-for-secrets)). Use a Vault token that has read access to your project's path. Your platform admin can provide this.

---

## Keeping secrets out of code

A few rules to follow:

- Never commit secrets to your repository, even in a `.env` file or config file. If you accidentally commit a secret, assume it's compromised — rotate it immediately and clean the git history.
- Don't log secret values in your pipelines. Mark sensitive CI/CD variables as "Masked" in GitLab so they're redacted from job logs.
- Don't use the root Vault token in pipelines. Ask your admin for a token scoped specifically to your project's path.

---

## What isn't automated yet

In v1, Vault doesn't have per-project access policies. All Vault access uses a broadly privileged token. This means one project's pipeline, if it had the right token, could technically read another project's secrets.

For a trusted team on an internal platform, this is an acceptable trade-off. If you need stricter isolation, ask your admin about creating project-specific Vault policies and tokens — this is possible in the current Vault setup, just not automated.
