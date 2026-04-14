# Glossary

A quick reference for terms used throughout this documentation. You don't need to memorize these — just look something up when you see a word you're not familiar with.

---

**ACME** — A protocol used by Let's Encrypt to issue HTTPS certificates automatically. The platform uses this so you never have to buy or renew SSL certificates manually.

**API** — Application Programming Interface. A way for software to talk to other software over the network by sending structured requests and receiving structured responses.

**API Gateway** — A service that sits in front of other services and controls how requests flow through. In this platform, Kong plays this role.

**CORS** — Cross-Origin Resource Sharing. A browser security rule that controls which web pages can make requests to your API. Relevant if you're building a web frontend that calls the Management API.

**DNS** — Domain Name System. Translates domain names (like `gitlab.devops.example.com`) into IP addresses so browsers and services can find each other.

**DNS-01 Challenge** — A way of proving to Let's Encrypt that you own a domain, by creating a specific DNS record. This platform uses it so it can issue wildcard certificates (`*.devops.yourdomain.com`) without exposing ports publicly during validation.

**Docker** — A platform for running applications in isolated containers. Each service in this platform (GitLab, Keycloak, etc.) runs as a Docker container.

**Docker Compose** — A tool that lets you define and run multiple Docker containers together using a single configuration file (`docker-compose.yml`). This is how the entire platform starts with one command.

**ForwardAuth** — A mechanism in Traefik that routes every incoming request through an authentication check before allowing it to reach the destination. Used to protect services like the Traefik dashboard and Kong admin that don't have their own login screens.

**GitLab CE** — Community Edition of GitLab. The free, self-hosted version of GitLab. Includes source code hosting, CI/CD pipelines, and a container registry.

**GitLab Runner** — A background process that picks up pipeline jobs from GitLab and runs them. Think of it as the "worker" that executes your CI/CD scripts.

**HTTPS / TLS** — The encrypted version of HTTP. Traefik handles this at the edge so all traffic between the internet and the platform is encrypted. Individual services behind it don't need to manage certificates themselves.

**Identity Provider (IdP)** — A service that verifies who a user is. Keycloak is the identity provider in this platform.

**JWT** — JSON Web Token. A compact, signed piece of data that proves who you are. After you log in through Keycloak, you receive a JWT that services use to verify your identity without asking Keycloak again.

**Keycloak** — The login and identity management system used by this platform. It's where users are created, passwords are managed, and Single Sign-On (SSO) is configured.

**Kong** — An API gateway. Sits between the internet and your internal services, applying rules like rate limiting, authentication, and routing.

**KV v2** — "Key/Value version 2" — the storage format used in Vault for storing secrets. Version 2 adds support for versioning, so you can see the history of a secret value.

**Management API** — The custom NestJS service in this platform that automates project provisioning: creating GitLab repos, registering routes in Kong, seeding secrets in Vault, and optionally creating DNS records.

**NestJS** — A Node.js framework used to build the Management API. You don't need to know the details unless you're modifying the API itself.

**OIDC (OpenID Connect)** — A standard for Single Sign-On, built on top of OAuth2. When you click "Sign in with Keycloak" on a service like GitLab, OIDC is the protocol handling the handshake behind the scenes.

**OAuth2** — An authorization framework that OIDC is built on. You've used it if you've ever clicked "Sign in with Google."

**PAT (Personal Access Token)** — A string that acts like a password for programmatic access to a service. GitLab uses these for API calls. They're scoped (you choose what permissions they have) and can be revoked.

**Realm (Keycloak)** — A Keycloak realm is like a tenant — it has its own users, clients, and settings. This platform uses a single realm called `devops`.

**SSO (Single Sign-On)** — Logging in once and having that login work across multiple services. This platform uses Keycloak as the SSO provider.

**Traefik** — The edge reverse proxy in this platform. It receives all external traffic, handles HTTPS certificates, and routes requests to the right internal service.

**Tunnel (Cloudflare Tunnel)** — A service that creates an outbound connection from your server to Cloudflare's edge network. This lets users access the platform over the internet without you needing to open inbound firewall ports.

**Vault** — HashiCorp Vault. A secrets management system that stores sensitive values (passwords, tokens, API keys) securely and controls who can read them.

**Wildcard Certificate** — An HTTPS certificate that covers all subdomains under a domain (e.g., `*.devops.example.com`). This platform requests one automatically via Let's Encrypt.
