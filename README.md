# DSOaaS — DevOps as a Service

A self-hosted DevSecOps platform that runs entirely on a single server using Docker. It bundles everything a software team typically needs — source control, CI/CD pipelines, a container registry, a shared identity and login system, secrets management, and an API to automate project provisioning — into one stack you spin up with a single command.

Once running, developers focus on writing code. Infrastructure is already taken care of.

**Stack:** Traefik · Kong · Keycloak · OpenBao · GitLab CE · GitLab Runner · Cloudflare Tunnel · Management API

---

## Quick Start

**Prerequisites:** Docker and Docker Compose installed on your server, a domain name pointed at your server's IP (or a Cloudflare Tunnel configured).

```bash
# 1. Clone the repository
git clone <repo-url>
cd devsecops-platform

# 2. Set up your environment
cp sample.env .env
# Edit .env — fill in your domain, passwords, and API keys

# 3. Start the platform
docker compose up -d
```

The first boot takes a few minutes. GitLab in particular takes 3–5 minutes to complete its database migrations before it becomes available.

For a full step-by-step setup walkthrough — including DNS configuration, Cloudflare Tunnel setup, and first-login instructions — see the [Infra / Operator Guide](./__DOCS__/01_infra/index.md).

---

## Documentation

Full documentation lives in [`__DOCS__/`](./__DOCS__/index.md).

| Guide | For whom |
|---|---|
| [Infra / Operator Guide](./__DOCS__/01_infra/index.md) | Setting up the server for the first time |
| [Admin Guide](./__DOCS__/02_admin/index.md) | Managing users, teams, and platform settings |
| [Developer Guide](./__DOCS__/03_devs/index.md) | Building software on top of the platform |
| [Maintainer Reference](./__DOCS__/99_maintainers/index.md) | Extending, debugging, or contributing to the platform |
| [Glossary](./__DOCS__/00_glossary/index.md) | Plain-language definitions for terms used throughout |

---

## Licensing

DSOaaS is dual-licensed.

**Free to use** under [AGPLv3](./LICENSE) if your organization's annual revenue is below **USD $100,000** and you are not offering it as a managed/hosted service, building a proprietary fork, or white-labeling it for resale.

**A commercial license is required** for organizations above the revenue threshold, SaaS/managed service use, proprietary forks, and OEM/white-label use. See [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md) for the full terms, or the [licensing quick-reference](./LICENSING.md) for a summary.

To obtain a commercial license: **contact@skaraam.net**

---

*Copyright (C) 2026 Mochamad Seftikara Al Mayasir Soetiawarman*
