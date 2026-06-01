#!/usr/bin/env bash
# =============================================================================
# bootstrap/smoke-deploy.sh
# =============================================================================
# E2E smoke: provision smoke-api + smoke-web + smoke-mono + smoke-sonar via the
# Management API, sync sources, run develop pipelines, verify HTTPS.
# --cleanup removes all smoke assets with no operational trace.
#
# Requires: bootstrapped platform, GitLab Runner, API_KEY, GITLAB_ROOT_TOKEN.
#
# Environment:
#   SMOKE_GROUP_PATH          default system/devsecops-platform/smoke
#   SMOKE_PROJECTS            default smoke-api,smoke-web,smoke-mono,smoke-sonar
#   SMOKE_PIPELINE_ONLY_SLUGS default smoke-sonar (comma-separated; skip URL checks)
#   SMOKE_MONO_SLUGS          default smoke-mono (comma-separated; need upsert + 2-host check)
#   SMOKE_SONAR               default 1 (0 = skip Sonar provisioning and sonar job assert)
#   SMOKE_TIMEOUT             default 900 (per project; monorepo + Sonar needs headroom)
#   SMOKE_TRIGGER_PIPELINE    default 1
#   SMOKE_PROVISION           default 1 (create via API if missing)
#   SMOKE_SYNC_SOURCES        default 1 (push configs/* to develop before pipeline)
#   SMOKE_CI_OVERRIDES        default 1 (inject smoke-ci.yml include into root .gitlab-ci.yml)
#   SMOKE_SKIP_PREFLIGHT      default 0 (set 1 to skip GitLab/Mongo hard-clear before run)
#   SMOKE_ENV_PROFILES        default 1 (upload BUILD/RUNTIME profiles per project)
#   SMOKE_BRANCH              default develop (must match push ref and profile branches)
#   SMOKE_ASSERT_JOBS         default 1 (verify expected CI job names ran in pipeline)
#   SMOKE_INGRESS_IP          optional — server IP used in --resolve HOST:443:<IP> so curl
#                             works when local DNS can't resolve *.apps.<DOMAIN>
#   SMOKE_GITLAB_DELETE_WAIT  seconds to wait for GitLab permanent delete (default 180)
#   API_LOCAL_PORT            default 13000
#
# Smoke mirrors the console/API user workflow:
#   1. createProject (deployable=true or false)
#   2. upsertDeploymentTarget with apps[] (monorepo only — same as Deployment Targets dialog)
#   3. uploadEnvProfile (BUILD / RUNTIME)
#   4. provisionSonarProjects (when SMOKE_SONAR=1)
#   5. push application sources (git push)
#   6. tolerated CI commit: add `include: - local: smoke-ci.yml` (simulates developer edit)
#   7. trigger pipeline, wait success, verify URLs
# Cleanup uses elevated bootstrap deletion (not user path).
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
# shellcheck source=lib/smoke-ci-overrides.sh
source "${SCRIPT_DIR}/lib/smoke-ci-overrides.sh"

API_LOCAL_PORT="${API_LOCAL_PORT:-13000}"
SMOKE_GROUP_PATH="${SMOKE_GROUP_PATH:-system/devsecops-platform/smoke}"
SMOKE_PROJECTS="${SMOKE_PROJECTS:-smoke-api,smoke-web,smoke-mono,smoke-sonar}"
SMOKE_PIPELINE_ONLY_SLUGS="${SMOKE_PIPELINE_ONLY_SLUGS:-smoke-sonar}"
SMOKE_MONO_SLUGS="${SMOKE_MONO_SLUGS:-smoke-mono}"
SMOKE_SONAR="${SMOKE_SONAR:-1}"
TIMEOUT="${SMOKE_TIMEOUT:-900}"
SMOKE_TRIGGER_PIPELINE="${SMOKE_TRIGGER_PIPELINE:-1}"
SMOKE_PROVISION="${SMOKE_PROVISION:-1}"
SMOKE_SYNC_SOURCES="${SMOKE_SYNC_SOURCES:-1}"
SMOKE_CI_OVERRIDES="${SMOKE_CI_OVERRIDES:-1}"
SMOKE_ENV_PROFILES="${SMOKE_ENV_PROFILES:-1}"
SMOKE_SKIP_PREFLIGHT="${SMOKE_SKIP_PREFLIGHT:-0}"
SMOKE_BRANCH="${SMOKE_BRANCH:-develop}"
SMOKE_ASSERT_JOBS="${SMOKE_ASSERT_JOBS:-1}"
SMOKE_INGRESS_IP="${SMOKE_INGRESS_IP:-}"
GRAPHQL_URL="http://127.0.0.1:${API_LOCAL_PORT}/graphql"

