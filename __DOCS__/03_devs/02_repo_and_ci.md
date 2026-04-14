# GitLab Repos and CI/CD

← [Back to Developer Guide](index.md)

Your code lives in GitLab, and every time you push a change, a pipeline runs automatically to validate and build it. This page explains where things are and what to do when they don't work.

---

## Finding your repository

Your project's repository is under a group path like:

```
clients/<your-client-name>/<your-project-name>
```

For example, a project called `api` for client `acme` would be at:

```
https://gitlab.devops.yourdomain.com/clients/acme/api
```

If you're not sure where your project is, ask your platform admin — they can share the exact URL or add you to the group.

---

## Cloning

To get a local copy of the repository:

```bash
git clone https://gitlab.devops.yourdomain.com/clients/your-client/your-project.git
```

You'll be prompted for your GitLab credentials, which are the same Keycloak username and password you use to log in. Alternatively, you can [set up an SSH key](https://docs.gitlab.com/ee/user/ssh.html) in GitLab to avoid entering credentials every time.

---

## How pipelines work

Every time you push commits to GitLab, a CI/CD pipeline starts automatically. The pipeline is defined in `.gitlab-ci.yml` at the root of your repository.

The default template configuration runs these stages in order:

- **test** — Runs your test suite and any linting. If this fails, the pipeline stops.
- **build** — Builds a Docker image and pushes it to the container registry. The image tag matches the commit SHA so you always know which build produced which image.
- **deploy** — Runs deployment steps. In the default template, this is set as a manual step — you trigger it by clicking the play button in the pipeline view.

You can see all pipelines under **CI/CD → Pipelines** in your project in GitLab. Click on a pipeline to see the stages, and click on any job to see its full log output.

---

## Using CI/CD variables (for secrets)

If your pipeline needs a password, API key, or other sensitive value, don't put it in `.gitlab-ci.yml` or commit it to the repo. Instead, add it as a CI/CD variable in GitLab:

1. Go to your project in GitLab
2. In the left sidebar, go to **Settings → CI/CD**
3. Expand the **Variables** section
4. Click **Add variable**
5. Set a key (e.g., `DATABASE_PASSWORD`) and a value
6. Check **Masked** so the value doesn't appear in logs
7. Save

In your `.gitlab-ci.yml`, reference it as an environment variable:

```yaml
build:
  script:
    - echo "Connecting to DB as $DATABASE_PASSWORD" # don't actually do this — just an example
```

For secrets that should be shared across projects and managed centrally, see [the Vault secrets page](04_secrets.md).

---

## If your pipeline isn't running

**Nothing happens after a push**

Check that the GitLab Runner is active. Go to your GitLab project → **Settings → CI/CD → Runners** and confirm there's at least one runner showing as green/active. If there are no active runners, ask your admin to check `docker compose ps gitlab-runner` and `docker compose logs -f gitlab-runner` on the server.

**A job is stuck as "pending" for a long time**

The runner might be busy with other jobs, or it might have lost its connection to GitLab. Ask your admin to check the runner logs.

**A job fails immediately with a Docker error**

The runner uses Docker to run jobs. If Docker-in-Docker is needed (e.g., to build images inside a pipeline), the runner is configured in privileged mode, which supports this. If you see errors about Docker socket access, check that your pipeline's `services` and `image` settings are correct.

---

## Shared CI configuration

The platform includes a `configs` GitLab group for shared CI/CD configuration files. If your pipeline uses `include:` to reference a shared config, that file lives there. Your admin manages what's available in the `configs` group.
