#!/usr/bin/env bash
# =============================================================================
# bootstrap/upgrade.sh
# =============================================================================
# Guided, single-hop image upgrade for a pinned Compose service.
#
# What it does (for the "gitlab" service — the only one supported today):
#   1. Resolves current vs target image tag from docker-compose.yml.
#   2. Reminds you to verify the GitLab upgrade path (no version skipping).
#   3. Takes a backup (bootstrap/backup.sh) unless SKIP_BACKUP=1.
#   4. Rewrites the pinned image tag in docker-compose.yml (keeps a *.bak).
#   5. Pulls the new image and force-recreates only that service.
#   6. Waits for the container to report healthy.
#   7. Optionally (with confirmation) bumps gitlab-runner + helper_image to the
#      matching version and recreates the runner.
#
# Usage (from repo root):
#   ./bootstrap/upgrade.sh gitlab --version 18.11.2-ce.0
#   make upgrade gitlab VERSION=18.11.2-ce.0
#   make upgrade gitlab            # omit VERSION -> resolves latest tag, then asks to confirm
#
# Environment / flags:
#   VERSION=<tag>       Target image tag. When omitted, the latest published tag is
#                       resolved from Docker Hub and you are asked to confirm it.
#                       Also accepted as --version.
#   SKIP_BACKUP=1       Skip the pre-upgrade backup.
#   ASSUME_YES=1        Answer "yes" to every confirmation (non-interactive).
#   RUNNER_VERSION=<x>  Override runner version (e.g. 18.11.2). Default: derived
#                       from VERSION (strips the "-ce.N" suffix).
#   HEALTH_TIMEOUT=<s>  Seconds to wait for health (default 900; migrations are slow).
#
# GitLab has a strict upgrade path — never skip required stops. Check:
#   https://gitlab-com.gitlab.io/support/toolbox/upgrade-path/
# Run this script once per required stop.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT}"

# Internal path to the pinned compose file. Named COMPOSE_YML (not COMPOSE_FILE)
# on purpose: .env defines Docker's own COMPOSE_FILE (multi-file, semicolon-joined),
# which load_dotenv would otherwise clobber this with.
COMPOSE_YML="${ROOT}/docker-compose.yml"
RUNNER_REF_CONFIG="${ROOT}/gitlab-runner/config.toml"
RUNNER_LIVE_CONFIG="${ROOT}/.vols/gitlab-runner/config/config.toml"

log()  { echo "[upgrade] $*"; }
warn() { echo "[upgrade] WARN  $*" >&2; }
die()  { echo "[upgrade] ERROR $*" >&2; exit 1; }

# --------------------------------------------------------------------------
# Prompt for a yes/no confirmation. Auto-confirms when ASSUME_YES=1.
# $1: prompt text. Returns 0 on "yes", non-zero otherwise.
# --------------------------------------------------------------------------
confirm() {
  local prompt="${1:?prompt required}" reply
  if [[ "${ASSUME_YES:-0}" == "1" ]]; then
    log "${prompt} (auto-yes)"
    return 0
  fi
  read -r -p "[upgrade] ${prompt} Type 'yes' to continue: " reply
  [[ "${reply}" == "yes" ]]
}

# --------------------------------------------------------------------------
# Wait until the given Compose service reports a healthy container, or until
# HEALTH_TIMEOUT elapses. Services without a healthcheck are considered ready
# once "running". $1: compose service name.
# --------------------------------------------------------------------------
wait_healthy() {
  local svc="${1:?service required}" timeout="${HEALTH_TIMEOUT:-900}"
  local elapsed=0 interval=15 cid status
  cid="$(docker compose ${COMPOSE_EXTRA_ARGS:-} ps -q "${svc}" 2>/dev/null || true)"
  [[ -n "${cid}" ]] || die "No running container found for service '${svc}'."
  log "Waiting for '${svc}' to become healthy (timeout ${timeout}s)..."
  while (( elapsed < timeout )); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${cid}" 2>/dev/null || echo unknown)"
    case "${status}" in
      healthy) log "  '${svc}' is healthy (${elapsed}s)."; return 0 ;;
      running) log "  '${svc}' running, no healthcheck (${elapsed}s)."; return 0 ;;
      *)       log "  status=${status} (${elapsed}s/${timeout}s)" ;;
    esac
    sleep "${interval}"; elapsed=$(( elapsed + interval ))
  done
  return 1
}

