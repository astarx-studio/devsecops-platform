# Milestone Designs

← [Back to docs home](../index.md)

This folder holds **forward-looking feature designs** for the platform — capabilities that have been thought through and documented, but not yet scheduled into a numbered Phase. Each milestone here is "shovel-ready": once an operator chooses to pick one up, the doc serves as the basis for a Phase plan.

---

## Current milestones

- **[Path-based deployment routing](01_path_based_routing.md)** — Opt-in support for `<domain>/<slug>` URLs alongside the default `<sub>.<sub>.<domain>` pattern. _Status: Proposed._

---

## When to add a new milestone here

When a feature idea has clearly outgrown a Q&A in chat — typically:

- Cross-cuts multiple layers (chart, API, schema, ingress, docs)
- Has design decisions that need to be made before code can be written
- Is non-trivial enough to warrant its own Phase
- Is too immature to scheduled yet, but worth capturing before context is lost

Use the `01_path_based_routing.md` doc as a template for shape: problem → current state → goal/non-goals → architecture → schema + chart changes → operational considerations → migration story → open questions → implementation outline → risks → appendix.
