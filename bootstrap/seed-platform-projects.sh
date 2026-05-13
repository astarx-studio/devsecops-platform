#!/usr/bin/env bash
# =============================================================================
# bootstrap/seed-platform-projects.sh
# =============================================================================
# Idempotent GitLab seeding for shared **config** repos that ship as a single
# `.gitlab-ci.yml` in this monorepo (`configs/node-pipeline`, etc.).
#
# For `configs/auto-devops-pipeline` and `configs/auto-devops-chart`, if a `.git`
# directory exists, pushes `main` to `origin` after temporarily setting the
# remote URL to use `GITLAB_ROOT_TOKEN` (OAuth2 token scheme — no token stored).
#
# Multi-file **templates** (e.g. `templates/nestjs-app`) are not bulk-uploaded here;
# create or refresh them via the Management API (`POST /templates`) or GitLab UI;
# this script logs a reminder.
#
# Environment (from `.env`):
#   GITLAB_DOMAIN, GITLAB_ROOT_TOKEN, GITLAB_CONFIG_GROUP_ID, GITLAB_TEMPLATE_GROUP_ID
#
# Usage: ./bootstrap/seed-platform-projects.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log()  { echo "[seed-platform] $*"; }
warn() { echo "[seed-platform] WARN  $*" >&2; }
die()  { echo "[seed-platform] ERROR $*" >&2; exit 1; }

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${GITLAB_DOMAIN:?Set GITLAB_DOMAIN in .env}"
: "${GITLAB_ROOT_TOKEN:?Set GITLAB_ROOT_TOKEN in .env}"
: "${GITLAB_CONFIG_GROUP_ID:?Set GITLAB_CONFIG_GROUP_ID in .env}"

GITLAB_API="https://${GITLAB_DOMAIN}/api/v4"
HDR=(-H "PRIVATE-TOKEN: ${GITLAB_ROOT_TOKEN}" -H "Content-Type: application/json")

gitlab_get() {
  curl -sf "${HDR[@]}" "$@"
}

# Returns numeric project id or empty string
project_id_in_group() {
  local group_id="$1"
  local slug="$2"
  gitlab_get "${GITLAB_API}/groups/${group_id}/projects?search=${slug}&per_page=100" \
    | jq -r --arg s "${slug}" '.[] | select(.path==$s) | .id' | head -1
}

create_project_in_group() {
  local group_id="$1"
  local slug="$2"
  local body http resp
  body="$(jq -n \
    --arg name "${slug}" \
    --arg path "${slug}" \
    --argjson ns "${group_id}" \
    '{name: $name, path: $path, namespace_id: $ns, visibility: "private"}')"
  resp="$(curl -s -w "\n%{http_code}" "${HDR[@]}" -X POST "${GITLAB_API}/projects" -d "${body}")"
  http="$(echo "${resp}" | tail -1)"
  body="$(echo "${resp}" | sed '$d')"
  if [[ "${http}" == "201" ]]; then
    echo "${body}" | jq -r '.id'
    return 0
  fi
  if echo "${body}" | jq -e '.message' >/dev/null 2>&1; then
    warn "Create project ${slug} returned HTTP ${http}: ${body}"
  fi
  # Project may already exist — resolve id
  local existing
  existing="$(project_id_in_group "${group_id}" "${slug}")"
  [[ -n "${existing}" ]] || die "Could not create or find project ${slug}"
  echo "${existing}"
}

# Upsert a single file on default branch (main)
upsert_gitlab_file() {
  local project_id="$1"
  local file_path="$2"
  local local_file="$3"
  local b64 branch
  branch="$(gitlab_get "${GITLAB_API}/projects/${project_id}" | jq -r '.default_branch // "main"')"
  if command -v openssl >/dev/null 2>&1; then
    b64="$(openssl base64 -A -in "${local_file}" 2>/dev/null || true)"
  fi
  if [[ -z "${b64}" ]]; then
    b64="$(base64 < "${local_file}" | tr -d '\n\r ')"
  fi
  local payload enc_path
  enc_path="$(printf '%s' "${file_path}" | jq -sRr @uri)"
  payload="$(jq -n \
    --arg branch "${branch}" \
    --arg content "${b64}" \
    --arg msg "chore(seed): sync ${file_path} from devsecops-platform" \
    '{branch: $branch, encoding: "base64", content: $content, commit_message: $msg}')"
  local code
  code="$(curl -s -o /tmp/gl_upsert_resp.json -w "%{http_code}" \
    "${HDR[@]}" -X PUT \
    "${GITLAB_API}/projects/${project_id}/repository/files/${enc_path}" \
    -d "${payload}")"
  if [[ "${code}" != "200" && "${code}" != "201" ]]; then
    warn "File upsert ${file_path} on project ${project_id} returned HTTP ${code}: $(cat /tmp/gl_upsert_resp.json 2>/dev/null || true)"
    return 1
  fi
  return 0
}

sync_single_file_config() {
  local slug="$1"
  local local_dir="${REPO_ROOT}/configs/${slug}"
  local yml="${local_dir}/.gitlab-ci.yml"
  [[ -f "${yml}" ]] || { warn "Skip ${slug}: no ${yml}"; return 0; }

  log "Syncing config project '${slug}'..."
  local pid
  pid="$(project_id_in_group "${GITLAB_CONFIG_GROUP_ID}" "${slug}")"
  if [[ -z "${pid}" ]]; then
    log "Creating GitLab project '${slug}' in config group ${GITLAB_CONFIG_GROUP_ID}..."
    pid="$(create_project_in_group "${GITLAB_CONFIG_GROUP_ID}" "${slug}")"
  fi
  [[ -n "${pid}" ]] || die "No project id for ${slug}"
  upsert_gitlab_file "${pid}" ".gitlab-ci.yml" "${yml}"
  log "Config '${slug}' is up to date (project id ${pid})."
}

push_git_subtree() {
  local rel="$1"
  local slug="$2"
  local dir="${REPO_ROOT}/${rel}"
  [[ -d "${dir}/.git" ]] || return 0
  log "Pushing git repo ${rel} → GitLab (${slug})..."
  local group_path
  group_path="$(gitlab_get "${GITLAB_API}/groups/${GITLAB_CONFIG_GROUP_ID}" | jq -r '.full_path')"
  [[ -n "${group_path}" && "${group_path}" != "null" ]] || die "Could not resolve config group full_path"
  local url="https://oauth2:${GITLAB_ROOT_TOKEN}@${GITLAB_DOMAIN}/${group_path}/${slug}.git"
  git -C "${dir}" remote set-url origin "${url}"
  if git -C "${dir}" push -u origin main; then
    log "Push OK: ${slug}"
  else
    warn "git push failed for ${slug} — resolve conflicts or push manually"
  fi
}

# --- Single-file shared configs (idempotent file upsert) ----------------------
for slug in node-pipeline docker-pipeline deploy-compose; do
  sync_single_file_config "${slug}" || true
done

# --- Heavier repos tracked as nested git repositories --------------------------
push_git_subtree "configs/auto-devops-pipeline" "auto-devops-pipeline"
push_git_subtree "configs/auto-devops-chart" "auto-devops-chart"

if [[ -n "${GITLAB_TEMPLATE_GROUP_ID:-}" ]]; then
  log "Template group id is ${GITLAB_TEMPLATE_GROUP_ID}. Multi-file template 'nestjs-app' is not auto-synced by this script; use Management API POST /templates or maintain the repo in GitLab manually."
else
  warn "GITLAB_TEMPLATE_GROUP_ID unset — skipping template reminder."
fi

log "Seed step finished."
