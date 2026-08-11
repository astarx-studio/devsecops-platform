#!/usr/bin/env bash
# =============================================================================
# watchdog.sh — disk failsafe (warn → drain → ordered stop)
# =============================================================================
# Optional maintainer script. MUST run on the Windows/Linux *host* (Git Bash /
# Task Scheduler), not inside a container — bind-mounted .vols live on C: and
# `df` inside Docker Desktop is the VHDX, not NTFS.
#
# Tiers (GiB free on the repo volume, all overridable in .env):
#   WATCHDOG_WARN_FREE_GB      — email once per excursion (default 80)
#   WATCHDOG_SHUTDOWN_FREE_GB  — quiesce, drain, ordered stop (default 50)
#
# Emails (SMTP_* + WATCHDOG_NOTIFY_EMAILS): warning, shutdown-init,
# shutdown-failing, shutdown-successful.
#
# Timeouts default *relaxed* (safety over haste). Auto-start is NOT done.
#
# Usage:
#   ./bootstrap/watchdog.sh
#   ./bootstrap/watchdog.sh --loop 120
#   ./bootstrap/watchdog.sh --dry-run
#   ./bootstrap/watchdog.sh --force-drain
#   ./bootstrap/watchdog.sh --test-email
#   ./bootstrap/watchdog.sh --clear
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=/dev/null
source "${ROOT}/bootstrap/lib/load-env.sh"
# shellcheck source=/dev/null
source "${ROOT}/bootstrap/lib/send-smtp.sh"
load_dotenv "${ROOT}/.env" || true

WARN_FREE_GB="${WATCHDOG_WARN_FREE_GB:-80}"
SHUTDOWN_FREE_GB="${WATCHDOG_SHUTDOWN_FREE_GB:-50}"
# Back-compat: old single trip var maps to shutdown if warn/shutdown unset in env
# but defaults above already apply after dotenv.
if [[ -n "${WATCHDOG_MIN_FREE_GB:-}" && -z "${WATCHDOG_SHUTDOWN_FREE_GB:-}" ]]; then
  SHUTDOWN_FREE_GB="${WATCHDOG_MIN_FREE_GB}"
fi

DRAIN_SECONDS="${WATCHDOG_DRAIN_SECONDS:-3600}"
GITLAB_STOP_TIMEOUT="${WATCHDOG_GITLAB_STOP_TIMEOUT:-900}"
STOP_TIMEOUT="${WATCHDOG_STOP_TIMEOUT:-180}"
DATA_STOP_TIMEOUT="${WATCHDOG_DATA_STOP_TIMEOUT:-600}"
EDGE_STOP_TIMEOUT="${WATCHDOG_EDGE_STOP_TIMEOUT:-120}"

STATE_FILE="${ROOT}/.vols/watchdog.state"
LOG_FILE="${ROOT}/.vols/watchdog.log"

LOOP=0
INTERVAL=120
DRY_RUN=0
FORCE=0
CLEAR=0
TEST_EMAIL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --loop)
      LOOP=1
      if [[ "${2:-}" =~ ^[0-9]+$ ]]; then
        INTERVAL="$2"
        shift
      fi
      ;;
    --loop=*)
      LOOP=1
      INTERVAL="${1#--loop=}"
      ;;
    --dry-run) DRY_RUN=1 ;;
    --force-drain) FORCE=1 ;;
    --test-email) TEST_EMAIL=1 ;;
    --clear) CLEAR=1 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

log() {
  local line="[watchdog] $(date -Iseconds 2>/dev/null || date) $*"
  echo "$line" >&2
  mkdir -p "$(dirname "${LOG_FILE}")"
  echo "$line" >>"${LOG_FILE}" 2>/dev/null || true
}

notify() {
  local event="$1"
  local subject="$2"
  local body="$3"
  log "email event=${event} to=${WATCHDOG_NOTIFY_EMAILS:-<unset>}"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    log "DRY-RUN: skip SMTP (${event}) ${subject}"
    return 0
  fi
  if send_smtp "${subject}" "${body}"; then
    log "email sent (${event})"
    return 0
  fi
  log "WARN email failed (${event}) — shutdown path continues"
  return 1
}

hostname_safe() {
  hostname 2>/dev/null || echo unknown-host
}

