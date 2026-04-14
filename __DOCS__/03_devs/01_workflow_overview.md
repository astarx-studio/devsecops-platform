# Your Day-to-Day Workflow

← [Back to Developer Guide](index.md)

Here's the typical development cycle on this platform, from writing code to seeing it run.

---

## Getting access

Before you can do anything, you need a Keycloak account. Ask your platform admin to create one for you. Once you have it, use those credentials to log in to GitLab — click "Sign in with Keycloak" on the GitLab login page. The same credentials also work for Vault, if you need to access secrets directly.

---

## Your project

When a new project is set up for you through the Management API, several things happen automatically:

- A **GitLab repository** is created for you, pre-populated from a template. The template includes a `Dockerfile`, a basic `.gitlab-ci.yml` pipeline configuration, and a skeleton application structure.
- A **secrets path in Vault** is created at `projects/<client>/<project>`. You can store and read your application's sensitive values here.
- A **Kong route** is registered so your service has a URL once it's deployed.

Your repository lives under a group path like `clients/<your-client>/<your-project>`. You can find it in GitLab by browsing to your client's group.

---

## Pushing code

Clone your repository from GitLab and start working:

```bash
git clone https://gitlab.devops.yourdomain.com/clients/your-client/your-project.git
cd your-project
```

Make changes, commit, and push:

```bash
git add .
git commit -m "your change"
git push
```

Every push to the repository automatically triggers a CI/CD pipeline. You can watch it run in GitLab under **CI/CD → Pipelines** in your project.

---

## What the pipeline does

The default template pipeline runs in stages:

1. **Lint** — Checks code quality and runs automated tests. If this fails, later stages don't run.
2. **Build** — Builds a Docker image from your `Dockerfile` and pushes it to the container registry.
3. **Deploy** — Deploys the built image. In v1, this stage may be configured as a manual trigger (you click a button) rather than running automatically.

The pipeline runs on a shared GitLab Runner, which executes each job inside an isolated Docker container. Your job environment is clean on every run.

---

## Making changes to the pipeline

The pipeline is defined in `.gitlab-ci.yml` in your repository. You can edit it freely to add stages, change how tests run, add environment-specific deployments, or include shared configuration from the `configs` group.

If your pipeline needs access to secrets (like a database password or an API key), see [the secrets page](04_secrets.md).

---

## Getting help

If something isn't working:

- Check your pipeline logs in GitLab — they show exactly what failed and the full output
- If the issue seems to be with the platform itself (Vault is down, runner isn't picking up jobs), ping your platform admin
- Check [the troubleshooting sections](02_repo_and_ci.md#if-your-pipeline-isnt-running) in the docs below
