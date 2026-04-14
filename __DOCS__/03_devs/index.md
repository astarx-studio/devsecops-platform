# Developer Guide

← [Back to docs home](../index.md)

This guide is for developers using the platform to build and ship software. You don't need to know how the infrastructure works — that's handled by the platform. What you do need to know is where your code lives, how to push changes, how CI/CD works, and how to access the things your application needs (like secrets and a container registry).

Here's what's covered:

- **[Your day-to-day workflow](01_workflow_overview.md)** — The big picture of how you work with this platform from code to deployment.
- **[GitLab repos and CI/CD](02_repo_and_ci.md)** — Where your code lives and how pipelines run automatically.
- **[Container registry and packages](03_registry_and_packages.md)** — Pushing and pulling Docker images.
- **[Secrets](04_secrets.md)** — How to access environment variables and sensitive values in your pipelines.
- **[Deployments](05_deployments.md)** — What happens after a successful build and what's supported today.

---

If your project was set up through the platform, most of the scaffolding already exists — a GitLab repository with a basic CI pipeline, a Vault path for your secrets, and a Kong route registered for your service. You can dive straight into your code.

If you're not sure whether your project has been provisioned yet, ask your platform admin or check whether your repository exists in GitLab under `clients/<your-client-name>/<your-project-name>`.