# Env profile markers (must match app responses).
SMOKE_WEB_BUILD_MARKER="${SMOKE_WEB_BUILD_MARKER:-smoke-web-build-dev}"
SMOKE_API_RUNTIME_MARKER="${SMOKE_API_RUNTIME_MARKER:-smoke-api-runtime-dev}"
SMOKE_MONO_WEB_BUILD_MARKER="${SMOKE_MONO_WEB_BUILD_MARKER:-smoke-mono-web-build-dev}"
SMOKE_MONO_APP_RUNTIME_MARKER="${SMOKE_MONO_APP_RUNTIME_MARKER:-smoke-mono-app-runtime-dev}"
SMOKE_ENV_LABEL_WEB="${SMOKE_ENV_LABEL_WEB:-smoke-web-build}"
SMOKE_ENV_LABEL_API="${SMOKE_ENV_LABEL_API:-smoke-api-runtime}"
SMOKE_ENV_LABEL_MONO_WEB="${SMOKE_ENV_LABEL_MONO_WEB:-smoke-mono-web-build}"
SMOKE_ENV_LABEL_MONO_APP="${SMOKE_ENV_LABEL_MONO_APP:-smoke-mono-app-runtime}"
GITLAB_API="$(gitlab_api_v4_base)"

GROUP_JSON="$(jq -n --arg p "${SMOKE_GROUP_PATH}" '($p | split("/") | map(select(. != "")))')"
if [[ "$(echo "${GROUP_JSON}" | jq 'length')" -eq 0 ]]; then
  die "SMOKE_GROUP_PATH produced an empty groupPath"
fi

hdr_auth=(-H "Content-Type: application/json" -H "X-API-Key: ${API_KEY}")

graphql_post() {
  curl -sf -X POST "${GRAPHQL_URL}" "${hdr_auth[@]}" -d "$1"
}

# Returns true if slug is in SMOKE_PIPELINE_ONLY_SLUGS.
is_pipeline_only() {
  local slug="$1"
  IFS=',' read -r -a _po_arr <<< "${SMOKE_PIPELINE_ONLY_SLUGS}"
  for s in "${_po_arr[@]}"; do
    s="${s#"${s%%[![:space:]]*}"}"
    s="${s%"${s##*[![:space:]]}"}"
    [[ "${s}" == "${slug}" ]] && return 0
  done
  return 1
}

# Returns true if slug is in SMOKE_MONO_SLUGS.
is_monorepo_slug() {
  local slug="$1"
  IFS=',' read -r -a _mono_arr <<< "${SMOKE_MONO_SLUGS}"
  for s in "${_mono_arr[@]}"; do
    s="${s#"${s%%[![:space:]]*}"}"
    s="${s%"${s##*[![:space:]]}"}"
    [[ "${s}" == "${slug}" ]] && return 0
  done
  return 1
}

smoke_url_path() {
  case "$1" in
    smoke-api|smoke-mono-app) printf '%s' '/health' ;;
    *)                        printf '%s' '/' ;;
  esac
}

smoke_body_pattern() {
  case "$1" in
    smoke-api)      printf '%s' "${SMOKE_API_RUNTIME_MARKER}" ;;
    smoke-web)      printf '%s' "${SMOKE_WEB_BUILD_MARKER}" ;;
    smoke-mono-web) printf '%s' "${SMOKE_MONO_WEB_BUILD_MARKER}" ;;
    smoke-mono-app) printf '%s' "${SMOKE_MONO_APP_RUNTIME_MARKER}" ;;
    *)              printf '%s' '' ;;
  esac
}

# Returns the raw JS content for the smoke-web BUILD raw_file profile.
# Staged as smoke-build-env.js and copied into the image via COPY instruction.
smoke_web_build_profile_content() {
  printf "window.SMOKE_BUILD_MARKER = '%s';\n" "${SMOKE_WEB_BUILD_MARKER}"
}

smoke_api_runtime_profile_content() {
  printf 'DEPLOY_ENV=dev\nSMOKE_RUNTIME_MARKER=%s\n' "${SMOKE_API_RUNTIME_MARKER}"
}

# Returns the raw JS content for the smoke-mono-web BUILD raw_file profile.
# Staged to apps/smoke-mono-web/smoke-build-env.js and copied into the image via COPY.
smoke_mono_web_build_profile_content() {
  printf "window.SMOKE_BUILD_MARKER = '%s';\n" "${SMOKE_MONO_WEB_BUILD_MARKER}"
}

smoke_mono_app_runtime_profile_content() {
  printf 'DEPLOY_ENV=dev\nSMOKE_RUNTIME_MARKER=%s\n' "${SMOKE_MONO_APP_RUNTIME_MARKER}"
}

list_env_profile_ids_by_label() {
  local project_id="$1"
  local label="$2"
  local payload resp
  payload="$(jq -n \
    --arg id "${project_id}" \
    '{
      query: "query($id: ID!) { envProfiles(projectId: $id) { id label } }",
      variables: { id: $id }
    }')"
  resp="$(graphql_post "${payload}")"
  echo "${resp}" | jq -r --arg l "${label}" \
    '(.data.envProfiles // [])[] | select(.label == $l) | .id' | tr -d '\r'
}

