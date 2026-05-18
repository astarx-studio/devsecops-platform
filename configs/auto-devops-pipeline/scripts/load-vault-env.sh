#!/usr/bin/env sh
# shellcheck shell=sh
# Canonical source for review/shellcheck. CI embeds this in ci/load-vault-env.yml at compile time.
# Loads BUILD-phase env profiles from Vault for the current CI job.
# Requires: VAULT_ADDR, VAULT_TOKEN, VAULT_PROJECT_PATH, CI_COMMIT_REF_NAME
# Optional job selector: KANIKO_IMAGE_NAME or ENV_PROFILE_JOB_SELECTOR (monorepo / per-job)
#
# Outputs:
#   - raw_file → $CI_PROJECT_DIR/{workspacePath}/{filename}
#   - dotenv_build_args → $KANIKO_BUILD_ARGS_FILE (Kaniko) and $DSOAAS_ENV_EXPORTS_FILE (shell export)

set -eu

DSOAAS_DIR="${CI_PROJECT_DIR}/.dsoaas"
rm -rf "${DSOAAS_DIR}"
mkdir -p "${DSOAAS_DIR}"

DSOAAS_ENV_EXPORTS_FILE="${DSOAAS_ENV_EXPORTS_FILE:-${DSOAAS_DIR}/env-exports.sh}"

if [ -z "${VAULT_ADDR:-}" ] || [ -z "${VAULT_TOKEN:-}" ] || [ -z "${VAULT_PROJECT_PATH:-}" ]; then
  echo "load-vault-env: VAULT_ADDR/VAULT_TOKEN/VAULT_PROJECT_PATH not set — skipping env profiles"
  exit 0
fi

if ! command -v jq >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "load-vault-env: curl and jq are required (install via .ci-http-tools)" >&2
  exit 1
fi

: > "${DSOAAS_ENV_EXPORTS_FILE}"

vault_read_json() {
  path="$1"
  curl -sfS \
    -H "X-Vault-Token: ${VAULT_TOKEN}" \
    "${VAULT_ADDR}/v1/secret/data/${path}" \
    | jq -r '.data.data // {}'
}

