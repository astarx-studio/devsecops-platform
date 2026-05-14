# Milestone Designs

← [Back to docs home](../index.md)

This folder holds **forward-looking feature designs** for the platform — capabilities that have been thought through and documented, but not yet scheduled into a numbered Phase. Each milestone here is "shovel-ready": once an operator chooses to pick one up, the doc serves as the basis for a Phase plan.

---

## Current milestones

- **[Path-based deployment routing](01_path_based_routing.md)** — Opt-in support for `<domain>/<slug>` URLs alongside the default `<sub>.<sub>.<domain>` pattern. _Status: Proposed._
- **[Operator console (frontend)](02_frontend_console.md)** — Separate-repo web UI on GraphQL + Keycloak OIDC; deploy as Auto DevOps app at `console.devops.<DOMAIN>`. _Status: Deferred._
- **[Platform operability — sealed config, credential lifecycle & `dsoctl`](03_platform_operability.md)** — Replace the flat `.env`-centric config model with Vault-backed sealed secrets, per-service AppRole policies, zero-downtime credential rotation, and an operator CLI (`dsoctl`). _Status: Proposed._
- **[Deployment models — Compose-native and Kubernetes-native](04_deployment_models.md)** — Two first-class, functionally identical deployment modes: Docker Compose (minimal, current) and Kubernetes (scalable, Helm umbrella chart). Same `dsoctl` UX for both; supported migration path between them. _Status: Proposed. Depends on milestone 03._

---

## When to add a new milestone here

When a feature idea has clearly outgrown a Q&A in chat — typically:

- Cross-cuts multiple layers (chart, API, schema, ingress, docs)
- Has design decisions that need to be made before code can be written
- Is non-trivial enough to warrant its own Phase
- Is too immature to scheduled yet, but worth capturing before context is lost

Use the `01_path_based_routing.md` doc as a template for shape: problem → current state → goal/non-goals → architecture → schema + chart changes → operational considerations → migration story → open questions → implementation outline → risks → appendix.