# --------------------------------------------------------------------------
# Resolve the highest published image tag matching a regex from Docker Hub.
# $1: image repo (namespace/name, e.g. gitlab/gitlab-ce). $2: tag regex.
# Pages through Docker Hub tags (default order is by last_updated) and picks the
# highest by version sort, so date-newer backports of older minors don't win.
# Prints the tag on stdout, or nothing if none could be resolved.
# --------------------------------------------------------------------------
resolve_latest_tag() {
  local image_repo="${1:?image repo required}" regex="${2:?regex required}"
  local ns="${image_repo%%/*}" name="${image_repo#*/}"
  local url="https://hub.docker.com/v2/repositories/${ns}/${name}/tags?page_size=100"
  local page=1 max_pages=6 resp all=""
  while [[ -n "${url}" && ${page} -le ${max_pages} ]]; do
    resp="$(curl -fsSL "${url}" 2>/dev/null)" || break
    all+="$(printf '%s\n' "${resp}" | grep -oE '"name": *"[^"]+"' | sed -E 's/.*: *"([^"]+)"/\1/')"$'\n'
    url="$(printf '%s\n' "${resp}" | grep -oE '"next": *"[^"]+"' | sed -E 's/.*: *"([^"]+)"/\1/' | head -1)"
    page=$(( page + 1 ))
  done
  printf '%s\n' "${all}" | grep -E "${regex}" | sort -V | uniq | tail -1
}

# --------------------------------------------------------------------------
# Argument parsing: first non-flag token is the service; --version/-v sets tag.
# --------------------------------------------------------------------------
SERVICE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version|-v) VERSION="${2:?--version needs a value}"; shift 2 ;;
    --version=*)  VERSION="${1#*=}"; shift ;;
    --*)          die "Unknown flag: $1" ;;
    *)            [[ -z "${SERVICE}" ]] && SERVICE="$1" || die "Unexpected argument: $1"; shift ;;
  esac
done

SERVICE="${SERVICE:-gitlab}"
VERSION="${VERSION:-}"

command -v docker >/dev/null 2>&1 || die "docker not found on PATH."
[[ -f "${COMPOSE_YML}" ]] || die "docker-compose.yml not found at repo root."

# shellcheck source=lib/load-env.sh
source "${SCRIPT_DIR}/lib/load-env.sh"
[[ -f "${ROOT}/.env" ]] && load_dotenv "${ROOT}/.env"

# --------------------------------------------------------------------------
# Per-service configuration. Only gitlab is wired up today; add new services
# here (image repo + runner-sync behaviour) as they gain pinned upgrades.
# --------------------------------------------------------------------------
case "${SERVICE}" in
  gitlab)
    IMAGE_REPO="gitlab/gitlab-ce"
    LATEST_TAG_REGEX='^[0-9]+\.[0-9]+\.[0-9]+-ce\.0$'
    HAS_RUNNER_SYNC=1
    ;;
  *)
    die "Service '${SERVICE}' is not supported by this upgrade flow yet. Supported: gitlab."
    ;;
esac

# Current pinned tag straight from docker-compose.yml (first matching image line).
CURRENT_TAG="$(sed -nE "s|^[[:space:]]*image:[[:space:]]*${IMAGE_REPO}:(.+)$|\1|p" "${COMPOSE_YML}" | head -1 | tr -d '[:space:]')"
[[ -n "${CURRENT_TAG}" ]] || die "Could not find '${IMAGE_REPO}:' image pin in docker-compose.yml."

