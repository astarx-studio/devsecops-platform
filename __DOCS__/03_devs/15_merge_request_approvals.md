# Merge request approvals

← [Back to Developer Guide](index.md)

The platform's GitLab can **require approvals before a merge request is merged**, the same way GitLab's paid tiers do. You set the rules in GitLab itself, and the merge request page shows who still needs to approve. This comes from a platform plugin on top of GitLab CE, not a paid GitLab tier.

Maintainer internals: [gitlab service → Plugins](../99_maintainers/02_services.md#gitlab).

---

## Set up rules

In your project, open **Settings → Merge requests → Merge request approvals**. You need the Maintainer or Owner role to change rules.

Click **Add approval rule** and fill in:

- **Rule name**: shown on merge requests, e.g. `Leads` or `Security`.
- **Who approves:**
  - **Any of the approvers below**, with **Approvals required** set to a number: that many approvals from the listed people count. With no users or groups listed, anyone with the Developer role or higher counts.
  - **Every one of the users below must approve**: each listed person has to approve. Use this for "this specific person must sign off".
- **Users** and **Groups**: search and pick. Group members count, including inherited members.
- **Target branch**: **All branches**, **All protected branches**, or **Specific branches** (a branch name or pattern such as `release/*`).
- **Only when these files change** (optional): e.g. `infra/**`. Leave empty to apply the rule to every merge request.

Below the rules, **Approval settings** has three switches:

- **Prevent approval by merge request creator**: the author's own approval doesn't count.
- **Prevent approvals by users who add commits**: people who pushed commits to the MR don't count.
- **Remove all approvals when commits are added to the source branch**: approvals are dropped when the code changes. A rebase that leaves the changes the same keeps them.

Changes apply immediately to every open merge request.

### Examples

**Either of two leads:** one rule, approvers `lead1` and `lead2`, *Any of the approvers*, approvals required **1**.

**Three approvals, and one of them must be Alice:** two rules:

1. `Consensus`: no approvers listed (anyone eligible), approvals required **3**.
2. `Sign-off`: approvers `alice`, *Every one of the users below must approve*.

Alice's approval counts toward both rules, so Alice plus two others is enough. Three approvals without Alice are not.

## Review and approve

Nothing changes for reviewers: use GitLab's **Approve** button on the merge request as usual.

The approvals section of the merge request shows, before anyone approves:

- a summary such as **"Requires 2 approvals from Consensus and Sign-off."**;
- an **Approval rules** table: each rule, its target branch, who can or must approve (with a green ring on those who already approved), and progress such as `1 of 2`;
- **Request review from approvers**, which adds the listed approvers who haven't approved yet as reviewers.

Only approvals from people a rule lists count toward it. An approval counts toward every rule that person is listed in.

## When a merge request can merge

The merge button stays disabled ("All required approvals must be given." under merge checks) until **every rule that applies** to the merge request is met. A rule applies when the MR's target branch matches the rule and, if the rule has file paths, a matching file changed.

If a rule can't be met as things stand, the merge request is blocked and the rules table says why, for example *"alice can't approve this merge request (account is not active)"*. GitLab also refuses to save a rule that could never be met, such as one requiring someone without the Developer role.

## Rules in the repository (fallback)

A project with no rules in Settings can instead use `.gitlab/approvals.yml`, committed to the branch your MRs target. Rules in Settings always win; the file is ignored while any exist. The settings page tells you when the file is in use.

Anyone who can merge to the target branch can change the file, so prefer Settings. The file has the same options:

```yaml
rules:
  - name: default          # 2 approvals from anyone allowed to approve
    required: 2

  - name: security         # MRs touching infra also need someone from the security group
    required: 1
    paths: ["infra/**", "**/Dockerfile"]
    branches: [main, "release/*"]   # optional: only MRs into these branches
    approvers:
      groups: [security]

  - name: sign-off         # alice must approve
    require_all: true
    approvers:
      users: [alice]

author_can_approve: false      # default false
committers_can_approve: true   # default true
reset_on_push: true            # default true
```

The file is read from the **target** branch, so an MR can't loosen its own rules. If the file is invalid (bad YAML, unknown key, `required` not between 1 and 25), every MR to that branch is blocked until it's fixed, so a typo can't switch approvals off.

### Path patterns

| Pattern         | Matches                                   |
| --------------- | ----------------------------------------- |
| `infra/**`      | everything under `infra/`                 |
| `**/Dockerfile` | `Dockerfile` at any depth, including root |
| `*.tf`          | `.tf` files in the repo root only         |
| `**/*.tf`       | `.tf` files anywhere                      |
| `{a,b}/**`      | everything under `a/` or `b/`             |

## REST API

The same rules are available through GitLab EE's API, so scripts and Terraform written for EE work:

- `GET/POST /api/v4/projects/:id/approval_rules`, `PUT/DELETE /api/v4/projects/:id/approval_rules/:rule_id`
- `GET/POST /api/v4/projects/:id/approvals` (the approval settings)
- `GET /api/v4/projects/:id/merge_requests/:iid/approval_state`
- `GET /api/v4/projects/:id/merge_requests/:iid/approvals` also returns `approvals_required`, `approvals_left` and `approval_rules_left`.

Field names follow EE (`approvals_required`, `user_ids`, `usernames`, `group_ids`, `protected_branch_ids`, `applies_to_all_protected_branches`). Additions: `require_all`, `branches` (patterns) and `file_paths`. Changing rules needs the Maintainer role.

## Limits

- Admins, and anyone who can push straight to the target branch, can still get around it. Ask your platform admin to protect target branches so changes land only through merge requests.
- "Merge when checks pass" can be set before approvals arrive. GitLab merges once the approvals are in.
- Rules are per project. There are no group-level or per-merge-request overrides.
