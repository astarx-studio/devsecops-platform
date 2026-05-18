#!/usr/bin/env bash
# =============================================================================
# bootstrap/seed-platform-projects.sh
# =============================================================================
# Idempotent GitLab seeding for shared config repos under configs/.
#
# - Single-file templates (node-pipeline, …): API upsert of .gitlab-ci.yml
# - Directory repos (auto-devops-pipeline, auto-devops-chart): git push from
#   monorepo paths (no nested .git required)
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
info() { echo "[seed-platform] INFO  $*"; }
warn() { echo "[seed-platform] WARN  $*" >&2; }
die()  { echo "[seed-platform] ERROR $*" >&2; exit 1; }

# Docker Desktop on Windows cannot bind Git Bash /tmp paths; use a Windows path.
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

: "${GITLAB_DOMAIN:?Set GITLAB_DOMAIN in .env}"
: "${GITLAB_ROOT_TOKEN:?Set GITLAB_ROOT_TOKEN in .env}"
: "${GITLAB_CONFIG_GROUP_ID:?Set GITLAB_CONFIG_GROUP_ID in .env}"

# shellcheck source=lib/gitlab-api.sh
source "${SCRIPT_DIR}/lib/gitlab-api.sh"
GITLAB_API="$(gitlab_api_v4_base)"
if gitlab_api_uses_docker; then
  log "GitLab API via docker exec ${GITLAB_CONTAINER} (override with GITLAB_API_BASE_URL to use host curl)"
fi

gitlab_get() {
  gitlab_curl_sf "${GITLAB_API_HDR[@]}" "$@"
}

gitlab_get_optional() {
  gitlab_curl -s "${GITLAB_API_HDR[@]}" "$@"
}

log "Verifying GitLab config group id ${GITLAB_CONFIG_GROUP_ID}..."
CONFIG_GROUP_PATH="$(gitlab_get "${GITLAB_API}/groups/${GITLAB_CONFIG_GROUP_ID}" | jq -r '.full_path')"
if [[ -z "${CONFIG_GROUP_PATH}" || "${CONFIG_GROUP_PATH}" == "null" ]]; then
  die "GITLAB_CONFIG_GROUP_ID=${GITLAB_CONFIG_GROUP_ID} not found or token cannot read it — create the configs group in GitLab and set the numeric id in .env"
fi
log "Config group: ${CONFIG_GROUP_PATH} (id ${GITLAB_CONFIG_GROUP_ID})"

group_full_path() {
  gitlab_get "${GITLAB_API}/groups/$1" | jq -r '.full_path'
}

project_id_in_group() {
  local group_id="$1"
  local slug="$2"
  gitlab_get "${GITLAB_API}/groups/${group_id}/projects?search=${slug}&simple=true&per_page=100" \
    | jq -r --arg s "${slug}" \
      '.[] | select(.path == $s or .name == $s or (.path_with_namespace | endswith("/" + $s))) | .id' \
    | head -1
}

project_id_by_namespace_path() {
  local group_id="$1"
  local slug="$2"
  local group_path encoded
  group_path="$(group_full_path "${group_id}")"
  [[ -n "${group_path}" && "${group_path}" != "null" ]] || return 0
  encoded="$(printf '%s/%s' "${group_path}" "${slug}" | jq -sRr @uri)"
  gitlab_get_optional "${GITLAB_API}/projects/${encoded}" \
    | jq -r 'if .id then (.id | tostring) else empty end' 2>/dev/null || true
}

resolve_config_project_id() {
  local group_id="$1"
  local slug="$2"
  local pid
  pid="$(project_id_in_group "${group_id}" "${slug}")"
  [[ -n "${pid}" ]] && { echo "${pid}"; return 0; }
  pid="$(project_id_by_namespace_path "${group_id}" "${slug}")"
  [[ -n "${pid}" ]] && echo "${pid}"
}

# Third arg: true|false — whether GitLab CI is enabled on the project (chart publish needs true).
create_project_in_group() {
  local group_id="$1"
  local slug="$2"
  local jobs_enabled="${3:-false}"
  local body http resp existing
  body="$(jq -n \
    --arg name "${slug}" \
    --arg path "${slug}" \
    --argjson ns "${group_id}" \
    --arg jobs "${jobs_enabled}" \
    '{
      name: $name,
      path: $path,
      namespace_id: $ns,
      visibility: "internal",
      initialize_with_readme: true,
      jobs_enabled: ($jobs == "true")
    }')"
  resp="$(gitlab_curl -s -w "\n%{http_code}" "${GITLAB_API_HDR[@]}" -X POST "${GITLAB_API}/projects" -d "${body}")"
  http="$(echo "${resp}" | tail -1)"
  body="$(echo "${resp}" | sed '$d')"
  if [[ "${http}" == "201" ]]; then
    echo "${body}" | jq -r '.id'
    return 0
  fi
  if [[ "${http}" == "000" ]]; then
    die "GitLab API unreachable — is container ${GITLAB_CONTAINER} running? Set GITLAB_API_BASE_URL if calling from host."
  fi
  warn "Create project ${slug} returned HTTP ${http}: ${body}"
  existing="$(resolve_config_project_id "${group_id}" "${slug}")"
  if [[ -n "${existing}" ]]; then
    info "Using existing project ${slug} (id ${existing})"
    echo "${existing}"
    return 0
  fi
  return 1
}

