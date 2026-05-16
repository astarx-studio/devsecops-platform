#!/usr/bin/env bash
# =============================================================================
# bootstrap/smoke-cleanup.sh
# =============================================================================
# Hard-delete smoke E2E assets only (no provision, no pipelines).
# Clears GitLab smoke/* projects (permanent delete + wait), Mongo via API,
# Helm/K8s releases for smoke sample slugs.
#
# Requires: API_KEY, GITLAB_ROOT_TOKEN, GITLAB_DOMAIN (Management API up for Mongo).
#
# Environment (same as smoke-deploy):
#   SMOKE_GROUP_PATH          default system/devsecops-platform/smoke
#   SMOKE_GITLAB_RAILS_DESTROY  default 1 when GitLab API uses docker exec (top-level group purge)
#   SMOKE_PROJECTS            default smoke-api,smoke-web
#   SMOKE_GITLAB_DELETE_WAIT  default 180
#   API_LOCAL_PORT              default 13000
#
# Usage:
#   ./bootstrap/smoke-cleanup.sh
#   make smoke-cleanup
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT}"

log()  { echo "[smoke-cleanup] $*" >&2; }
warn() { echo "[smoke-cleanup] WARN  $*" >&2; }
die()  { echo "[smoke-cleanup] ERROR $*" >&2; exit 1; }

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
# shellcheck source=lib/smoke-cleanup.sh
source "${SCRIPT_DIR}/lib/smoke-cleanup.sh"

API_LOCAL_PORT="${API_LOCAL_PORT:-13000}"
SMOKE_GROUP_PATH="${SMOKE_GROUP_PATH:-system/devsecops-platform/smoke}"
SMOKE_PROJECTS="${SMOKE_PROJECTS:-smoke-api,smoke-web}"
GRAPHQL_URL="http://127.0.0.1:${API_LOCAL_PORT}/graphql"
GITLAB_API="$(gitlab_api_v4_base)"

GROUP_JSON="$(jq -n --arg p "${SMOKE_GROUP_PATH}" '($p | split("/") | map(select(. != "")))')"

graphql_post() {
  curl -sf -X POST "${GRAPHQL_URL}" "${hdr_auth[@]}" -d "$1"
}

hdr_auth=(-H "Content-Type: application/json" -H "X-API-Key: ${API_KEY}")

if ! curl -sf "http://127.0.0.1:${API_LOCAL_PORT}/health" >/dev/null; then
  warn "Management API not reachable on port ${API_LOCAL_PORT} — Mongo deleteProject may fail"
fi

IFS=',' read -r -a SLUGS <<< "${SMOKE_PROJECTS}"
trimmed=()
for raw in "${SLUGS[@]}"; do
  slug="${raw#"${raw%%[![:space:]]*}"}"
  slug="${slug%"${slug##*[![:space:]]}"}"
  [[ -n "${slug}" ]] && trimmed+=("${slug}")
done
SLUGS=("${trimmed[@]}")
[[ ${#SLUGS[@]} -gt 0 ]] || die "SMOKE_PROJECTS is empty"

log "Cleaning smoke group ${SMOKE_GROUP_PATH} (projects: ${SMOKE_PROJECTS})"

# Legacy throwaway releases from older smoke-deploy iterations
for rel in smoke-hello "${SLUGS[@]}"; do
  smoke_delete_k8s_release "${rel}"
done

smoke_preflight_clear_slots "${SMOKE_GROUP_PATH}" "${SLUGS[@]}"
smoke_purge_mongo_group "${SMOKE_GROUP_PATH}"
smoke_hard_delete_gitlab_group "${SMOKE_GROUP_PATH}"

log "Smoke cleanup finished — GitLab paths should be free for ${SMOKE_PROJECTS[*]}."