delete_env_profiles_by_label() {
  local project_id="$1"
  local label="$2"
  local pid payload resp
  while IFS= read -r pid; do
    pid="${pid//$'\r'/}"
    [[ -n "${pid}" ]] || continue
    payload="$(jq -n \
      --arg projectId "${project_id}" \
      --arg profileId "${pid}" \
      '{
        query: "mutation($projectId: ID!, $profileId: String!) { deleteEnvProfile(projectId: $projectId, profileId: $profileId) { id } }",
        variables: { projectId: $projectId, profileId: $profileId }
      }')"
    resp="$(graphql_post "${payload}")"
    if echo "${resp}" | jq -e '.errors' >/dev/null 2>&1; then
      if echo "${resp}" | grep -q 'not found'; then
        log "info: env profile ${label} (${pid}) already absent — continuing"
        continue
      fi
      die "deleteEnvProfile failed for ${label} (${pid}): ${resp}"
    fi
    log "info: removed env profile ${label} (${pid})"
  done < <(list_env_profile_ids_by_label "${project_id}" "${label}")
}

# Uploads a BUILD env profile. For monorepo apps, pass the image name as
# job_selector so prepare-build-env writes kaniko-extra-build-args-<image>
# (matched by KANIKO_ARGS_SUFFIX in the Kaniko build job).
#   $1  project_id
#   $2  label
#   $3  content (env file text)
#   $4  branch
#   $5  job_selector — image name (e.g. "smoke-mono-web"); empty for single-app
upload_build_profile() {
  local project_id="$1"
  local label="$2"
  local content="$3"
  local branch="$4"
  local job_selector="${5:-}"
  local payload resp
  delete_env_profiles_by_label "${project_id}" "${label}"
  payload="$(jq -n \
    --arg projectId "${project_id}" \
    --arg label "${label}" \
    --arg branch "${branch}" \
    --arg content "${content}" \
    --arg jobSel "${job_selector}" \
    '{
      query: "mutation($projectId: ID!, $input: UploadEnvProfileInput!) { uploadEnvProfile(projectId: $projectId, input: $input) { id label injectionPhase buildDelivery jobSelector } }",
      variables: {
        projectId: $projectId,
        input: {
          label: $label,
          injectionPhase: "BUILD",
          branches: [$branch],
          content: $content,
          workspacePath: ".",
          filename: "build.env",
          buildDelivery: "DOTENV_BUILD_ARGS",
          jobSelector: (if $jobSel != "" then $jobSel else null end)
        }
      }
    }')"
  resp="$(graphql_post "${payload}")"
  if echo "${resp}" | jq -e '.errors' >/dev/null 2>&1; then
    die "uploadEnvProfile (BUILD/${label}) failed: ${resp}"
  fi
  log "info: BUILD profile ${label}: $(echo "${resp}" | jq -c '.data.uploadEnvProfile')"
}

# Uploads a BUILD env profile using RAW_FILE delivery.
# The raw content is stored verbatim in Vault and staged as workspacePath/filename
# during prepare-build-env; the build job copies it into CI_PROJECT_DIR before Kaniko runs.
# Usage: upload_raw_file_build_profile <project_id> <label> <raw_content> <branch> <workspace_path> <filename>
upload_raw_file_build_profile() {
  local project_id="$1"
  local label="$2"
  local content="$3"
  local branch="$4"
  local workspace_path="$5"
  local filename="$6"
  local payload resp
  delete_env_profiles_by_label "${project_id}" "${label}"
  payload="$(jq -n \
    --arg projectId "${project_id}" \
    --arg label "${label}" \
    --arg branch "${branch}" \
    --arg content "${content}" \
    --arg workspacePath "${workspace_path}" \
    --arg filename "${filename}" \
    '{
      query: "mutation($projectId: ID!, $input: UploadEnvProfileInput!) { uploadEnvProfile(projectId: $projectId, input: $input) { id label injectionPhase buildDelivery } }",
      variables: {
        projectId: $projectId,
        input: {
          label: $label,
          injectionPhase: "BUILD",
          branches: [$branch],
          content: $content,
          workspacePath: $workspacePath,
          filename: $filename,
          buildDelivery: "RAW_FILE"
        }
      }
    }')"
  resp="$(graphql_post "${payload}")"
  if echo "${resp}" | jq -e '.errors' >/dev/null 2>&1; then
    die "uploadEnvProfile (BUILD raw_file/${label}) failed: ${resp}"
  fi
  log "info: BUILD raw_file profile ${label}: $(echo "${resp}" | jq -c '.data.uploadEnvProfile')"
}

# Uploads a RUNTIME env profile scoped to a deployment target.
upload_runtime_profile() {
  local project_id="$1"
  local label="$2"
  local content="$3"
  local branch="$4"
  local payload resp
  delete_env_profiles_by_label "${project_id}" "${label}"
  payload="$(jq -n \
    --arg projectId "${project_id}" \
    --arg label "${label}" \
    --arg branch "${branch}" \
    --arg content "${content}" \
    '{
      query: "mutation($projectId: ID!, $input: UploadEnvProfileInput!) { uploadEnvProfile(projectId: $projectId, input: $input) { id label injectionPhase } }",
      variables: {
        projectId: $projectId,
        input: {
          label: $label,
          injectionPhase: "RUNTIME",
          branches: [$branch],
          deploymentTargetKeys: ["dev"],
          content: $content
        }
      }
    }')"
  resp="$(graphql_post "${payload}")"
  if echo "${resp}" | jq -e '.errors' >/dev/null 2>&1; then
    die "uploadEnvProfile (RUNTIME/${label}) failed: ${resp}"
  fi
  log "info: RUNTIME profile ${label}: $(echo "${resp}" | jq -c '.data.uploadEnvProfile')"
}

