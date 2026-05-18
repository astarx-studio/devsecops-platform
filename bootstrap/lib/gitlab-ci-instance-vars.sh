#!/usr/bin/env bash
# =============================================================================
# bootstrap/lib/gitlab-ci-instance-vars.sh
# =============================================================================
# Upsert GitLab instance-level CI variables for external-runner compatibility.
# Expects: GITLAB_ROOT_TOKEN, gitlab-api.sh sourced by caller.
# Optional: GITLAB_REGISTRY_DOMAIN, VAULT_CI_URL (from .env via load_dotenv).
# =============================================================================

gitlab_upsert_instance_ci_variable() {
  local key="$1"
  local value="$2"
  local masked="${3:-false}"
  local api code body

  api="$(gitlab_api_v4_base)"
  body="$(jq -n --arg key "${key}" --arg value "${value}" --argjson masked "${masked}" \
    '{key: $key, value: $value, masked: $masked, variable_type: "env_var"}')"

  code="$(gitlab_curl -s -o /dev/null -w "%{http_code}" "${GITLAB_API_HDR[@]}" -X PUT \
    "${api}/admin/ci/variables/${key}" -d "${body}" 2>/dev/null || echo "000")"
  if [[ "${code}" == "200" ]]; then
    log "GitLab instance CI variable ${key} updated (HTTP ${code})"
    return 0
  fi

  code="$(gitlab_curl -s -o /dev/null -w "%{http_code}" "${GITLAB_API_HDR[@]}" -X POST \
    "${api}/admin/ci/variables" -d "${body}" 2>/dev/null || echo "000")"
  if [[ "${code}" == "201" ]]; then
    log "GitLab instance CI variable ${key} created (HTTP ${code})"
    return 0
  fi

  warn "GitLab instance CI variable ${key} upsert failed (last HTTP ${code})"
  return 1
}

# Helm OCI registry for external runners is configured on the runner itself
# (CHART_REGISTRY_HOST / CHART_REGISTRY_PLAIN_HTTP). In-stack jobs use pipeline
# defaults (gitlab:5000). Do not set instance-level CHART_REGISTRY_* — it breaks auto mode.
sync_gitlab_chart_registry_instance_vars() {
  local host="${GITLAB_REGISTRY_DOMAIN:-}"
  [[ -n "${host}" ]] || return 0
  log "Helm OCI for external runners: set CHART_REGISTRY_HOST=${host} on the runner (see gitlab-runner/config.external-runner.toml.example)."
}

# Optional: instance override so all projects inherit CI-reachable Vault URL.
sync_gitlab_vault_ci_instance_var() {
  local url="${VAULT_CI_URL:-}"
  if [[ -z "${url}" && -n "${VAULT_DOMAIN:-}" ]]; then
    url="https://${VAULT_DOMAIN}"
  fi
  [[ -n "${url}" ]] || return 0
  log "Syncing instance CI variable VAULT_ADDR for CI jobs (${url})..."
  gitlab_upsert_instance_ci_variable "VAULT_ADDR" "${url}" "false"
}

sync_gitlab_external_runner_instance_vars() {
  sync_gitlab_chart_registry_instance_vars
  sync_gitlab_vault_ci_instance_var
}