mail_context() {
  cat <<EOF

Host: $(hostname_safe)
Repo: ${ROOT}
Free: ${1:-?} GiB
Warn threshold: ${WARN_FREE_GB} GiB
Shutdown threshold: ${SHUTDOWN_FREE_GB} GiB
State: $(state_get)
Time: $(date -Iseconds 2>/dev/null || date)

${2:-}
EOF
}

free_gb() {
  local avail
  avail="$(df -Pk "${ROOT}" | awk 'NR==2 {print $4}')"
  if [[ -z "${avail}" || ! "${avail}" =~ ^[0-9]+$ ]]; then
    echo 0
    return
  fi
  echo $((avail / 1024 / 1024))
}

state_get() {
  [[ -f "${STATE_FILE}" ]] && cat "${STATE_FILE}" || echo "ok"
}

state_set() {
  mkdir -p "$(dirname "${STATE_FILE}")"
  echo "$1" >"${STATE_FILE}"
}

if [[ "${CLEAR}" -eq 1 ]]; then
  rm -f "${STATE_FILE}"
  if docker inspect traefik >/dev/null 2>&1; then
    docker exec traefik rm -f /etc/traefik/dynamic/zz-watchdog-lock.yml 2>/dev/null || true
  fi
  log "cleared trip state (start the stack yourself: docker compose up -d)"
  exit 0
fi

if [[ "${TEST_EMAIL}" -eq 1 ]]; then
  free="$(free_gb)"
  notify "warning" \
    "[watchdog] TEST email from $(hostname_safe)" \
    "$(mail_context "${free}" "This is a test. SMTP and WATCHDOG_NOTIFY_EMAILS are working if you received this.")"
  exit $?
fi

install_traefik_lock() {
  if ! docker inspect -f '{{.State.Running}}' traefik 2>/dev/null | grep -qx true; then
    return 0
  fi
  docker exec traefik sh -c 'cat > /etc/traefik/dynamic/zz-watchdog-lock.yml <<'\''EOF'\''
http:
  routers:
    watchdog-lock:
      rule: PathPrefix(`/`)
      entryPoints:
        - websecure
      priority: 1000000
      service: watchdog-503
      tls: {}
  services:
    watchdog-503:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:9"
EOF'
}

quiesce() {
  log "QUIESCE — blocking new work (free=${1}GiB <= ${SHUTDOWN_FREE_GB}GiB)"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    log "DRY-RUN: would SIGQUIT gitlab-runner + install Traefik 503 lock"
    return 0
  fi
  install_traefik_lock || log "WARN traefik lock failed"
  if docker inspect -f '{{.State.Running}}' gitlab-runner 2>/dev/null | grep -qx true; then
    docker kill -s QUIT gitlab-runner 2>/dev/null || true
    log "sent SIGQUIT to gitlab-runner"
  fi
}

inflight_jobs() {
  docker ps -q --filter "name=runner-" --filter "status=running" 2>/dev/null | wc -l | tr -d ' '
}

inflight_git() {
  if ! docker inspect -f '{{.State.Running}}' gitlab 2>/dev/null | grep -qx true; then
    echo 0
    return
  fi
  docker exec gitlab bash -lc 'ps -eo args | grep -E "[g]it-receive-pack|[g]it-upload-pack" | wc -l' 2>/dev/null | tr -d ' ' || echo 0
}

DRAIN_TIMED_OUT=0
drain() {
  DRAIN_TIMED_OUT=0
  local deadline=$((SECONDS + DRAIN_SECONDS))
  log "DRAIN — waiting up to ${DRAIN_SECONDS}s for in-flight work"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    log "DRY-RUN: skip wait"
    return 0
  fi
  while (( SECONDS < deadline )); do
    local jobs gitn
    jobs="$(inflight_jobs)"
    gitn="$(inflight_git)"
    log "drain: runner_job_containers=${jobs} git_pack_procs=${gitn}"
    if [[ "${jobs}" -eq 0 && "${gitn}" -eq 0 ]]; then
      log "drain complete"
      return 0
    fi
    sleep 20
  done
  DRAIN_TIMED_OUT=1
  log "WARN drain timeout (${DRAIN_SECONDS}s) — proceeding to ordered stop"
}