upload_smoke_env_profile() {
  local slug="$1"
  local project_id="$2"
  case "${slug}" in
    smoke-web)
      # RAW_FILE delivery: prepare-build-env stages smoke-build-env.js to the repo root;
      # the build job copies it into CI_PROJECT_DIR so Kaniko can COPY it into the image.
      upload_raw_file_build_profile "${project_id}" "${SMOKE_ENV_LABEL_WEB}" \
        "$(smoke_web_build_profile_content)" "${SMOKE_BRANCH}" "." "smoke-build-env.js"
      ;;
    smoke-api)
      upload_runtime_profile "${project_id}" "${SMOKE_ENV_LABEL_API}" \
        "$(smoke_api_runtime_profile_content)" "${SMOKE_BRANCH}"
      ;;
    smoke-mono)
      # RAW_FILE delivery for web: staged to apps/smoke-mono-web/smoke-build-env.js,
      # then COPY'd from that path in smoke-mono-web.Dockerfile.
      upload_raw_file_build_profile "${project_id}" "${SMOKE_ENV_LABEL_MONO_WEB}" \
        "$(smoke_mono_web_build_profile_content)" "${SMOKE_BRANCH}" \
        "apps/smoke-mono-web" "smoke-build-env.js"
      upload_runtime_profile "${project_id}" "${SMOKE_ENV_LABEL_MONO_APP}" \
        "$(smoke_mono_app_runtime_profile_content)" "${SMOKE_BRANCH}"
      ;;
    *)
      return 0
      ;;
  esac
}

sync_smoke_env_profiles() {
  local slug="$1"
  local project_id="$2"
  [[ "${SMOKE_ENV_PROFILES}" == "1" ]] || return 0
  log "info: syncing env profiles for ${slug}..."
  upload_smoke_env_profile "${slug}" "${project_id}"
}

# Provisions Sonar branch projects via provisionSonarProjects mutation (same
# as the console's Sonar panel). Skips with a warning when SMOKE_SONAR=0 or
# SONAR_ADMIN credentials are not configured.
provision_sonar_for_project() {
  local proj_id="$1"
  local slug="$2"
  [[ "${SMOKE_SONAR}" == "1" ]] || return 0
  local payload resp
  payload="$(jq -n \
    --arg id "${proj_id}" \
    --arg branch "${SMOKE_BRANCH}" \
    '{
      query: "mutation($id: ID!, $branches: [String!]!) { provisionSonarProjects(id: $id, branches: $branches, addToAllowedBranches: true) { branch projectKey projectName created dashboardUrl } }",
      variables: { id: $id, branches: [$branch] }
    }')"
  log "info: provisioning Sonar for ${slug} (branch=${SMOKE_BRANCH})..."
  resp="$(graphql_post "${payload}")"
  if echo "${resp}" | jq -e '.errors' >/dev/null 2>&1; then
    warn "provisionSonarProjects failed for ${slug}: $(echo "${resp}" | jq -r '.errors[].message' | head -3)"
    warn "Ensure SONAR_ADMIN_USER / SONAR_ADMIN_PASSWORD are set in .env and Sonar is reachable."
    return 0
  fi
  log "info: Sonar provision for ${slug}: $(echo "${resp}" | jq -c '.data.provisionSonarProjects')"
}

# Validates a project row fetched from the GraphQL API.
validate_project_row() {
  local row="$1"
  local slug="$2"
  [[ -n "${row}" && "${row}" != "null" ]] || return 1
  # Pipeline-only projects (deployable=false) have no appHosts; skip that check.
  if is_pipeline_only "${slug}"; then
    echo "${row}" | jq -e '.id and .gitlabProjectId' >/dev/null 2>&1 || return 1
  else
    echo "${row}" | jq -e '.id and .gitlabProjectId' >/dev/null 2>&1 || return 1
  fi
  return 0
}

# GraphQL PROJECT_FIELDS fragment used across queries (includes monorepo apps).
SMOKE_PROJECT_FIELDS='id projectSlug effectiveSlug gitlabPath gitlabProjectId legacyV1 capabilities { deployable } appHosts { dev } deploymentTargets { key enabled apps { name image host } }'

