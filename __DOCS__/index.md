# DevOps Platform (DSOaaS) — Documentation

This is the documentation for a self-hosted DevOps platform that runs entirely on a single server using Docker. It bundles everything a software team typically needs — a place to store and version code, a system that automatically builds and tests that code, a container registry to store built images, a login system shared across all tools, a secrets store, and an API to automate project setup.

The platform is designed so that once it's running, developers can focus on writing code rather than configuring infrastructure tools one by one. The person who sets it up fills in a single configuration file, runs one command, and the entire stack comes up together.

---

## Who should read what

**Setting up the server for the first time?**
You're the infrastructure person — responsible for getting Docker running, filling in environment variables, and making sure the platform starts up correctly. Start here: [Infra / Operator Guide](01_infra/index.md)

**Managing users, teams, and day-to-day platform settings?**
You're the platform administrator. You'll use tools like Keycloak (login management), GitLab (project structure), and Vault (secrets). Start here: [Admin Guide](02_admin/index.md)

**Building software on top of this platform?**
You're a developer. Your code lives in GitLab, your CI/CD pipelines run automatically, and your secrets are managed for you. Start here: [Developer Guide](03_devs/index.md)

**Maintaining, extending, or debugging the platform itself?**
You're a platform engineer or contributor. You need to understand the internals: service wiring, data flows, API internals, secrets management, and how to add new components. Start here: [Maintainer Reference](99_maintainers/index.md)

---

## What this platform includes (v1)

The stack is made up of several open-source tools, each playing a specific role:

- **Traefik** handles all incoming traffic, issues HTTPS certificates automatically, and routes requests to the right service. You never deal with SSL certificates manually.
- **Kong** sits in front of services as an API gateway — it can apply rate limits, authentication rules, and routing logic in one place.
- **Keycloak** is the login system. It gives users a single set of credentials that works across GitLab, Vault, and the Management API. No separate passwords per tool.
- **Vault** is the secrets store. Database passwords, API keys, and other sensitive values live here — not in code or config files.
- **GitLab CE** is where developers store their code, run CI/CD pipelines, and push Docker images. It also includes a package registry.
- **GitLab Runner** picks up CI/CD jobs from GitLab and executes them in isolated Docker containers.
- **Cloudflare Tunnel** lets you access the platform over the internet without opening firewall ports, by creating an encrypted outbound connection to Cloudflare's network.
- **Management API** is a custom service that automates project creation — when asked, it creates a GitLab repository from a template, registers it with Kong, seeds a secrets path in Vault, and optionally sets up a DNS record.

---

## What it does not do yet

This is version 1. A few things are intentionally simplified to keep the setup achievable on a single machine:

- There's no high-availability setup — everything runs on one server, so if the server goes down, the platform goes down.
- Vault runs in development mode, which means it unseals itself automatically but is not suitable for production secrets without further hardening.
- Keycloak also runs in a simplified mode that is fast to start but not cluster-ready.
- Application deployments are functional but basic — containers run on the same server as the platform, and there's no multi-environment promotion or automatic rollback.

These are deliberate trade-offs. The goal for v1 is a platform that actually runs and is usable by a team, not one that's theoretically perfect but hard to set up.

---

## Not familiar with some of these terms?

Check the [Glossary](00_glossary/index.md) for plain-language explanations of words like OIDC, ACME, KV, and others used throughout this documentation.
