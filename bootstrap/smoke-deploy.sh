#!/usr/bin/env bash
# =============================================================================
# bootstrap/smoke-deploy.sh
# =============================================================================
# E2E smoke: provision smoke-api + smoke-web (Management API), sync monorepo
# sources, run develop pipelines, verify HTTPS. --cleanup removes all smoke assets.
#
# Requires: bootstrapped platform, GitLab Runner, API_KEY, GITLAB_ROOT_TOKEN.
#
# Environment:
#   SMOKE_GROUP_PATH        default system/devsecops-platform/smoke
#   SMOKE_PROJECTS          default smoke-api,smoke-web
#   SMOKE_TIMEOUT           default 600 (per project)
#   SMOKE_TRIGGER_PIPELINE  default 1
#   SMOKE_PROVISION         default 1 (create via API if missing)
#   SMOKE_SYNC_SOURCES      default 1 (push configs/* to develop before pipeline)
#   SMOKE_GITLAB_DELETE_WAIT  seconds to wait for GitLab permanent delete (default 180)
#   API_LOCAL_PORT            default 13000
#
# Usage:
#   ./bootstrap/smoke-deploy.sh
#   make smoke-deploy ARGS='--cleanup'
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT}"

CLEANUP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cleanup) CLEANUP=1 ;;
    *) echo "[smoke-deploy] ERROR unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

log()  { echo "[smoke-deploy] $*" >&2; }
warn() { echo "[smoke-deploy] WARN  $*" >&2; }
die()  { echo "[smoke-deploy] ERROR $*" >&2; exit 1; }

docker_bind_src() {
  local dir="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "${dir}"
    return
  fi
  if [[ -n "${MSYSTEM:-}" ]] && (cd "${dir}" && pwd -W >/dev/null 2>&1); then
    cd "${dir}" && pwd -W
    return
  fi
  printf '%s' "${dir}"
}

# shellcheck source=lib/load-env.sh
source "${SCRIPT_DIR}/lib/load-env.sh"
[[ -f .env ]] && load_dotenv .env

: "${API_KEY:?Set API_KEY in .env}"
: "${GITLAB_DOMAIN:?Set GITLAB_DOMAIN in .env}"
: "${GITLAB_ROOT_TOKEN:?Set GITLAB_ROOT_TOKEN in .env}"

# shellcheck source=lib/gitlab-api.sh
source "${SCRIPT_DIR}/lib/gitlab-api.sh"
if [[ -z "${SMOKE_GITLAB_RAILS_DESTROY:-}" ]] && gitlab_api_uses_docker; then
  SMOKE_GITLAB_RAILS_DESTROY=1
fi
# shellcheck source=lib/push-git-directory.sh
source "${SCRIPT_DIR}/lib/push-git-directory.sh"
# shellcheck source=lib/smoke-cleanup.sh
source "${SCRIPT_DIR}/lib/smoke-cleanup.sh"

API_LOCAL_PORT="${API_LOCAL_PORT:-13000}"
SMOKE_GROUP_PATH="${SMOKE_GROUP_PATH:-system/devsecops-platform/smoke}"
SMOKE_PROJECTS="${SMOKE_PROJECTS:-smoke-api,smoke-web}"
TIMEOUT="${SMOKE_TIMEOUT:-600}"
SMOKE_TRIGGER_PIPELINE="${SMOKE_TRIGGER_PIPELINE:-1}"
SMOKE_PROVISION="${SMOKE_PROVISION:-1}"
SMOKE_SYNC_SOURCES="${SMOKE_SYNC_SOURCES:-1}"
GRAPHQL_URL="http://127.0.0.1:${API_LOCAL_PORT}/graphql"
GITLAB_API="$(gitlab_api_v4_base)"

GROUP_JSON="$(jq -n --arg p "${SMOKE_GROUP_PATH}" '($p | split("/") | map(select(. != "")))')"
if [[ "$(echo "${GROUP_JSON}" | jq 'length')" -eq 0 ]]; then
  die "SMOKE_GROUP_PATH produced an empty groupPath"
fi

hdr_auth=(-H "Content-Type: application/json" -H "X-API-Key: ${API_KEY}")

graphql_post() {
  curl -sf -X POST "${GRAPHQL_URL}" "${hdr_auth[@]}" -d "$1"
}

smoke_url_path() {
  case "$1" in
    smoke-api|demo-api) printf '%s' '/health' ;;
    *)                  printf '%s' '/' ;;
  esac
}