lookup_project() {
  local slug="$1"
  local lookup lresp row
  lookup="$(jq -n \
    --argjson gp "${GROUP_JSON}" \
    --arg fields "${SMOKE_PROJECT_FIELDS}" \
    '{
      query: "query Lookup($f: ProjectFilterInput!) { projects(filter: $f, page: 0, perPage: 100) { id projectSlug effectiveSlug gitlabPath gitlabProjectId legacyV1 capabilities { deployable } appHosts { dev } deploymentTargets { key enabled apps { name image host } } } }",
      variables: { f: { groupPathPrefix: $gp } }
    }')"
  lresp="$(graphql_post "${lookup}")"
  if is_pipeline_only "${slug}"; then
    # Pipeline-only projects may be deployable=false.
    row="$(echo "${lresp}" | jq -c --arg s "${slug}" \
      '(.data.projects // [])[] | select(.projectSlug == $s and (.legacyV1 | not))' \
      | head -1 || true)"
  else
    row="$(echo "${lresp}" | jq -c --arg s "${slug}" \
      '(.data.projects // [])[] | select(.projectSlug == $s and .capabilities.deployable == true and (.legacyV1 | not))' \
      | head -1 || true)"
  fi
  if validate_project_row "${row}" "${slug}"; then
    echo "${row}"
    return 0
  fi
  return 1
}

# Creates a standard deployable project (same as console createProject).
provision_standard_project() {
  local slug="$1"
  local payload resp row
  payload="$(jq -n \
    --argjson gp "${GROUP_JSON}" \
    --arg slug "${slug}" \
    '{
      query: "mutation($input: CreateProjectInput!) { createProject(input: $input) { id projectSlug effectiveSlug gitlabPath gitlabProjectId capabilities { deployable } appHosts { dev } deploymentTargets { key enabled apps { name image host } } } }",
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

# Creates a CI-only non-deployable project (console deployable=false toggle).
provision_cionly_project() {
  local slug="$1"
  local payload resp row
  payload="$(jq -n \
    --argjson gp "${GROUP_JSON}" \
    --arg slug "${slug}" \
    '{
      query: "mutation($input: CreateProjectInput!) { createProject(input: $input) { id projectSlug effectiveSlug gitlabPath gitlabProjectId capabilities { deployable } deploymentTargets { key enabled apps { name image host } } } }",
      variables: { input: { groupPath: $gp, projectSlug: $slug, capabilities: { deployable: false } } }
    }')"
  log "createProject (CI-only) ${SMOKE_GROUP_PATH}/${slug}..."
  resp="$(graphql_post "${payload}")"
  if echo "${resp}" | jq -e '.errors' >/dev/null 2>&1; then
    die "createProject (CI-only) failed for ${slug}: ${resp}"
  fi
  row="$(echo "${resp}" | jq -c '.data.createProject // empty')"
  validate_project_row "${row}" "${slug}" \
    || die "createProject (CI-only) returned invalid payload for ${slug}: ${resp}"
  echo "${row}"
}

# Upserts ALL standard deployment targets (dev/stg/prod) with the monorepo apps.
# This mirrors what a user does in the Deployment Targets dialog for each target:
# configuring smoke-mono-web + smoke-mono-app with their respective Dockerfiles.
#
# All three targets must have the monorepo apps so the CI generator does not
# produce a stray `build:smoke-mono` job from un-touched default targets.
# Returns the project row from the final (dev) upsert.
upsert_monorepo_target() {
  local proj_id="$1"
  local slug="$2"
  local updated_row=""

  # Monorepo app configuration shared across all targets.
  local apps_json
  apps_json='[
    { "name": "smoke-mono-web", "image": "smoke-mono-web", "dockerfile": "smoke-mono-web.Dockerfile" },
    { "name": "smoke-mono-app", "image": "smoke-mono-app", "dockerfile": "smoke-mono-app.Dockerfile" }
  ]'

  # Upsert each standard target. Only the dev upsert returns the authoritative row
  # (it includes the appHosts and deploymentTargets used by the rest of the flow).
  local target_key deploy_ref
  for target_key in dev stg prod; do
    case "${target_key}" in
      dev)  deploy_ref="develop" ;;
      stg)  deploy_ref="staging" ;;
      prod) deploy_ref="main" ;;
    esac

    local payload resp warnings
    payload="$(jq -n \
      --arg id "${proj_id}" \
      --arg targetKey "${target_key}" \
      --arg deployRef "${deploy_ref}" \
      --argjson apps "${apps_json}" \
      '{
        query: "mutation($id: ID!, $input: UpsertDeploymentTargetInput!) { upsertDeploymentTarget(id: $id, input: $input) { ciSyncWarnings project { id projectSlug effectiveSlug gitlabPath gitlabProjectId appHosts { dev } deploymentTargets { key enabled apps { name image host } } } } }",
        variables: {
          id: $id,
          input: {
            targetKey: $targetKey,
            enabled: true,
            deployRef: $deployRef,
            apps: $apps
          }
        }
      }')"
    log "upsertDeploymentTarget ${target_key} (monorepo) for ${slug}..."
    resp="$(graphql_post "${payload}")"
    if echo "${resp}" | jq -e '.errors' >/dev/null 2>&1; then
      die "upsertDeploymentTarget (${target_key}) failed for ${slug}: ${resp}"
    fi
    warnings="$(echo "${resp}" | jq -r '(.data.upsertDeploymentTarget.ciSyncWarnings // [])[]' | tr -d '\r')"
    if [[ -n "${warnings}" ]]; then
      warn "upsertDeploymentTarget (${target_key}) ciSyncWarnings for ${slug}:"
      while IFS= read -r w; do warn "  ${w}"; done <<< "${warnings}"
    fi
    if [[ "${target_key}" == "dev" ]]; then
      updated_row="$(echo "${resp}" | jq -c '.data.upsertDeploymentTarget.project // empty')"
    fi
  done

  [[ -n "${updated_row}" && "${updated_row}" != "null" ]] \
    || die "upsertDeploymentTarget (dev) returned empty project for ${slug}"
  echo "${updated_row}"
}

