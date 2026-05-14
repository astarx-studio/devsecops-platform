#!/usr/bin/env bash
# =============================================================================
# bootstrap/smoke-deploy.sh
# =============================================================================
# Heavy end-to-end check: create a throwaway project via Management API GraphQL,
# push a minimal nginx image to the develop branch (dev deploy ref), wait for
# HTTPS + expected body. Optional --cleanup removes the Mongo/GitLab project.
#
# Requires: bootstrapped platform, GitLab Runner registered, .env with API_KEY,
# GITLAB_ROOT_TOKEN, GITLAB_DOMAIN. Does not replace make smoke (infra-only).
#
# Environment:
#   API_LOCAL_PORT       Host port for api (default 13000)
#   SMOKE_SLUG           Project slug (default smoke-hello)
#   SMOKE_GROUP_PATH     Parent group path, slash-separated (default smoke → ["smoke"])
#   SMOKE_TIMEOUT        Seconds to wait for URL (default 600)
#
# Usage:
#   ./bootstrap/smoke-deploy.sh
#   ./bootstrap/smoke-deploy.sh --cleanup
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

CLEANUP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cleanup) CLEANUP=1 ;;
    *) echo "[smoke-deploy] ERROR unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

log()  { echo "[smoke-deploy] $*"; }
warn() { echo "[smoke-deploy] WARN  $*" >&2; }
die()  { echo "[smoke-deploy] ERROR $*" >&2; exit 1; }

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${API_KEY:?Set API_KEY in .env (Management API auth)}"
: "${GITLAB_DOMAIN:?Set GITLAB_DOMAIN in .env}"
: "${GITLAB_ROOT_TOKEN:?Set GITLAB_ROOT_TOKEN in .env for git clone/push}"

API_LOCAL_PORT="${API_LOCAL_PORT:-13000}"
PROJECT_SLUG="${SMOKE_SLUG:-smoke-hello}"
SMOKE_GROUP_PATH="${SMOKE_GROUP_PATH:-smoke}"
TIMEOUT="${SMOKE_TIMEOUT:-600}"
GRAPHQL_URL="http://127.0.0.1:${API_LOCAL_PORT}/graphql"

GROUP_JSON="$(jq -n --arg p "${SMOKE_GROUP_PATH}" '($p | split("/") | map(select(. != "")))')"
if [[ "$(echo "${GROUP_JSON}" | jq 'length')" -eq 0 ]]; then
  die "SMOKE_GROUP_PATH produced an empty groupPath"
fi

hdr_auth=(-H "Content-Type: application/json" -H "X-API-Key: ${API_KEY}")

graphql_post() {
  local body="$1"
  curl -sf -X POST "${GRAPHQL_URL}" "${hdr_auth[@]}" -d "${body}"
}

create_payload="$(jq -n \
  --argjson gp "${GROUP_JSON}" \
  --arg slug "${PROJECT_SLUG}" \
  '{
    query: "mutation CreateSmokeProject($input: CreateProjectInput!) { createProject(input: $input) { id effectiveSlug gitlabPath appHosts { dev } } }",
    variables: { input: { groupPath: $gp, projectSlug: $slug, capabilities: { deployable: true } } }
  }')"

log "debug: POST ${GRAPHQL_URL} createProject slug=${PROJECT_SLUG} groupPath=$(echo "${GROUP_JSON}" | jq -c .)"
resp="$(graphql_post "${create_payload}" || true)"
if [[ -z "${resp}" ]]; then
  die "Empty response from GraphQL (is the api container up on port ${API_LOCAL_PORT}?)"
fi

proj_id="$(echo "${resp}" | jq -r '.data.createProject.id // empty')"
effective="$(echo "${resp}" | jq -r '.data.createProject.effectiveSlug // empty')"
host="$(echo "${resp}" | jq -r '.data.createProject.appHosts.dev // empty')"
gitlab_path="$(echo "${resp}" | jq -r '.data.createProject.gitlabPath // empty')"