smoke_body_pattern() {
  case "$1" in
    smoke-api|demo-api) printf '%s' 'smoke-api' ;;
    smoke-web|demo-web) printf '%s' 'Smoke Web' ;;
    *)                  printf '%s' '' ;;
  esac
}

validate_project_row() {
  local row="$1"
  local slug="$2"
  [[ -n "${row}" && "${row}" != "null" ]] || return 1
  echo "${row}" | jq -e '.id and .gitlabProjectId and .appHosts.dev' >/dev/null 2>&1 || return 1
  return 0
}

lookup_project() {
  local slug="$1"
  local lookup lresp row
  lookup="$(jq -n \
    --argjson gp "${GROUP_JSON}" \
    '{
      query: "query Lookup($f: ProjectFilterInput!) { projects(filter: $f, page: 0, perPage: 100) { id projectSlug effectiveSlug gitlabPath gitlabProjectId legacyV1 capabilities { deployable } appHosts { dev } } }",
      variables: { f: { groupPathPrefix: $gp } }
    }')"
  lresp="$(graphql_post "${lookup}")"
  row="$(echo "${lresp}" | jq -c --arg s "${slug}" \
    '(.data.projects // [])[] | select(.projectSlug == $s and .capabilities.deployable == true and (.legacyV1 | not))' \
    | head -1 || true)"
  if validate_project_row "${row}" "${slug}"; then
    echo "${row}"
    return 0
  fi
  return 1
}

provision_project() {
  local slug="$1"
  local payload resp
  payload="$(jq -n \
    --argjson gp "${GROUP_JSON}" \
    --arg slug "${slug}" \
    '{
      query: "mutation($input: CreateProjectInput!) { createProject(input: $input) { id projectSlug effectiveSlug gitlabPath gitlabProjectId capabilities { deployable } appHosts { dev } } }",
      variables: { input: { groupPath: $gp, projectSlug: $slug, capabilities: { deployable: true } } }
    }')"
  log "createProject ${SMOKE_GROUP_PATH}/${slug}..."
  resp="$(graphql_post "${payload}")"
  if echo "${resp}" | jq -e '.errors' >/dev/null 2>&1; then
    die "createProject failed for ${slug}: ${resp}"
  fi
  row="$(echo "${resp}" | jq -c '.data.createProject // empty')"
  validate_project_row "${row}" "${slug}" \
    || die "createProject returned invalid payload for ${slug}: ${resp}"
  echo "${row}"
}

trigger_develop_pipeline() {
  local gitlab_project_id="$1"
  local slug="$2"
  local resp http
  resp="$(gitlab_curl -s -w "\n%{http_code}" \
    "${GITLAB_API_HDR[@]}" -X POST \
    "${GITLAB_API}/projects/${gitlab_project_id}/pipeline?ref=develop")"
  http="$(echo "${resp}" | tail -1)"
  resp="$(echo "${resp}" | sed '$d')"
  if [[ "${http}" != "201" ]]; then
    die "Could not trigger pipeline for ${slug} (HTTP ${http}): ${resp}"
  fi
  echo "${resp}" | jq -r '.id'
}

wait_pipeline_success() {
  local gitlab_project_id="$1"
  local pipeline_id="$2"
  local slug="$3"
  local deadline="$4"
  local status
  while true; do
    status="$(gitlab_curl -sf "${GITLAB_API_HDR[@]}" \
      "${GITLAB_API}/projects/${gitlab_project_id}/pipelines/${pipeline_id}" \
      | jq -r '.status')"
    case "${status}" in
      success)
        log "info: pipeline ${pipeline_id} for ${slug} succeeded"
        return 0
        ;;
      failed|canceled|skipped)
        die "pipeline ${pipeline_id} for ${slug} ended with status=${status} — check GitLab job logs"
        ;;
    esac
    if (( $(date +%s) >= deadline )); then
      die "pipeline ${pipeline_id} for ${slug} did not finish before deadline"
    fi
    sleep 15
    log "debug: pipeline ${pipeline_id} (${slug}) status=${status}"
  done
}

wait_for_url() {
  local slug="$1"
  local host="$2"
  local deadline="$3"
  local path pattern url
  path="$(smoke_url_path "${slug}")"
  pattern="$(smoke_body_pattern "${slug}")"
  url="https://${host}${path}"
  log "info: waiting for ${url}"
  while true; do
    if [[ -n "${pattern}" ]]; then
      if curl -ksf -m 15 "${url}" | grep -q "${pattern}"; then
        log "PASS: ${url} matched '${pattern}'"
        return 0
      fi
    elif curl -ksf -m 15 -o /dev/null "${url}"; then
      log "PASS: ${url} returned HTTP 2xx"
      return 0
    fi
    if (( $(date +%s) >= deadline )); then
      die "TIMEOUT waiting for ${url}"
    fi
    sleep 10
    log "debug: still waiting ($(( deadline - $(date +%s) ))s left) for ${url}"
  done
}

