# Merge request approvals

← [Back to Developer Guide](index.md)

The platform's GitLab can **require approvals before a merge request is merged**. You define the rules per repository in a file. This comes from a platform plugin on top of GitLab CE, not a paid GitLab tier.

Maintainer internals: [gitlab service → Plugins](../99_maintainers/02_services.md#gitlab).

---

## Where rules come from

1. **The platform console (preferred).** Open the project in the console and use the **Approvals** tab. Rules saved there can only be changed in the console, so people with access to the repository can't edit them.
2. **`.gitlab/approvals.yml` in the repository (fallback).** Used only when the project has no rules in the console.
3. **Neither:** approvals stay optional, exactly like stock GitLab.

Console rules replace the file completely; the two are never combined. The Approvals tab shows which one GitLab is using and, when a file exists, its content. A change saved in the console applies within about 15 seconds. **Remove console rules** puts the project back on the file.

The console has the same options as the file below: rule name, approvals required, approver users and groups, paths, and the three switches. It also checks that the users and groups you enter exist in GitLab.

## Rules in the repository (fallback)

Commit `.gitlab/approvals.yml` to your **default branch** (or whichever branch your MRs target):

```yaml
rules:
  - name: default          # every MR needs 2 approvals from anyone allowed to approve
    required: 2

  - name: security         # MRs touching infra also need 1 approval from the security group
    required: 1
    paths: ["infra/**", "**/Dockerfile", "helm/**"]
    approvers:
      groups: [security]

author_can_approve: false      # default false: the author's own approval doesn't count
committers_can_approve: true   # default true: set false so anyone who pushed commits can't count
reset_on_push: true            # default true: approvals are dropped when the code changes
```

## How it behaves

- **File rules come from the target branch.** An MR that edits `.gitlab/approvals.yml` can't loosen its own rules. The change takes effect only for MRs opened *after* it's merged. Anyone who can merge to that branch can change the file, which is why the console is the preferred place.
- **Every rule that applies must be satisfied.** A rule without `paths` always applies. A rule with `paths` applies when any changed file matches one of its patterns.
- **Who counts as an approver:**
  - `approvers.users`: listed usernames (no `@` needed).
  - `approvers.groups`: members of the group (full path, e.g. `clients/acme/leads`), including inherited membership.
  - No `approvers` at all: anyone GitLab lets approve (Developer role and up).
  - Blocked users never count.
- **`reset_on_push`:** an approval only counts for the code it was given on. A rebase that doesn't change the code keeps approvals; a real change drops them.
- **Broken file = blocked.** If `.gitlab/approvals.yml` is invalid (bad YAML, unknown key, `required` not between 1 and 25), every MR to that branch is blocked until the file is fixed. That way a typo can't switch approvals off.
- **Rules store down = blocked.** If GitLab can't reach the console rules and has no recent copy of them for the project, merging is blocked until it can, rather than falling back to weaker rules.

## What you see

- The merge widget lists **"All required approvals must be given."** under merge checks, and the Merge button stays disabled until the rules pass.
- The API reports `"detailed_merge_status": "not_approved"` for those MRs.
- If your admin created the `dsoaas-approvals` bot user, the MR also gets one comment that's kept up to date, showing each rule's progress (for example `security 0/1`). It lists names without @-mentions, so updates don't send notifications.
- The approvals panel may still say approval is "optional". That label comes from GitLab CE and doesn't reflect the plugin. The merge checks are what's enforced.

## Patterns

| Pattern         | Matches                                   |
| --------------- | ----------------------------------------- |
| `infra/**`      | everything under `infra/`                 |
| `**/Dockerfile` | `Dockerfile` at any depth, including root |
| `*.tf`          | `.tf` files in the repo root only         |
| `**/*.tf`       | `.tf` files anywhere                      |
| `{a,b}/**`      | everything under `a/` or `b/`             |

## Limits

- Admins (and anyone who can push straight to the target branch) can still get around it. Ask your platform admin to **protect the target branch** so changes land only through MRs, and to give merge rights to Maintainers only.
- "Merge when checks pass" can be set before approvals arrive. GitLab merges once the approvals are in.
