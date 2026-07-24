#!/usr/bin/env bash
# Append oauth2-proxy-apps .env keys when missing (idempotent).
# Usage: ./bootstrap/ensure-oauth2-proxy-apps-env.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { echo "[ensure-oauth2-apps-env] $*"; }
die() { echo "[ensure-oauth2-apps-env] ERROR $*" >&2; exit 1; }

[[ -f .env ]] || die "Missing .env — copy sample.env first"

env_has() { grep -qE "^${1}=" .env; }

DOMAIN="$(grep -E '^DOMAIN=' .env | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')"
[[ -n "${DOMAIN}" ]] || die "DOMAIN is empty in .env"

append_if_missing() {
  local key="$1"
  local value="$2"
  if env_has "${key}"; then
    log "${key} already set — skipping"
  else
    printf '\n# Added by ensure-oauth2-proxy-apps-env.sh\n%s=%s\n' "${key}" "${value}" >> .env
    log "Appended ${key}"
  fi
}

gen_hex() { openssl rand -hex 32; }
gen_cookie() { openssl rand -base64 32 | head -c 32; }

append_if_missing "OAUTH_APPS_DOMAIN" "oauth-apps.devops.${DOMAIN}"
append_if_missing "KC_CLIENT_SECRET_OAUTH2_PROXY_APPS" "$(gen_hex)"
append_if_missing "OAUTH2_PROXY_APPS_COOKIE_SECRET" "$(gen_cookie)"
append_if_missing "OAUTH2_PROXY_APPS_ALLOWED_GROUPS" "admins,users"

log "Done. Review .env, then: docker compose up -d oauth2-proxy-apps traefik"