if [[ -z "${effective}" || -z "${host}" ]]; then
  if echo "${resp}" | jq -e '.errors' >/dev/null 2>&1; then
    log "debug: createProject returned errors, attempting idempotent lookup by groupPathPrefix + projectSlug"
  fi
  lookup="$(jq -n \
    --argjson gp "${GROUP_JSON}" \
    '{
      query: "query Lookup($f: ProjectFilterInput!) { projects(filter: $f, page: 0, perPage: 100) { id projectSlug effectiveSlug gitlabPath appHosts { dev } } }",
      variables: { f: { groupPathPrefix: $gp } }
    }')"
  lresp="$(graphql_post "${lookup}" || true)"
  row="$(echo "${lresp}" | jq -c --arg s "${PROJECT_SLUG}" '(.data.projects // [])[] | select(.projectSlug == $s)' | head -1 || true)"
  if [[ -z "${row}" ]]; then
    die "createProject failed and no existing project matched: ${resp}"
  fi
  proj_id="$(echo "${row}" | jq -r '.id')"
  effective="$(echo "${row}" | jq -r '.effectiveSlug')"
  host="$(echo "${row}" | jq -r '.appHosts.dev // empty')"
  gitlab_path="$(echo "${row}" | jq -r '.gitlabPath')"
  log "info: reusing existing project id=${proj_id} effectiveSlug=${effective}"
fi

[[ -n "${host}" ]] || die "dev app host missing from project record"
[[ -n "${gitlab_path}" ]] || die "gitlabPath missing from project record"

log "info: project ${gitlab_path} (effectiveSlug=${effective}) → https://${host}/"

WORK="$(mktemp -d)"
cleanup_work() { rm -rf "${WORK}"; }
trap cleanup_work EXIT

clone_url="https://oauth2:${GITLAB_ROOT_TOKEN}@${GITLAB_DOMAIN}/${gitlab_path}.git"
log "debug: cloning ${GITLAB_DOMAIN}/${gitlab_path}.git (token not logged)"
git clone --depth 1 "${clone_url}" "${WORK}/repo"
cd "${WORK}/repo"

if git ls-remote -q --heads origin develop | grep -q .; then
  log "debug: remote branch develop exists — fetching and checking out"
  git fetch --depth=1 origin develop
  git checkout -B develop FETCH_HEAD
else
  log "debug: creating local develop from default branch"
  git checkout -b develop
fi

cat > Dockerfile <<'EOF'
FROM nginx:alpine
RUN echo "hello from smoke-deploy" > /usr/share/nginx/html/index.html
EXPOSE 80
EOF

git add Dockerfile
if git diff --staged --quiet; then
  warn "Dockerfile already committed on develop — pushing as-is"
else
  git -c user.email=smoke@local -c user.name=smoke-deploy commit -m "chore(smoke): add Dockerfile for e2e smoke"
fi

git push -u origin develop

log "info: waiting up to ${TIMEOUT}s for https://${host}/ (runner + pipeline + deploy)..."
start="$(date +%s)"
while true; do
  if curl -ksf -m 10 "https://${host}/" | grep -q "hello from smoke-deploy"; then
    log "PASS: https://${host}/ returned expected body"
    if [[ "${CLEANUP}" == "1" ]]; then
      del="$(jq -n --arg id "${proj_id}" '{query:"mutation($id:ID!){deleteProject(id:$id)}",variables:{id:$id}}')"
      delresp="$(graphql_post "${del}" || true)"
      if echo "${delresp}" | jq -e '.data.deleteProject == true' >/dev/null 2>&1; then
        log "info: deleteProject ok for id=${proj_id}"
      else
        warn "deleteProject did not return true: ${delresp}"
      fi
    fi
    exit 0
  fi
  elapsed=$(( $(date +%s) - start ))
  if (( elapsed >= TIMEOUT )); then
    die "TIMEOUT after ${TIMEOUT}s — check GitLab pipeline for ${gitlab_path} on branch develop (DEPLOY_DEV_REF) and runner registration (GITLAB_RUNNER_TOKEN)."
  fi
  sleep 10
  log "debug: still waiting ($((TIMEOUT - elapsed))s left) for https://${host}/"
done
