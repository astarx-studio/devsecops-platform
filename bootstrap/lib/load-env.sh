#!/usr/bin/env bash
# =============================================================================
# bootstrap/lib/load-env.sh
# =============================================================================
# Export KEY=value pairs from a dotenv file without evaluating shell syntax.
# Safe for unquoted values that contain spaces (e.g. SMTP_FROM_NAME=DevOps Platform).
#
# Usage (after sourcing this file):
#   load_dotenv [.env]   # returns 1 if the file is missing
# =============================================================================

load_dotenv() {
  local env_file="${1:-.env}"
  if [[ ! -f "${env_file}" ]]; then
    return 1
  fi

  local line key val
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
    [[ "${line}" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)= ]] || continue

    key="${BASH_REMATCH[1]}"
    val="${line#*=}"
    if [[ "${val}" =~ ^\"(.*)\"$ ]]; then
      val="${BASH_REMATCH[1]}"
    elif [[ "${val}" =~ ^\'(.*)\'$ ]]; then
      val="${BASH_REMATCH[1]}"
    fi

    printf -v "${key}" '%s' "${val}"
    export "${key}"
  done < "${env_file}"
}