# Routes to the correct provisioner based on slug type.
provision_project() {
  local slug="$1"
  if is_monorepo_slug "${slug}"; then
    # Step 1: create with default targets.
    local base_row
    base_row="$(provision_standard_project "${slug}")"
    local proj_id
    proj_id="$(echo "${base_row}" | jq -r '.id')"
    # Step 2: upsert dev target with monorepo apps (mirrors console Deployment Targets dialog).
    upsert_monorepo_target "${proj_id}" "${slug}"
    return
  fi
  if is_pipeline_only "${slug}"; then
    provision_cionly_project "${slug}"
    return
  fi
  provision_standard_project "${slug}"
}

# Waits for the pipeline that GitLab auto-triggered from the most recent git push.
# Records a baseline pipeline ID before any push and polls until a newer one appears.
# This avoids the double-pipeline problem caused by an explicit API trigger alongside
# the push-triggered one — users never trigger pipelines manually after a push.
# Usage: await_push_pipeline <gitlab_project_id> <slug> <deadline> <baseline_id>
#   baseline_id: highest pipeline ID seen before push (0 if branch was empty)
await_push_pipeline() {
  local gitlab_project_id="$1"
  local slug="$2"
  local deadline="$3"
  local baseline_id="${4:-0}"
  local pipeline_id=""

  log "debug: waiting for push-triggered pipeline on ${slug} (branch=${SMOKE_BRANCH}, baseline=${baseline_id})..."
  while [[ -z "${pipeline_id}" ]]; do
    if (( $(date +%s) >= deadline )); then
      die "No pipeline appeared for ${slug} after push (baseline=${baseline_id}, timeout)"
    fi
    sleep 5
    pipeline_id="$(gitlab_curl -sf "${GITLAB_API_HDR[@]}" \
      "${GITLAB_API}/projects/${gitlab_project_id}/pipelines?ref=${SMOKE_BRANCH}&order_by=id&sort=desc&per_page=1" \
      | jq -r --argjson base "${baseline_id}" '.[0] | select(.id > $base) | .id // empty')"
    [[ -n "${pipeline_id}" ]] || log "debug: no new pipeline yet for ${slug} (baseline=${baseline_id}), polling..."
  done
  echo "${pipeline_id}"
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

# Asserts that a set of expected job names ran in the pipeline.
assert_pipeline_jobs() {
  local gitlab_project_id="$1"
  local pipeline_id="$2"
  local slug="$3"
  local -a expected_jobs=("${@:4}")
  [[ "${SMOKE_ASSERT_JOBS}" == "1" ]] || return 0
  [[ ${#expected_jobs[@]} -eq 0 ]] && return 0

  local jobs_json page all_jobs=()
  page=1
  while true; do
    jobs_json="$(gitlab_curl -sf "${GITLAB_API_HDR[@]}" \
      "${GITLAB_API}/projects/${gitlab_project_id}/pipelines/${pipeline_id}/jobs?per_page=100&page=${page}" \
      2>/dev/null || echo '[]')"
    local count
    count="$(echo "${jobs_json}" | jq 'length')"
    [[ "${count}" == "0" ]] && break
    while IFS= read -r jname; do
      # Strip trailing carriage returns (CRLF responses on Windows).
      jname="${jname//$'\r'/}"
      [[ -n "${jname}" ]] && all_jobs+=("${jname}")
    done < <(echo "${jobs_json}" | jq -r '.[].name')
    page=$((page + 1))
  done

  local failed_assertions=0
  for expected in "${expected_jobs[@]}"; do
    local found=0
    for j in "${all_jobs[@]}"; do
      [[ "${j}" == "${expected}" ]] && found=1 && break
    done
    if [[ "${found}" == "0" ]]; then
      warn "assert_pipeline_jobs: expected job '${expected}' not found in pipeline ${pipeline_id} (${slug})"
      failed_assertions=$((failed_assertions + 1))
    fi
  done

  if [[ "${failed_assertions}" -gt 0 ]]; then
    log "debug: actual jobs in pipeline ${pipeline_id}: ${all_jobs[*]:-<none>}"
    die "assert_pipeline_jobs: ${failed_assertions} expected job(s) missing for ${slug}"
  fi
  log "info: pipeline job assertions passed for ${slug}"
}

# Returns a list of expected CI job names for a given smoke project.
smoke_expected_jobs() {
  local slug="$1"
  local -a jobs=()
  case "${slug}" in
    smoke-mono)
      jobs=("build:smoke-mono-web" "build:smoke-mono-app"
            "deploy:dev-smoke-mono-web" "deploy:dev-smoke-mono-app")
      [[ "${SMOKE_SONAR}" == "1" ]] && jobs+=("sonar:scan")
      ;;
    smoke-sonar)
      jobs=("test")
      [[ "${SMOKE_SONAR}" == "1" ]] && jobs+=("sonar:scan")
      ;;
    smoke-web)
      # API creates single-app targets with the slug as image name → named job format.
      jobs=("build:smoke-web" "deploy:dev-smoke-web")
      ;;
    smoke-api)
      # API creates single-app targets with the slug as image name → named job format.
      jobs=("build:smoke-api" "deploy:dev-smoke-api")
      ;;
  esac
  printf '%s\n' "${jobs[@]}"
}