# No target given → resolve the latest published tag and require explicit confirmation below.
RESOLVED_LATEST=0
if [[ -z "${VERSION}" ]]; then
  command -v curl >/dev/null 2>&1 || die "VERSION omitted and 'curl' is unavailable to resolve the latest tag. Pass VERSION=<tag>."
  log "No VERSION given — resolving latest ${IMAGE_REPO} tag from Docker Hub..."
  VERSION="$(resolve_latest_tag "${IMAGE_REPO}" "${LATEST_TAG_REGEX}")"
  [[ -n "${VERSION}" ]] || die "Could not resolve a latest tag from Docker Hub. Pass VERSION=<tag> explicitly."
  RESOLVED_LATEST=1
fi

log "Service : ${SERVICE}"
log "Image   : ${IMAGE_REPO}"
log "Current : ${CURRENT_TAG}"
log "Target  : ${VERSION}$( [[ "${RESOLVED_LATEST}" == "1" ]] && echo '  (latest published, auto-resolved)' )"

if [[ "${CURRENT_TAG}" == "${VERSION}" ]]; then
  log "Already pinned to ${VERSION}; nothing to change. Re-running pull + recreate anyway."
fi

echo
warn "GitLab enforces a strict upgrade path — you CANNOT skip required stops."
if [[ "${RESOLVED_LATEST}" == "1" ]]; then
  warn "Target ${VERSION} is the LATEST published tag and may be several stops ahead of ${CURRENT_TAG}."
  warn "Confirm it is a valid next stop; otherwise pass an intermediate VERSION=<tag>."
fi
warn "Verify ${CURRENT_TAG} -> ${VERSION} at: https://gitlab-com.gitlab.io/support/toolbox/upgrade-path/"
warn "If intermediate stops are required, run this once per stop."
echo
confirm "Proceed with upgrading ${SERVICE} from ${CURRENT_TAG} to ${VERSION}?" \
  || die "Aborted by user."

# --------------------------------------------------------------------------
# 1. Backup (durable state under .vols + .env). Skippable.
# --------------------------------------------------------------------------
if [[ "${SKIP_BACKUP:-0}" == "1" ]]; then
  warn "SKIP_BACKUP=1 — skipping pre-upgrade backup. Ensure you have a recent one."
else
  log "Creating pre-upgrade backup..."
  bash "${SCRIPT_DIR}/backup.sh"
fi

# --------------------------------------------------------------------------
# 2. Rewrite the pinned image tag (keep a .bak of the original file).
# --------------------------------------------------------------------------
cp "${COMPOSE_YML}" "${COMPOSE_YML}.bak"
log "Backed up docker-compose.yml -> docker-compose.yml.bak"
sed -i -E "s|(^[[:space:]]*image:[[:space:]]*${IMAGE_REPO}:).*|\1${VERSION}|" "${COMPOSE_YML}"
log "Pinned ${IMAGE_REPO}: ${CURRENT_TAG} -> ${VERSION}"

# --------------------------------------------------------------------------
# 3. Pull + recreate only this service.
# --------------------------------------------------------------------------
log "Pulling ${IMAGE_REPO}:${VERSION}..."
# shellcheck disable=SC2086
docker compose ${COMPOSE_EXTRA_ARGS:-} pull "${SERVICE}"
log "Recreating '${SERVICE}' container..."
# shellcheck disable=SC2086
docker compose ${COMPOSE_EXTRA_ARGS:-} up -d --no-deps --force-recreate "${SERVICE}"

# --------------------------------------------------------------------------
# 4. Wait for health (GitLab re-runs DB migrations on first boot).
# --------------------------------------------------------------------------
if wait_healthy "${SERVICE}"; then
  log "'${SERVICE}' upgraded to ${VERSION} and healthy."
else
  warn "'${SERVICE}' did not report healthy within the timeout."
  warn "Inspect: docker compose logs -f ${SERVICE}"
  warn "Rollback: docker compose down; restore backup; 'cp docker-compose.yml.bak docker-compose.yml'; docker compose up -d"
  die "Upgrade of '${SERVICE}' did not reach a healthy state."
fi