set_project_jobs_enabled() {
  local project_id="$1"
  local slug="$2"
  local enabled="$3"
  local code
  code="$(gitlab_curl -s -o /tmp/gl_jobs_resp.json -w "%{http_code}" \
    "${GITLAB_API_HDR[@]}" -X PUT "${GITLAB_API}/projects/${project_id}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg e "${enabled}" '{jobs_enabled: ($e == "true")}')")"
  if [[ "${code}" == "200" ]]; then
    info "Set jobs_enabled=${enabled} on '${slug}' (id ${project_id})"
    return 0
  fi
  warn "Could not set jobs_enabled on ${slug} (HTTP ${code}): $(cat /tmp/gl_jobs_resp.json 2>/dev/null || true)"
  return 1
}

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
  local method code exists_code
  exists_code="$(gitlab_curl -s -o /dev/null -w "%{http_code}" \
    "${GITLAB_API_HDR[@]}" \
    "${GITLAB_API}/projects/${project_id}/repository/files/${enc_path}?ref=${branch}" \
    2>/dev/null || echo "000")"
  if [[ "${exists_code}" == "200" ]]; then
    method=PUT
  else
    method=POST
  fi
  code="$(gitlab_curl -s -o /tmp/gl_upsert_resp.json -w "%{http_code}" \
    "${GITLAB_API_HDR[@]}" -X "${method}" \
    "${GITLAB_API}/projects/${project_id}/repository/files/${enc_path}" \
    -d "${payload}")"
  if [[ "${code}" != "200" && "${code}" != "201" ]]; then
    warn "File upsert ${file_path} on project ${project_id} (${method}) returned HTTP ${code}: $(cat /tmp/gl_upsert_resp.json 2>/dev/null || true)"
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
  pid="$(resolve_config_project_id "${GITLAB_CONFIG_GROUP_ID}" "${slug}")"
  if [[ -z "${pid}" ]]; then
    log "Creating GitLab project '${slug}' in config group ${GITLAB_CONFIG_GROUP_ID}..."
    if ! pid="$(create_project_in_group "${GITLAB_CONFIG_GROUP_ID}" "${slug}" "false")"; then
      die "Could not create or find project ${slug}"
    fi
  else
    log "Found existing project '${slug}' (id ${pid})"
  fi
  [[ -n "${pid}" ]] || die "No project id for ${slug}"
  set_project_jobs_enabled "${pid}" "${slug}" "false" || true
  upsert_gitlab_file "${pid}" ".gitlab-ci.yml" "${yml}"
  log "Config '${slug}' is up to date (project id ${pid}, pipelines disabled)."
}

git_push_url() {
  local slug="$1"
  local group_path
  group_path="$(group_full_path "${GITLAB_CONFIG_GROUP_ID}")"
  [[ -n "${group_path}" && "${group_path}" != "null" ]] || die "Could not resolve config group full_path"
  if gitlab_api_uses_docker; then
    echo "http://oauth2:${GITLAB_ROOT_TOKEN}@gitlab/${group_path}/${slug}.git"
  else
    echo "https://oauth2:${GITLAB_ROOT_TOKEN}@${GITLAB_DOMAIN}/${group_path}/${slug}.git"
  fi
}

# Bootstrap re-seed replaces main from the monorepo; drop protection that blocks force-push.
unprotect_main_for_seed() {
  local project_id="$1"
  local slug="$2"
  local code
  # -o /dev/null: avoid writing response to host /tmp when API runs via docker exec.
  code="$(gitlab_curl -s -o /dev/null -w "%{http_code}" \
    "${GITLAB_API_HDR[@]}" -X DELETE \
    "${GITLAB_API}/projects/${project_id}/protected_branches/main" || true)"
  case "${code}" in
    204|200)
      info "Removed main branch protection on '${slug}' for bootstrap push"
      ;;
    404)
      ;;
    *)
      warn "Could not unprotect main on '${slug}' (HTTP ${code:-unknown})"
      ;;
  esac
}