wait_for_url() {
  local app_name="$1"
  local host="$2"
  local deadline="$3"
  local path pattern url extra_url=""
  path="$(smoke_url_path "${app_name}")"
  pattern="$(smoke_body_pattern "${app_name}")"
  url="https://${host}${path}"
  case "${app_name}" in
    smoke-web|smoke-mono-web) extra_url="https://${host}/smoke-build-env.js" ;;
  esac

  # When local DNS can't resolve *.apps.<DOMAIN> (e.g. dev machine without VPN/DNS),
  # set SMOKE_INGRESS_IP to the server's public IP so curl bypasses DNS entirely.
  local resolve_args=()
  if [[ -n "${SMOKE_INGRESS_IP}" ]]; then
    resolve_args=(--resolve "${host}:443:${SMOKE_INGRESS_IP}")
    log "info: using SMOKE_INGRESS_IP=${SMOKE_INGRESS_IP} to resolve ${host}"
  fi

  log "info: waiting for ${url}${extra_url:+ and ${extra_url}}"
  while true; do
    if [[ -n "${pattern}" ]]; then
      if curl -ksf -m 15 "${resolve_args[@]}" "${url}" | grep -q "${pattern}"; then
        log "PASS: ${url} matched '${pattern}'"
        return 0
      fi
      if [[ -n "${extra_url}" ]] && curl -ksf -m 15 "${resolve_args[@]}" "${extra_url}" | grep -q "${pattern}"; then
        log "PASS: ${extra_url} matched '${pattern}'"
        return 0
      fi
    elif curl -ksf -m 15 -o /dev/null "${resolve_args[@]}" "${url}"; then
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

# Verifies URLs for a project. For monorepo, checks per-app hosts from
# deploymentTargets; for standard projects, uses appHosts.dev.
verify_project_urls() {
  local row="$1"
  local slug="$2"
  local deadline="$3"

  # Pipeline-only projects have no deploy — skip URL check.
  if is_pipeline_only "${slug}"; then
    log "info: ${slug} is pipeline-only — skipping URL check"
    return 0
  fi

  if is_monorepo_slug "${slug}"; then
    # Check each per-app host from the deployment target apps list.
    local apps_json
    apps_json="$(echo "${row}" | jq -c \
      '[.deploymentTargets[] | select(.key == "dev" and .enabled == true) | .apps[]]')"
    local app_count
    app_count="$(echo "${apps_json}" | jq 'length')"
    if [[ "${app_count}" == "0" ]]; then
      die "No dev apps found in deploymentTargets for ${slug} — did upsertDeploymentTarget succeed?"
    fi
    while IFS= read -r app_json; do
      local app_name app_host
      app_name="$(echo "${app_json}" | jq -r '.name')"
      app_host="$(echo "${app_json}" | jq -r '.host')"
      [[ -n "${app_host}" && "${app_host}" != "null" ]] \
        || die "Missing host for app ${app_name} in ${slug}"
      wait_for_url "${app_name}" "${app_host}" "${deadline}"
    done < <(echo "${apps_json}" | jq -c '.[]')
    return 0
  fi

  # Standard single-app project.
  local host
  host="$(echo "${row}" | jq -r '.appHosts.dev // empty')"
  [[ -n "${host}" ]] || die "dev app host missing for ${slug}"
  wait_for_url "${slug}" "${host}" "${deadline}"
}

# =============================================================================
# Pre-flight checks
# =============================================================================
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

if [[ "${SMOKE_SKIP_PREFLIGHT}" != "1" ]]; then
  smoke_preflight_clear_slots "${SMOKE_GROUP_PATH}" "${PROJECT_SLUGS[@]}"
else
  log "info: skipping preflight (SMOKE_SKIP_PREFLIGHT=1)"
fi