# Normalizes workspacePath (repo-relative). Root: "", ".", "./". Nested: path/to/dir or ./path/to/dir/.
# Leading "/" is rejected (reserved for possible future host-level paths).
normalize_workspace_path() {
  p="$(printf '%s' "$1" | tr '\\' '/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  case "$p" in
    /*|[a-zA-Z]:*)
      echo "load-vault-env: workspacePath must be repo-relative (no leading /): $1" >&2
      return 1
      ;;
  esac
  while [ "${p#./}" != "$p" ]; do
    p="${p#./}"
  done
  p="${p%/}"
  if [ -z "$p" ] || [ "$p" = "." ]; then
    printf ''
    return 0
  fi
  if echo "$p" | grep -qE '(^|/)\.\.(/|$)|(^|/)\.(/|$)'; then
    echo "load-vault-env: workspacePath must not contain . or .. path segments: $1" >&2
    return 1
  fi
  printf '%s' "$p"
}

workspace_dest_path() {
  workspace="$1"
  filename="$2"
  if [ -z "$workspace" ]; then
    printf '%s/%s' "${CI_PROJECT_DIR}" "${filename}"
  else
    printf '%s/%s/%s' "${CI_PROJECT_DIR}" "${workspace}" "${filename}"
  fi
}

staged_workspace_dest() {
  workspace="$1"
  filename="$2"
  if [ -z "$workspace" ]; then
    printf '%s/staged-workspace/%s' "${DSOAAS_DIR}" "${filename}"
  else
    printf '%s/staged-workspace/%s/%s' "${DSOAAS_DIR}" "${workspace}" "${filename}"
  fi
}

stage_build_file() {
  workspace="$1"
  filename="$2"
  src="$3"
  staged="$(staged_workspace_dest "${workspace}" "${filename}")"
  mkdir -p "$(dirname "${staged}")"
  cp "${src}" "${staged}"
}

INDEX_PATH="${VAULT_PROJECT_PATH}/ci/index"
INDEX_JSON="$(vault_read_json "${INDEX_PATH}" | jq -r '._index_json // empty')"

if [ -z "${INDEX_JSON}" ] || [ "${INDEX_JSON}" = "null" ]; then
  echo "load-vault-env: no ci/index manifest at ${INDEX_PATH} — nothing to load"
  exit 0
fi

BRANCH="${CI_COMMIT_REF_NAME:-}"
JOB_SELECTOR="${KANIKO_IMAGE_NAME:-${ENV_PROFILE_JOB_SELECTOR:-}}"

echo "${INDEX_JSON}" | jq -c '.profiles[]?' | while IFS= read -r profile; do
  phase="$(echo "${profile}" | jq -r '.injectionPhase')"
  if [ "${phase}" != "build" ]; then
    continue
  fi

  if ! echo "${profile}" | jq -e --arg b "${BRANCH}" '.branches | index($b) != null' >/dev/null; then
    continue
  fi

  profile_job="$(echo "${profile}" | jq -r '.jobSelector // ""')"
  if [ "${DSOAAS_LOAD_ALL_BUILD_PROFILES:-}" != "true" ]; then
    if [ "${profile_job}" != "${JOB_SELECTOR}" ]; then
      continue
    fi
  fi

  vault_path="$(echo "${profile}" | jq -r '.vaultPath')"
  delivery="$(echo "${profile}" | jq -r '.buildDelivery // "raw_file"')"
  workspace_raw="$(echo "${profile}" | jq -r '.workspacePath // ""')"
  workspace="$(normalize_workspace_path "${workspace_raw}")" || continue
  filename="$(echo "${profile}" | jq -r '.filename')"

  secrets="$(vault_read_json "${vault_path}")"

  if [ "${delivery}" = "raw_file" ]; then
    content="$(echo "${secrets}" | jq -r '._raw_content // empty')"
    if [ -z "${content}" ]; then
      echo "load-vault-env: warn — raw_file profile missing _raw_content at ${vault_path}" >&2
      continue
    fi
    dest="$(workspace_dest_path "${workspace}" "${filename}")"
    mkdir -p "$(dirname "${dest}")"
    printf '%s' "${content}" > "${dest}"
    stage_build_file "${workspace}" "${filename}" "${dest}"
    if [ -z "${workspace}" ]; then
      echo "load-vault-env: wrote ${filename} (repo root + staged for Kaniko)"
    else
      echo "load-vault-env: wrote ${workspace}/${filename} (repo + staged)"
    fi
    continue
  fi

  if [ "${delivery}" = "dotenv_build_args" ]; then
    args_suffix=""
    if [ -n "${profile_job}" ]; then
      args_suffix="-${profile_job}"
    fi
    kaniko_args_file="${DSOAAS_DIR}/kaniko-extra-build-args${args_suffix}"
    echo "${secrets}" | jq -r 'to_entries[] | select(.key != "_raw_content") | "\(.key)\t\(.value)"' \
      | while IFS="$(printf '\t')" read -r key value; do
        [ -z "${key}" ] && continue
        printf '%s\n' "--build-arg" "${key}=${value}" >> "${kaniko_args_file}"
      done
    echo "${secrets}" | jq -r 'to_entries[] | select(.key != "_raw_content") | "export \(.key)=\(.value | @sh)"' \
      >> "${DSOAAS_ENV_EXPORTS_FILE}"

    if [ -n "${filename}" ] && [ "${filename}" != "null" ]; then
      dest="$(workspace_dest_path "${workspace}" "${filename}")"
      mkdir -p "$(dirname "${dest}")"
      echo "${secrets}" | jq -r 'to_entries[] | select(.key != "_raw_content") | "\(.key)=\(.value)"' > "${dest}"
      stage_build_file "${workspace}" "${filename}" "${dest}"
      if [ -z "${workspace}" ]; then
        echo "load-vault-env: wrote dotenv file ${filename} (repo root + staged)"
      else
        echo "load-vault-env: wrote dotenv file ${workspace}/${filename} (repo + staged)"
      fi
    fi
    echo "load-vault-env: exported keys from ${vault_path} for CI job env"
  fi
done

echo "load-vault-env: done (branch=${BRANCH}, jobSelector=${JOB_SELECTOR:-<empty>})"
