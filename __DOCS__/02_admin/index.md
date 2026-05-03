# Admin Guide

← [Back to docs home](../index.md)

This guide is for the platform administrator — the person responsible for managing who can access the platform, keeping the login system healthy, setting up GitLab project structure, and making sure secrets and routing are configured correctly.

You don't need to be the same person who set up the server, but you do need credentials to access the admin panels of the tools (Keycloak, GitLab, Vault).

Here's what's covered:

- **[Access and SSO](01_access_and_sso.md)** — How the single sign-on system works, and how to manage it when something breaks.
- **[GitLab](02_gitlab.md)** — Setting up groups and project templates, managing users, and testing email.
- **[Keycloak](03_keycloak.md)** — Managing users, roles, and OIDC clients. Configuring email settings.
- **[Vault](04_vault.md)** — Accessing and managing secrets. Admin access is granted via the Keycloak `admins` group.
- **[Management API](05_management_api.md)** — Using the project provisioning API: creating and deleting projects, understanding capabilities.
- **[Templates](06_templates.md)** — Managing template repositories that projects are forked from.
- **[Shared CI/CD Configs](07_configs.md)** — Managing shared pipeline definitions that can be injected into projects.
- **[Adding tiered OIDC with oauth2-proxy](08_oauth2_proxy_tiers_and_forwardauth.md)** — Extend Traefik, Kong, and Keycloak when you need multiple oauth2-proxy policies (admin / internal / external used only as examples).