curl -sf "http://127.0.0.1:${API_LOCAL_PORT}/health" >/dev/null \
  || die "Management API not reachable on port ${API_LOCAL_PORT}"

IFS=',' read -r -a PROJECT_SLUGS <<< "${SMOKE_PROJECTS}"
trimmed=()
for s in "${PROJECT_SLUGS[@]}"; do
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  [[ -n "${s}" ]] && trimmed+=("${s}")
done
PROJECT_SLUGS=("${trimmed[@]}")
[[ ${#PROJECT_SLUGS[@]} -gt 0 ]] || die "SMOKE_PROJECTS is empty"

# Collect provisioned rows for optional cleanup
declare -a CLEANUP_ROWS=()

log "E2E smoke: group=${SMOKE_GROUP_PATH} projects=${SMOKE_PROJECTS}"

smoke_preflight_clear_slots "${SMOKE_GROUP_PATH}" "${PROJECT_SLUGS[@]}"

for slug in "${PROJECT_SLUGS[@]}"; do
  row=""
  if ! row="$(lookup_project "${slug}")"; then
    if [[ "${SMOKE_PROVISION}" == "1" ]]; then
      row="$(provision_project "${slug}")"
    else
      die "Project ${SMOKE_GROUP_PATH}/${slug} not found — run bootstrap seed-smoke-samples or set SMOKE_PROVISION=1"
    fi
  else
    log "info: using existing project ${SMOKE_GROUP_PATH}/${slug}"
  fi

  validate_project_row "${row}" "${slug}" \
    || die "Invalid project record for ${slug} — run seed-smoke-samples or check API"

  CLEANUP_ROWS+=("${row}")

  proj_id="$(echo "${row}" | jq -r '.id')"
  gitlab_id="$(echo "${row}" | jq -r '.gitlabProjectId')"
  host="$(echo "${row}" | jq -r '.appHosts.dev // empty')"
  gitlab_path="$(echo "${row}" | jq -r '.gitlabPath')"
  effective="$(echo "${row}" | jq -r '.effectiveSlug')"

  [[ -n "${host}" ]] || die "dev app host missing for ${gitlab_path}"
  [[ -n "${gitlab_id}" && "${gitlab_id}" != "null" ]] || die "gitlabProjectId missing for ${gitlab_path}"

  if [[ "${SMOKE_SYNC_SOURCES}" == "1" ]]; then
    rel="configs/${slug}"
    [[ -d "${rel}" ]] || die "Missing monorepo path ${rel}"
    log "info: syncing ${rel} → develop"
    push_git_directory "${SMOKE_GROUP_PATH}" "${slug}" "${rel}" "develop" "${ROOT}"
  fi

  deadline=$(( $(date +%s) + TIMEOUT ))

  if [[ "${SMOKE_TRIGGER_PIPELINE}" == "1" ]]; then
    pipeline_id="$(trigger_develop_pipeline "${gitlab_id}" "${slug}")"
    log "info: triggered pipeline id=${pipeline_id} for ${gitlab_path}"
    wait_pipeline_success "${gitlab_id}" "${pipeline_id}" "${slug}" "${deadline}"
  fi

  wait_for_url "${slug}" "${host}" "${deadline}"
  log "info: ${slug} ok (mongo id=${proj_id}, release=${effective})"
done

log "All smoke-deploy checks passed."

if [[ "${CLEANUP}" == "1" ]]; then
  log "Cleanup: hard-removing smoke projects, deployments, and GitLab repos..."
  for row in "${CLEANUP_ROWS[@]}"; do
    mongo_id="$(echo "${row}" | jq -r '.id')"
    gitlab_id="$(echo "${row}" | jq -r '.gitlabProjectId')"
    release="$(echo "${row}" | jq -r '.effectiveSlug')"
    path="$(echo "${row}" | jq -r '.gitlabPath')"
    smoke_delete_project_via_api "${mongo_id}" "${gitlab_id}" "${release}" "${path}"
  done
  smoke_preflight_clear_slots "${SMOKE_GROUP_PATH}" "${PROJECT_SLUGS[@]}"
  smoke_hard_delete_gitlab_group "${SMOKE_GROUP_PATH}"
  log "Cleanup finished (GitLab paths freed)."
fi