# --------------------------------------------------------------------------
# 5. Optional gitlab-runner sync (image + helper_image + comments).
#    Runner should match/trail GitLab's major.minor, never lead it.
# --------------------------------------------------------------------------
if [[ "${HAS_RUNNER_SYNC:-0}" == "1" ]]; then
  # Derive vX.Y.Z from the GitLab tag (drops the "-ce.N" suffix) unless overridden.
  RUNNER_VERSION="${RUNNER_VERSION:-${VERSION%%-ce*}}"
  if [[ ! "${RUNNER_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    warn "Could not derive a clean runner version from '${VERSION}' (got '${RUNNER_VERSION}')."
    warn "Set RUNNER_VERSION=X.Y.Z explicitly to sync the runner; skipping runner bump."
  else
    RUNNER_MINOR="${RUNNER_VERSION%.*}"
    echo
    log "gitlab-runner should track GitLab's version. Proposed: v${RUNNER_VERSION} (helper x86_64-v${RUNNER_VERSION})."
    if confirm "Bump gitlab-runner + helper_image to v${RUNNER_VERSION} and recreate the runner?"; then
      # 5a. Compose runner image + its in-file "keep in sync" comment.
      sed -i -E \
        -e "s|(image:[[:space:]]*gitlab/gitlab-runner:)v[0-9][^[:space:]]*|\1v${RUNNER_VERSION}|" \
        -e "s|x86_64-v[0-9]+\.[0-9]+\.[0-9]+|x86_64-v${RUNNER_VERSION}|g" \
        "${COMPOSE_YML}"
      log "Pinned gitlab-runner image -> v${RUNNER_VERSION} in docker-compose.yml"

      # 5b. Tracked reference config: helper_image value + version comments.
      if [[ -f "${RUNNER_REF_CONFIG}" ]]; then
        cp "${RUNNER_REF_CONFIG}" "${RUNNER_REF_CONFIG}.bak"
        sed -i -E \
          -e "s|x86_64-v[0-9]+\.[0-9]+\.[0-9]+|x86_64-v${RUNNER_VERSION}|g" \
          -e "s|(gitlab-runner:v)[0-9]+\.[0-9]+\.x|\1${RUNNER_MINOR}.x|g" \
          "${RUNNER_REF_CONFIG}"
        log "Updated helper_image + comments in gitlab-runner/config.toml (backup: config.toml.bak)"
      fi

      # 5c. Live runtime config (auto-generated, gitignored). Update if present so
      #     running jobs actually use the new helper image.
      if [[ -f "${RUNNER_LIVE_CONFIG}" ]]; then
        sed -i -E "s|x86_64-v[0-9]+\.[0-9]+\.[0-9]+|x86_64-v${RUNNER_VERSION}|g" "${RUNNER_LIVE_CONFIG}"
        log "Updated helper_image in live runner config (.vols/gitlab-runner/config/config.toml)"
      else
        warn "Live runner config not found; helper_image will apply after the runner regenerates it."
      fi

      log "Recreating 'gitlab-runner' container..."
      # shellcheck disable=SC2086
      docker compose ${COMPOSE_EXTRA_ARGS:-} pull gitlab-runner
      # shellcheck disable=SC2086
      docker compose ${COMPOSE_EXTRA_ARGS:-} up -d --no-deps --force-recreate gitlab-runner
      log "gitlab-runner upgraded to v${RUNNER_VERSION}."
    else
      warn "Skipped runner bump. Remember: bump gitlab-runner (docker-compose.yml) and"
      warn "helper_image (gitlab-runner/config.toml) to v${RUNNER_VERSION} when convenient."
    fi
  fi
fi

echo
log "Upgrade complete: ${SERVICE} ${CURRENT_TAG} -> ${VERSION}."
log "Kept originals: docker-compose.yml.bak (and gitlab-runner/config.toml.bak if the runner was synced)."
log "Verify: docker compose ps  |  docker compose logs -f ${SERVICE}"
log "If you needed intermediate stops, re-run for the next version."
