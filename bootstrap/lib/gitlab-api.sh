#!/usr/bin/env bash
# =============================================================================
# bootstrap/lib/gitlab-api.sh
# =============================================================================
# GitLab REST API helpers for bootstrap scripts on the Docker host.
#
# By default calls http://localhost/api/v4 inside the gitlab container (works
# when GITLAB_DOMAIN is only reachable via Traefik/DNS and host curl times out).
#
# Override for host-reachable API:
#   GITLAB_API_BASE_URL=https://gitlab.devops.example.com/api/v4
#
# Requires: GITLAB_ROOT_TOKEN
# Optional: GITLAB_CONTAINER (default: gitlab)
# =============================================================================

: "${GITLAB_ROOT_TOKEN:?GITLAB_ROOT_TOKEN is required for GitLab API calls}"

GITLAB_CONTAINER="${GITLAB_CONTAINER:-gitlab}"
GITLAB_API_HDR=(-H "PRIVATE-TOKEN: ${GITLAB_ROOT_TOKEN}" -H "Content-Type: application/json")

gitlab_api_v4_base() {
  if [[ -n "${GITLAB_API_BASE_URL:-}" ]]; then
    echo "${GITLAB_API_BASE_URL%/}"
  else
    echo "http://localhost/api/v4"
  fi
}

gitlab_api_uses_docker() {
  [[ -z "${GITLAB_API_BASE_URL:-}" ]]
}

# curl wrapper: uses docker exec gitlab when GITLAB_API_BASE_URL is unset.
gitlab_curl() {
  if gitlab_api_uses_docker; then
    docker exec "${GITLAB_CONTAINER}" curl "$@"
  else
    curl "$@"
  fi
}

gitlab_curl_sf() {
  gitlab_curl -sf "$@"
}

gitlab_api_url() {
  local path="$1"
  [[ "${path}" == /* ]] || path="/${path}"
  echo "$(gitlab_api_v4_base)${path}"
}
