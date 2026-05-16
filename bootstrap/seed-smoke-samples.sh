#!/usr/bin/env bash
# =============================================================================
# bootstrap/seed-smoke-samples.sh
# =============================================================================
# Provisions smoke-api + smoke-web via Management API and pushes monorepo app
# sources to GitLab (develop). Idempotent; safe on greenfield (no demo group).
#
# Requires: API up, API_KEY, GITLAB_ROOT_TOKEN, GITLAB_DOMAIN
#
# Environment:
#   SMOKE_GROUP_PATH     default system/devsecops-platform/smoke
#   SMOKE_PROJECTS       default smoke-api,smoke-web
#   API_LOCAL_PORT       default 13000
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log()  { echo "[seed-smoke] $*" >&2; }
warn() { echo "[seed-smoke] WARN  $*" >&2; }
die()  { echo "[seed-smoke] ERROR $*" >&2; exit 1; }

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
: "${GITLAB_ROOT_TOKEN:?Set GITLAB_ROOT_TOKEN in .env}"
: "${GITLAB_DOMAIN:?Set GITLAB_DOMAIN in .env}"

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
GRAPHQL_URL="http://127.0.0.1:${API_LOCAL_PORT}/graphql"
GITLAB_API="$(gitlab_api_v4_base)"

GROUP_JSON="$(jq -n --arg p "${SMOKE_GROUP_PATH}" '($p | split("/") | map(select(. != "")))')"
hdr_auth=(-H "Content-Type: application/json" -H "X-API-Key: ${API_KEY}")

graphql_post() {
  curl -sf -X POST "${GRAPHQL_URL}" "${hdr_auth[@]}" -d "$1"
}

lookup_project() {
  local slug="$1"
  local lookup lresp row
  lookup="$(jq -n \
    --argjson gp "${GROUP_JSON}" \
    '{
      query: "query($f: ProjectFilterInput!) { projects(filter: $f, page: 0, perPage: 100) { id projectSlug gitlabPath gitlabProjectId legacyV1 capabilities { deployable } } }",
      variables: { f: { groupPathPrefix: $gp } }
    }')"
  lresp="$(graphql_post "${lookup}")"
  row="$(echo "${lresp}" | jq -c --arg s "${slug}" \
    '(.data.projects // [])[] | select(.projectSlug == $s and .capabilities.deployable == true and (.legacyV1 | not))' \
    | head -1 || true)"
  [[ -n "${row}" ]] && echo "${row}"
}

provision_project() {
  local slug="$1"
  local payload resp
  payload="$(jq -n \
    --argjson gp "${GROUP_JSON}" \
    --arg slug "${slug}" \
    '{
      query: "mutation($input: CreateProjectInput!) { createProject(input: $input) { id projectSlug gitlabPath } }",
      variables: { input: { groupPath: $gp, projectSlug: $slug, capabilities: { deployable: true } } }
    }')"
  log "createProject ${SMOKE_GROUP_PATH}/${slug}..."
  resp="$(graphql_post "${payload}")"
  if echo "${resp}" | jq -e '.errors' >/dev/null 2>&1; then
    die "createProject failed: ${resp}"
  fi
  echo "${resp}" | jq -r '.data.createProject.gitlabPath'
}

curl -sf "http://127.0.0.1:${API_LOCAL_PORT}/health" >/dev/null \
  || die "Management API not reachable on port ${API_LOCAL_PORT}"

IFS=',' read -r -a SLUGS <<< "${SMOKE_PROJECTS}"
trimmed=()
for raw in "${SLUGS[@]}"; do
  slug="${raw#"${raw%%[![:space:]]*}"}"
  slug="${slug%"${slug##*[![:space:]]}"}"
  [[ -n "${slug}" ]] && trimmed+=("${slug}")
done
SLUGS=("${trimmed[@]}")
[[ ${#SLUGS[@]} -gt 0 ]] || die "SMOKE_PROJECTS is empty"

smoke_preflight_clear_slots "${SMOKE_GROUP_PATH}" "${SLUGS[@]}"

for raw in "${SLUGS[@]}"; do
  slug="${raw#"${raw%%[![:space:]]*}"}"
  slug="${slug%"${slug##*[![:space:]]}"}"
  [[ -n "${slug}" ]] || continue
  rel="configs/${slug}"
  [[ -d "${rel}" ]] || die "Missing ${rel} in monorepo"

  if lookup_project "${slug}" >/dev/null; then
    log "Project ${SMOKE_GROUP_PATH}/${slug} already registered — syncing sources"
  else
    provision_project "${slug}" >/dev/null
  fi

  log "Pushing ${rel} → ${SMOKE_GROUP_PATH}/${slug} (develop)"
  push_git_directory "${SMOKE_GROUP_PATH}" "${slug}" "${rel}" "develop" "${REPO_ROOT}"
  log "Synced ${slug}"
done

log "Smoke sample seed finished."
