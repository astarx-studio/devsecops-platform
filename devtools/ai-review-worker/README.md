# AI merge request reviewer

Reviews GitLab merge requests with a local model (Bonsai on llama.cpp) or any cloud provider. It posts one note per MR, starting `AI review for <head sha>:`, and approves or unapproves.

## Pieces

| Service                      | Role                                                                                                                                                                 | Network                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `devtools-llm`               | llama-swap + PrismML llama.cpp. Loads the model on the first request, unloads after `ttl` idle seconds. Chat models `bonsai` / `bonsai-9b`, embeddings `nomic-embed` | `ai-review` only (internal: no egress). `devtools-n8n` is also on this network so the estimator can call it. Unreachable from the rest of `devops-network` |
| `devtools-llm-pull`          | One-shot GGUF download into volume `llm-models`                                                                                                                      | `devops-network`                                                                                                                                           |
| `devtools-ai-review-worker`  | Intake (`POST /jobs`), queue consumer, git reads, review loop, verdict, note text                                                                                    | `devops-network` + `ai-review`                                                                                                                             |
| `devtools-ai-review-db-init` | Role and DB `ai_review` on `devtools-postgres`                                                                                                                       | `devops-network`                                                                                                                                           |
| RabbitMQ vhost `ai-review`   | `ai-review.jobs` (prefetch 1), `ai-review.results`, `ai-review.dlq`                                                                                                  |                                                                                                                                                            |
| MinIO bucket `ai-review`     | Per-run audit: diff, each model round, result (90-day expiry)                                                                                                        |                                                                                                                                                            |

n8n workflows:

- **GitLab merge request Qestor items**: on each MR event, POSTs the job to the worker and shows a queued notice.
- **AI review result**: consumes `ai-review.results`, upserts the note, then approves or unapproves.
- **AI review Qestor lookup**: an internal webhook for the extra Qestor ids the model asks for.

## Flow

1. The GitLab webhook goes to n8n. n8n builds the job (head and base SHA from `diff_refs`, linked Qestor items, `X-Review-Only` header) and calls `POST http://devtools-ai-review-worker:8791/jobs`. It does not enqueue while `diff_refs.base_sha` is missing: GitLab leaves that null for a few seconds after the merge request is opened.
2. The worker loads `config/review.yaml`, decides scope, and inserts a `review_run` row unique on `(project, MR, head SHA, context)`. A webhook retry gets `duplicate`. A failed or skipped SHA can be re-opened, and so can a finished run whose job had no base SHA. If the job arrives with no base, intake reads the live merge request (a few seconds of retries) and does not queue until `diff_refs` is present. A new row is queued.
3. The consumer takes one job at a time: `prefetch=1`, a Postgres advisory lock, and an ack only after the result is published. A job is skipped as `superseded` when a newer push on the same MR exists.
4. The worker fetches `refs/merge-requests/<iid>/head` and the target branch into a per-project bare mirror. It diffs `base..head` and never checks out: reads come from git objects, and symlinks, `..`, `.git` and absolute paths are refused.
5. The review loop runs up to `max_read_rounds` read rounds (file ranges, `git grep`, extra Qestor ids), then a forced final review. Output is schema-checked, with one repair attempt; after that the run fails closed.
6. Verdict: model-invented locations are dropped. A mismatch with the linked items becomes a forced blocker. Approval needs no blockers and no potential bugs (configurable), and never happens for `never_on_paths`.
7. n8n updates the note and calls approve or unapprove. A refused approval adds one line to the note.

A run gets one retry (`runtime.retry_count`). After that the note says the review failed and the commit is not approved, the bot's approval is removed, and the job is copied to `ai-review.dlq`.

## Configure

Everything is in [`config/review.yaml`](config/review.yaml). It's re-read per job, and an invalid edit keeps the last good config (check the worker logs). Review rules are in [`config/standard.md`](config/standard.md). Add per-project rule files with `standard.extra_standard_files`.