STOP_ERRORS=()
compose_stop() {
  local timeout="$1"
  shift
  if [[ $# -eq 0 ]]; then
    return 0
  fi
  log "stop -t ${timeout} $*"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    return 0
  fi
  if ! docker compose stop -t "${timeout}" "$@"; then
    STOP_ERRORS+=("$*")
    log "WARN compose stop failed: $*"
    return 1
  fi
}

ordered_stop() {
  STOP_ERRORS=()
  log "STOP — ordered compose stop (relaxed timeouts)"
  compose_stop "${STOP_TIMEOUT}" gitlab-runner || true
  compose_stop "${GITLAB_STOP_TIMEOUT}" gitlab || true
  compose_stop "${STOP_TIMEOUT}" api console sonarqube sonarqube-mcp || true
  compose_stop "${STOP_TIMEOUT}" minio || true
  compose_stop "${DATA_STOP_TIMEOUT}" mongo postgres || true
  compose_stop "${STOP_TIMEOUT}" vault keycloak \
    oauth2-proxy oauth2-proxy-apps oauth2-proxy-devtools oauth2-proxy-apps-hostfix || true
  compose_stop "${EDGE_STOP_TIMEOUT}" cloudflared wireguard || true
  compose_stop "${EDGE_STOP_TIMEOUT}" traefik || true
  log "ordered stop finished errors=${#STOP_ERRORS[@]}"
}

run_shutdown() {
  local free="$1"
  state_set "draining"
  notify "shutdown-init" \
    "[watchdog] SHUTDOWN started on $(hostname_safe) (${free} GiB free)" \
    "$(mail_context "${free}" "Quiesce → drain (up to ${DRAIN_SECONDS}s) → ordered stop. New CI/HTTP is being blocked. The stack will NOT auto-start.")"

  quiesce "${free}"
  drain
  ordered_stop
  state_set "stopped"

  local detail=""
  if [[ "${DRAIN_TIMED_OUT}" -eq 1 ]]; then
    detail+="Drain timed out after ${DRAIN_SECONDS}s (in-flight work may have been cut)."
    detail+=$'\n'
  fi
  if [[ "${#STOP_ERRORS[@]}" -gt 0 ]]; then
    detail+="compose stop failed for: ${STOP_ERRORS[*]}"
    detail+=$'\n'
  fi

  if [[ -n "${detail}" ]]; then
    notify "shutdown-failing" \
      "[watchdog] SHUTDOWN incomplete on $(hostname_safe)" \
      "$(mail_context "${free}" "${detail}Check .vols/watchdog.log and docker compose ps.")"
    return 1
  fi

  notify "shutdown-successful" \
    "[watchdog] SHUTDOWN completed on $(hostname_safe)" \
    "$(mail_context "${free}" "All service groups stopped. Recover: ./bootstrap/watchdog.sh --clear && docker compose up -d")"
  return 0
}

tick() {
  bash "${ROOT}/bootstrap/gitaly-promote-incoming.sh" || log "WARN gitaly-promote failed"

  local st free
  st="$(state_get)"
  free="$(free_gb)"
  log "tick state=${st} free_gb=${free} warn=${WARN_FREE_GB} shutdown=${SHUTDOWN_FREE_GB}"

  if [[ "${st}" == "stopped" ]]; then
    log "already tripped — start stack only after: ./bootstrap/watchdog.sh --clear && docker compose up -d"
    return 0
  fi

  if [[ "${st}" == "draining" ]]; then
    # Resume an interrupted drain (e.g. Task Scheduler killed the previous run).
    run_shutdown "${free}" || true
    return 0
  fi

  if [[ "${FORCE}" -eq 1 || "${free}" -le "${SHUTDOWN_FREE_GB}" ]]; then
    run_shutdown "${free}" || true
    return 0
  fi

  if [[ "${free}" -le "${WARN_FREE_GB}" ]]; then
    if [[ "${st}" != "warned" ]]; then
      state_set "warned"
      notify "warning" \
        "[watchdog] WARNING low disk on $(hostname_safe) (${free} GiB free)" \
        "$(mail_context "${free}" "Still above shutdown (${SHUTDOWN_FREE_GB} GiB). Reclaim registry / prune / compact VHDX. Shutdown will drain then stop if free falls further.")"
    fi
    return 0
  fi

  if [[ "${st}" == "warned" ]]; then
    log "free space recovered above warn — resetting state to ok"
    state_set "ok"
  fi
}

if [[ "${LOOP}" -eq 1 ]]; then
  log "loop every ${INTERVAL}s (warn=${WARN_FREE_GB} shutdown=${SHUTDOWN_FREE_GB})"
  while true; do
    tick || log "WARN tick error"
    sleep "${INTERVAL}"
  done
fi

tick
