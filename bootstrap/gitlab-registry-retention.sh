#!/usr/bin/env bash
# =============================================================================
# gitlab-registry-retention.sh — enable Container Registry cleanup policies
# =============================================================================
# Optional maintainer script (not part of greenfield bootstrap).
# Requires GITLAB_ROOT_TOKEN + GITLAB_DOMAIN in .env (repo root).
#
# Default policy (Auto DevOps-friendly):
#   - cadence 1d, keep_n 10 (GitLab allows 1|5|10|25|50|100 only),
#     delete tags older than 14d matching .*
#   - name_regex_keep: latest-.*  (branch tip mirrors from Kaniko)
#
# Usage:
#   ./bootstrap/gitlab-registry-retention.sh           # enable on all projects
#   ./bootstrap/gitlab-registry-retention.sh --dry-run
#   ./bootstrap/gitlab-registry-retention.sh --trigger # also enqueue cleanup now
#
# Disk reclaim still needs registry GC after tags are deleted — see
# __DOCS__/01_infra/04_operations.md (Disk hygiene).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
TRIGGER=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --trigger) TRIGGER=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

# .env may contain unquoted spaces/comments — pull only what we need.
TOKEN="$(grep -E '^GITLAB_ROOT_TOKEN=' .env | head -1 | cut -d= -f2-)"
HOST="$(grep -E '^GITLAB_DOMAIN=' .env | head -1 | cut -d= -f2-)"
[[ -n "$TOKEN" && "$TOKEN" != "change-me-gitlab-root-pat" ]] || { echo "set GITLAB_ROOT_TOKEN in .env" >&2; exit 1; }
[[ -n "$HOST" ]] || { echo "set GITLAB_DOMAIN in .env" >&2; exit 1; }
API="https://${HOST}/api/v4"

log() { echo "[gitlab-registry-retention] $*" >&2; }

# GitLab CE accepts these attributes on PUT /projects/:id
POLICY_JSON='{
  "container_expiration_policy_attributes": {
    "enabled": true,
    "cadence": "1d",
    "keep_n": 10,
    "older_than": "14d",
    "name_regex": ".*",
    "name_regex_keep": "latest-.*"
  }
}'

page=1
updated=0
failed=0
ids=()

while [[ "$page" -le 50 ]]; do
  resp="$(curl -sk --header "PRIVATE-TOKEN: ${TOKEN}" \
    "${API}/projects?per_page=50&page=${page}&order_by=id&sort=asc")"
  n="$(echo "$resp" | python -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)"
  [[ "$n" == "0" ]] && break

  while IFS=$'\t' read -r id path; do
    [[ -z "$id" ]] && continue
    ids+=("$id")
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "DRY-RUN would enable policy on ${path} (id=${id})"
      updated=$((updated + 1))
      continue
    fi
    code="$(curl -sk -o /tmp/gl-reg-policy-out.json -w '%{http_code}' \
      --request PUT \
      --header "PRIVATE-TOKEN: ${TOKEN}" \
      --header "Content-Type: application/json" \
      --data "$POLICY_JSON" \
      "${API}/projects/${id}")"
    if [[ "$code" =~ ^2 ]]; then
      log "enabled policy on ${path} (id=${id}) HTTP ${code}"
      updated=$((updated + 1))
    else
      log "FAILED ${path} (id=${id}) HTTP ${code}: $(head -c 200 /tmp/gl-reg-policy-out.json)"
      failed=$((failed + 1))
    fi
  done < <(echo "$resp" | python -c "
import sys, json
for p in json.load(sys.stdin):
    if p.get('container_registry_enabled'):
        print(f\"{p['id']}\t{p['path_with_namespace']}\")
")
  page=$((page + 1))
done

log "projects updated=${updated} failed=${failed} dry_run=${DRY_RUN}"

if [[ "$TRIGGER" -eq 1 && "$DRY_RUN" -eq 0 ]]; then
  log "Running ContainerExpirationPolicyWorker (marks due policies)..."
  docker exec gitlab gitlab-rails runner '
    ContainerExpirationPolicy.where(enabled: true).update_all(next_run_at: 1.minute.ago)
    ContainerExpirationPolicyWorker.new.perform
    puts "policies_enabled=#{ContainerExpirationPolicy.where(enabled: true).count}"
  '
  log "With REGISTRY_DB_ENABLED=true, blobs are removed by online GC (~24h after untag)."
  log "Check: docker exec gitlab gitlab-ctl registry-database gc-stats"
  log "Do NOT run gitlab-ctl registry-garbage-collect (offline GC) — incompatible with metadata DB."
fi

[[ "$failed" -eq 0 ]]