- **Which MRs:** `enabled_projects`, `scope.target_branches`, source include/exclude, `skip_draft`, `skip_labels`, `require_qestor_items`.
- **Per GitLab webhook:** custom header `X-Review-Only: develop, release/*`. When present and non-empty, it replaces `target_branches` for that webhook.
- **Extra focus:** `standard.extra_instructions`, plus the `X-Review-Extras` header (added to it; `\n` = newline, capped at 2,000 characters). It's placed in a bounded `<focus>` section of the system prompt, which says extras can't relax the standard.
- **Guardrails** (`src/guardrails.js`, all deterministic):
  - **Posted text** (`sanitizeOutgoing`): quick actions neutralized, mentions wrapped, images removed, foreign links defanged, HTML stripped, secrets redacted, length capped.
  - **Prompt:** secrets redacted (`redact_prompt`).
  - **Added lines:** scanned for secrets (`secret_scan`) and injection phrases (`injection_scan`, which also covers MR text and items). Hits become findings the model can't drop.
  - **Approval:** guards in `decideApproval` (truncation, failed related repo, `max_changed_lines`, guardrail blockers).
  - **Intake:** `validateJob` bounds every field.
- **Related repositories:** `related.paths` holds projects, groups, globs, and `!` excludes. The header `X-Review-Related` (same syntax) replaces it per webhook. `X-Review-Related-Max` (a whole number) replaces `related.max_projects` per webhook, bounded by `related.max_projects_ceiling`; anything that isn't a whole number from 0 to 999 is ignored. Each related project is paired by same source branch, then by a linked Qestor item, then falls back to the target branch. The pairing is resolved at intake through the GitLab API, so the worker token needs `read_api`. The paired heads are part of the run key (`context_key`), so a review re-runs when the other side moves. `rereview_paired` re-queues the other side's MR, which must have been reviewed before; this stops after one hop.
- **Model:** `model.provider` (`openai-compatible` | `anthropic` | `ollama-native`), `base_url`, `model`, `api_key_env`, `context_tokens`, `max_output_tokens`, `extra_body`. Keys live in `devtools/.env`.
- **Runner:** [`../llm/llama-swap.yaml`](../llm/llama-swap.yaml) holds models, `-c` context, `ttl` and threads. The worker refuses `context_tokens` above the runner's `-c`.

Switching to a cloud model only needs `model:` changes plus the key in `.env`; see the examples in `review.yaml`. A cloud model sends the diff off this host.

## Run

```bash
docker compose -p devtools -f devtools/docker-compose.yml up -d --build devtools-llm devtools-ai-review-worker
```

Tests (no Docker needed):

```bash
cd devtools/ai-review-worker && npm ci && npm test
```

## Secrets (devtools/.env)

`AI_REVIEW_PG_PASSWORD`, `AI_REVIEW_RMQ_PASSWORD`, `AI_REVIEW_RMQ_N8N_PASSWORD`, `AI_REVIEW_MINIO_PASSWORD`, `AI_REVIEW_INTAKE_TOKEN`, `AI_REVIEW_QESTOR_LOOKUP_TOKEN`, `AI_REVIEW_GITLAB_TOKEN` (`read_repository` only), and optional provider keys.

n8n credentials (create in the n8n UI):

| Credential               | Type                                                      | Values                                                                                                              |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| AI review intake         | Templated custom auth (same type as GitLab private token) | template `{"headers":{"Authorization":"Bearer {{api_key}}"}}`, api_key `AI_REVIEW_INTAKE_TOKEN`                     |
| AI review lookup webhook | Header auth                                               | name `x-ai-review-token`, value `AI_REVIEW_QESTOR_LOOKUP_TOKEN`                                                     |
| AI review RabbitMQ       | RabbitMQ                                                  | host `devtools-rabbitmq`, port 5672, vhost `ai-review`, user `ai-review-n8n`, password `AI_REVIEW_RMQ_N8N_PASSWORD` |

The existing **GitLab private token** writes notes and line comments and approves. Approvals come from that token's user, so it should be a bot user that is not the MR author. On GitLab CE, approving needs at least the **Developer** role. As Reporter, everything else works and the note says "Approval was not applied (HTTP 403)".

The **Qestor API token** credential reads items (item list, lookup) and posts the rejection notice on linked items. Posting needs a `qst_` token with **write** scope; with a read-only token, Qestor answers `write_scope_required` and no notice is posted.