# =============================================================================
# Main loop — provision, configure, push, run pipeline, verify
# =============================================================================
for slug in "${PROJECT_SLUGS[@]}"; do
  row=""
  if ! row="$(lookup_project "${slug}")"; then
    if [[ "${SMOKE_PROVISION}" == "1" ]]; then
      row="$(provision_project "${slug}")"
    else
      die "Project ${SMOKE_GROUP_PATH}/${slug} not found — set SMOKE_PROVISION=1 or run seed-smoke-samples"
    fi
  else
    log "info: using existing project ${SMOKE_GROUP_PATH}/${slug}"
    # Re-run monorepo upsert to ensure apps are correctly configured (idempotent).
    if is_monorepo_slug "${slug}"; then
      proj_id="$(echo "${row}" | jq -r '.id')"
      row="$(upsert_monorepo_target "${proj_id}" "${slug}")"
    fi
  fi

  validate_project_row "${row}" "${slug}" \
    || die "Invalid project record for ${slug} — check API"

  CLEANUP_ROWS+=("${row}")

  proj_id="$(echo "${row}" | jq -r '.id')"
  gitlab_id="$(echo "${row}" | jq -r '.gitlabProjectId')"
  gitlab_path="$(echo "${row}" | jq -r '.gitlabPath')"
  effective="$(echo "${row}" | jq -r '.effectiveSlug')"

  [[ -n "${gitlab_id}" && "${gitlab_id}" != "null" ]] \
    || die "gitlabProjectId missing for ${gitlab_path}"

  # Env profiles (BUILD / RUNTIME markers) via Management API (same as console upload).
  sync_smoke_env_profiles "${slug}" "${proj_id}"

  # Sonar branch project provisioning via Management API (same as console Sonar panel).
  case "${slug}" in
    smoke-mono|smoke-sonar)
      provision_sonar_for_project "${proj_id}" "${slug}"
      ;;
  esac

  # Record the highest existing pipeline ID on the branch before any push.
  # Used by await_push_pipeline to detect the pipeline GitLab auto-triggers from the push.
  pre_push_pipeline_id="0"
  pre_push_pipeline_id="$(gitlab_curl -sf "${GITLAB_API_HDR[@]}" \
    "${GITLAB_API}/projects/${gitlab_id}/pipelines?ref=${SMOKE_BRANCH}&order_by=id&sort=desc&per_page=1" \
    | jq -r '.[0].id // "0"')" 2>/dev/null || pre_push_pipeline_id="0"

  # Push application sources (simulates developer git push).
  if [[ "${SMOKE_SYNC_SOURCES}" == "1" ]]; then
    local_dir="configs/${slug}"
    [[ -d "${local_dir}" ]] || die "Missing source directory ${local_dir}"
    log "info: syncing ${local_dir} → ${SMOKE_BRANCH}"
    push_git_directory "${SMOKE_GROUP_PATH}" "${slug}" "${local_dir}" "${SMOKE_BRANCH}" "${ROOT}"
  fi

  # Tolerated CI override: add `include: - local: smoke-ci.yml` to root .gitlab-ci.yml.
  # Simulates developer editing .gitlab-ci.yml in GitLab to add custom test/sonar jobs.
  if [[ "${SMOKE_CI_OVERRIDES}" == "1" ]]; then
    case "${slug}" in
      smoke-mono|smoke-sonar)
        log "info: applying smoke-ci.yml include override for ${slug}..."
        smoke_apply_ci_include "${gitlab_id}" "${gitlab_path}" "${SMOKE_BRANCH}"
        ;;
    esac
  fi

  deadline=$(( $(date +%s) + TIMEOUT ))

  if [[ "${SMOKE_TRIGGER_PIPELINE}" == "1" ]]; then
    # Wait for the pipeline GitLab auto-triggered from the push — no explicit API trigger.
    # Users never manually trigger pipelines after a push; the push itself is the trigger.
    pipeline_id="$(await_push_pipeline "${gitlab_id}" "${slug}" "${deadline}" "${pre_push_pipeline_id}")"
    log "info: pipeline ${pipeline_id} for ${gitlab_path} (push-triggered)"
    wait_pipeline_success "${gitlab_id}" "${pipeline_id}" "${slug}" "${deadline}"

    # Assert expected CI job names ran (validates monorepo per-app jobs, sonar:scan, etc.).
    mapfile -t expected_jobs < <(smoke_expected_jobs "${slug}")
    if [[ ${#expected_jobs[@]} -gt 0 ]]; then
      assert_pipeline_jobs "${gitlab_id}" "${pipeline_id}" "${slug}" "${expected_jobs[@]}"
    fi
  fi

  verify_project_urls "${row}" "${slug}" "${deadline}"
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
    # Pass all app images so multi-release Helm cleanup covers monorepo apps.
    mapfile -t app_images < <(echo "${row}" | jq -r \
      '[.deploymentTargets[]?.apps[]?.image] | unique[]' 2>/dev/null || true)
    smoke_delete_project_via_api "${mongo_id}" "${gitlab_id}" "${release}" "${path}" \
      "${app_images[@]+"${app_images[@]}"}"
  done
  smoke_preflight_clear_slots "${SMOKE_GROUP_PATH}" "${PROJECT_SLUGS[@]}"
  smoke_hard_delete_gitlab_group "${SMOKE_GROUP_PATH}"
  smoke_verify_cleanup "${SMOKE_GROUP_PATH}" "${PROJECT_SLUGS[@]}"
  log "Cleanup finished (GitLab paths freed, no-trace verified)."
fi