# Push monorepo directory contents to GitLab (source of truth = platform repo).
sync_directory_config() {
  local slug="$1"
  local rel="$2"
  local jobs_enabled="${3:-true}"
  local src="${REPO_ROOT}/${rel}"
  local tmp pid push_url group_path

  [[ -d "${src}" ]] || die "Missing ${rel} — required in platform monorepo for greenfield bootstrap"

  log "Syncing directory config '${slug}' from ${rel}..."
  pid="$(resolve_config_project_id "${GITLAB_CONFIG_GROUP_ID}" "${slug}")"
  if [[ -z "${pid}" ]]; then
    log "Creating GitLab project '${slug}'..."
    if ! pid="$(create_project_in_group "${GITLAB_CONFIG_GROUP_ID}" "${slug}" "${jobs_enabled}")"; then
      die "Could not create or find project ${slug}"
    fi
  else
    log "Found existing project '${slug}' (id ${pid})"
    set_project_jobs_enabled "${pid}" "${slug}" "${jobs_enabled}" || true
  fi

  push_url="$(git_push_url "${slug}")"
  unprotect_main_for_seed "${pid}" "${slug}"

  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '${tmp}'" RETURN

  if command -v rsync >/dev/null 2>&1 && [[ -z "${MSYSTEM:-}" ]]; then
    local rsync_rc=0
    rsync -a --exclude '.git/' "${src}/" "${tmp}/" || rsync_rc=$?
    if [[ ${rsync_rc} -ne 0 && ${rsync_rc} -ne 23 ]]; then
      die "rsync failed (${rsync_rc}) copying ${rel}"
    fi
    [[ ${rsync_rc} -eq 23 ]] && warn "rsync partial transfer (${rsync_rc}) for ${rel}; verify copied files"
  else
    # Git Bash on Windows: no rsync or unreliable rsync exit codes — copy without nested .git
    shopt -s dotglob nullglob
    for entry in "${src}"/*; do
      [[ "$(basename "${entry}")" == ".git" ]] && continue
      cp -a "${entry}" "${tmp}/"
    done
    shopt -u dotglob nullglob
  fi

  if [[ -z "$(find "${tmp}" -mindepth 1 -maxdepth 1 ! -name '.git' -print -quit 2>/dev/null)" ]]; then
    die "No files copied from ${rel} — check monorepo contents (nested .git only?)"
  fi

  local docker_tmp
  docker_tmp="$(docker_bind_src "${tmp}")"

  local git_network=()
  if gitlab_api_uses_docker; then
    git_network=(--network "${DOCKER_NETWORK:-devops-network}")
  fi

  if ! MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker run --rm \
    "${git_network[@]}" \
    --entrypoint sh \
    -v "${docker_tmp}:/repo" -w /repo \
    alpine/git:latest \
    -ceu "
      git config --global user.email 'bootstrap@devsecops-platform'
      git config --global user.name 'DevSecOps Bootstrap'
      git init -b main
      git add -A
      if git diff --staged --quiet; then
        echo '[seed] ERROR: nothing to commit after copy (volume mount empty?)' >&2
        exit 1
      fi
      git commit -m 'chore(seed): sync from devsecops-platform'
      git remote add origin '${push_url}'
      git fetch origin main 2>/dev/null || true
      if git push origin HEAD:main 2>/dev/null; then
        exit 0
      fi
      git push --force origin HEAD:main
    "; then
    die "git push failed for ${slug} — check GitLab reachability from devops-network"
  fi
  log "Directory config '${slug}' pushed to GitLab (project id ${pid})."
}

# --- Single-file include-only templates ---------------------------------------
for slug in node-pipeline docker-pipeline deploy-compose; do
  sync_single_file_config "${slug}" || true
done

# --- Auto DevOps (full repos, tracked in platform monorepo) -------------------
sync_directory_config "auto-devops-pipeline" "configs/auto-devops-pipeline" "true"
sync_directory_config "auto-devops-chart" "configs/auto-devops-chart" "true"

if [[ -n "${GITLAB_TEMPLATE_GROUP_ID:-}" ]]; then
  log "Template group id is ${GITLAB_TEMPLATE_GROUP_ID}. Multi-file template 'nestjs-app' is not auto-synced by this script; use Management API POST /templates or maintain the repo in GitLab manually."
else
  warn "GITLAB_TEMPLATE_GROUP_ID unset — skipping template reminder."
fi

# shellcheck source=lib/gitlab-ci-instance-vars.sh
source "${SCRIPT_DIR}/lib/gitlab-ci-instance-vars.sh"
sync_gitlab_external_runner_instance_vars || true

log "Seed step finished."
