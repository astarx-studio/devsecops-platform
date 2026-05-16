#!/bin/sh
# ==========================================================================
# SonarQube — post-start bootstrap (idempotent)
# ==========================================================================
# Groups: Sonar built-in sonar-users (default for all SAML users) + admins (Keycloak admins only).
# SAML: sonarqube-config-init writes sonar.properties.
# Marker skips only the first-boot admin password change.
# ==========================================================================

set -eu

log() { printf '[%s] %s\n' "$1" "$2"; }

: "${SONAR_INTERNAL_URL:?SONAR_INTERNAL_URL required}"
: "${SONAR_ADMIN_USER:?SONAR_ADMIN_USER required}"
: "${SONAR_ADMIN_PASSWORD:?SONAR_ADMIN_PASSWORD required}"

MARKER="${SONAR_BOOTSTRAP_MARKER:-/work/.sonar-bootstrap-done}"
FORCE="${SONAR_BOOTSTRAP_FORCE:-false}"
ADMIN_GROUP="${SONAR_ADMIN_GROUP:-admins}"
DEFAULT_GROUP="sonar-users"

sonar_curl() {
  # shellcheck disable=SC2068
  curl -sf -u "${AUTH_USER}:${AUTH_PASS}" "$@"
}

sonar_post() {
  sonar_curl -X POST "$@"
}

wait_for_sonar() {
  log INFO "Waiting for SonarQube at ${SONAR_INTERNAL_URL}..."
  attempts=0
  max_attempts="${SONAR_BOOTSTRAP_WAIT_ATTEMPTS:-60}"
  until curl -sf "${SONAR_INTERNAL_URL}/api/system/status" | grep -q '"status":"UP"'; do
    attempts=$((attempts + 1))
    if [ "${attempts}" -ge "${max_attempts}" ]; then
      log ERROR "SonarQube did not become UP in time."
      exit 1
    fi
    sleep 5
  done
  log INFO "SonarQube is UP."
}

resolve_admin_credentials() {
  AUTH_USER="${SONAR_ADMIN_USER}"
  AUTH_PASS="${SONAR_ADMIN_PASSWORD}"
  if sonar_curl "${SONAR_INTERNAL_URL}/api/users/current" >/dev/null 2>&1; then
    log INFO "Using configured admin credentials."
    return
  fi

  log INFO "Trying default admin credentials (first boot)..."
  AUTH_USER="admin"
  AUTH_PASS="admin"
  if ! sonar_curl "${SONAR_INTERNAL_URL}/api/users/current" >/dev/null 2>&1; then
    log ERROR "Cannot authenticate to SonarQube. Set SONAR_ADMIN_PASSWORD or reset admin."
    exit 1
  fi

  if [ "${SONAR_ADMIN_PASSWORD}" != "admin" ]; then
    log INFO "Changing default admin password..."
    sonar_post \
      --data-urlencode "login=${SONAR_ADMIN_USER}" \
      --data-urlencode "password=${SONAR_ADMIN_PASSWORD}" \
      --data-urlencode "previousPassword=admin" \
      "${SONAR_INTERNAL_URL}/api/users/change_password" >/dev/null
    AUTH_USER="${SONAR_ADMIN_USER}"
    AUTH_PASS="${SONAR_ADMIN_PASSWORD}"
  fi
}

maybe_change_admin_password() {
  if [ -f "${MARKER}" ] && [ "${FORCE}" != "true" ]; then
    log INFO "Bootstrap marker present; skipping admin password change."
    return
  fi
  resolve_admin_credentials
}

ensure_authenticated() {
  AUTH_USER="${SONAR_ADMIN_USER}"
  AUTH_PASS="${SONAR_ADMIN_PASSWORD}"
  if ! sonar_curl "${SONAR_INTERNAL_URL}/api/users/current" >/dev/null 2>&1; then
    log ERROR "Cannot authenticate with SONAR_ADMIN_* credentials."
    exit 1
  fi
}

group_exists() {
  name="$1"
  sonar_curl "${SONAR_INTERNAL_URL}/api/user_groups/search?q=${name}" \
    | grep -q "\"name\":\"${name}\""
}

ensure_group() {
  name="$1"
  description="${2:-}"
  if group_exists "${name}"; then
    log INFO "Sonar group '${name}' already exists."
    return
  fi
  log INFO "Creating Sonar group '${name}'..."
  if [ -n "${description}" ]; then
    sonar_post \
      --data-urlencode "name=${name}" \
      --data-urlencode "description=${description}" \
      "${SONAR_INTERNAL_URL}/api/user_groups/create" >/dev/null
  else
    sonar_post --data-urlencode "name=${name}" \
      "${SONAR_INTERNAL_URL}/api/user_groups/create" >/dev/null
  fi
}

grant_global_permission() {
  group="$1"
  permission="$2"
  sonar_post \
    --data-urlencode "groupName=${group}" \
    --data-urlencode "permission=${permission}" \
    "${SONAR_INTERNAL_URL}/api/permissions/add_group" >/dev/null 2>&1 || true
}

delete_group_if_exists() {
  name="$1"
  if ! group_exists "${name}"; then
    return
  fi
  log INFO "Removing Sonar group '${name}'..."
  sonar_post --data-urlencode "name=${name}" \
    "${SONAR_INTERNAL_URL}/api/user_groups/delete" >/dev/null 2>&1 \
    || log INFO "Could not delete '${name}' (may be built-in)."
}

configure_groups() {
  # Built-in default group — ensure standard developer permissions.
  for permission in scan provisioning; do
    grant_global_permission "${DEFAULT_GROUP}" "${permission}"
  done

  ensure_group "${ADMIN_GROUP}" "Platform and Sonar administrators"
  grant_global_permission "${ADMIN_GROUP}" "admin"

  # Legacy cleanup from earlier layouts.
  delete_group_if_exists "users"
  delete_group_if_exists "sonar-admins"

  # Reset default group if a previous bootstrap pointed at custom "users".
  log INFO "Ensuring sonar.defaultGroup=${DEFAULT_GROUP}..."
  sonar_post \
    --data-urlencode "key=sonar.defaultGroup" \
    --data-urlencode "value=${DEFAULT_GROUP}" \
    "${SONAR_INTERNAL_URL}/api/settings/set" >/dev/null 2>&1 || true

  log INFO "Group normalization complete."
}

wait_for_sonar
maybe_change_admin_password
ensure_authenticated
configure_groups

mkdir -p "$(dirname "${MARKER}")"
touch "${MARKER}"
log INFO "SonarQube bootstrap complete."
