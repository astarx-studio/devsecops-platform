#!/usr/bin/env bash
# =============================================================================
# bootstrap/lib/smoke-ci-overrides.sh
# =============================================================================
# Idempotently injects `  - local: smoke-ci.yml` into the project's root
# .gitlab-ci.yml include block via the GitLab Files API.
#
# This simulates the developer-owned CI override pattern described in the
# DSOaaS docs: the developer adds custom test/sonar jobs in smoke-ci.yml and
# references it from their project's .gitlab-ci.yml include list.
#
# It does NOT touch the managed includes (auto-devops-pipeline, .dsoaas/*) and
# does NOT manage deploy/build CI — that remains the API's responsibility.
#
# Requires: gitlab-api.sh sourced by caller.
#   GITLAB_API, GITLAB_API_HDR, gitlab_curl
# =============================================================================

# Fetches the current content of a file from the GitLab repository.
# Args: $1 gitlab_project_id, $2 file_path (URL-encoded), $3 ref (branch)
# Echoes raw (decoded) content to stdout; returns 1 on error.
smoke_ci_get_file() {
  local pid="$1"
  local encoded_path="$2"
  local ref="$3"
  local resp raw_b64
  resp="$(gitlab_curl -sf "${GITLAB_API_HDR[@]}" \
    "${GITLAB_API}/projects/${pid}/repository/files/${encoded_path}?ref=${ref}" 2>/dev/null || true)"
  [[ -n "${resp}" ]] || return 1
  # GitLab returns line-wrapped base64; strip newlines before decoding.
  raw_b64="$(echo "${resp}" | jq -r '.content' | tr -d '\n')"
  [[ -n "${raw_b64}" ]] || return 1
  echo "${raw_b64}" | base64 -d 2>/dev/null || return 1
}

# Inserts `  - local: smoke-ci.yml` into the YAML include block using awk.
# Handles the DSOaaS-managed .gitlab-ci.yml structure:
#   include:
#     - project: ...  (managed)
#     - local: ...    (optional managed)
#   <optional user keys>
#
# Echos the updated content to stdout.
smoke_ci_inject_include() {
  local content="$1"
  local entry="  - local: smoke-ci.yml"

  # If already present — return as-is.
  if echo "${content}" | grep -qF 'smoke-ci.yml'; then
    echo "${content}"
    return 0
  fi

  # Use awk: collect lines, find the include block boundary, then insert entry.
  echo "${content}" | awk -v entry="${entry}" '
    BEGIN { in_include=0; done=0; last_include_line=-1; ORS="\n" }
    /^include:/ { in_include=1; print; next }
    in_include && !done {
      if (/^[[:space:]]/) {
        # Still inside the include block
        buf[NR] = $0
        last_include_line = NR
      } else {
        # Hit a non-indented line: flush buffered include lines, inject entry, then print this line
        for (i = 1; i <= last_include_line; i++) print buf[i]
        print entry
        print ""
        in_include = 0
        done = 1
        print
      }
      next
    }
    { print }
    END {
      if (in_include && !done) {
        # include block was at the end of the file
        for (i = 1; i <= last_include_line; i++) print buf[i]
        print entry
        print ""
      }
    }
  '
}

# Adds `  - local: smoke-ci.yml` to the include block of the root
# .gitlab-ci.yml if not already present. Uses the GitLab Commits API so the
# result shows up as a developer commit (not a DSOaaS automated commit).
#
# Args: $1 gitlab_project_id, $2 group_path/slug, $3 branch
smoke_apply_ci_include() {
  local pid="$1"
  local gitlab_path="$2"
  local branch="${3:-develop}"

  # .gitlab-ci.yml: dots and hyphens are URL-safe, no encoding needed.
  local encoded=".gitlab-ci.yml"

  local current_content attempt
  for attempt in 1 2 3; do
    if current_content="$(smoke_ci_get_file "${pid}" "${encoded}" "${branch}")"; then
      break
    fi
    [[ "${attempt}" -lt 3 ]] && sleep 5 || true
  done
  if [[ -z "${current_content:-}" ]]; then
    warn "smoke-ci-overrides: could not fetch .gitlab-ci.yml for ${gitlab_path} — skipping include injection"
    return 0
  fi

  # Idempotency check: skip if smoke-ci.yml already referenced.
  if echo "${current_content}" | grep -qF 'smoke-ci.yml'; then
    log "smoke-ci-overrides: smoke-ci.yml already in .gitlab-ci.yml for ${gitlab_path}"
    return 0
  fi

  # Build updated content: insert entry into the include block.
  local updated
  updated="$(smoke_ci_inject_include "${current_content}")"

  if [[ -z "${updated}" ]]; then
    warn "smoke-ci-overrides: failed to generate updated .gitlab-ci.yml for ${gitlab_path} — skipping"
    return 0
  fi

  # Commit via GitLab Commits API (simulates developer commit in GitLab editor).
  local payload resp http
  payload="$(jq -n \
    --arg branch "${branch}" \
    --arg content "${updated}" \
    --arg message "chore(smoke): add smoke-ci.yml include for test/sonar overrides" \
    '{
      branch: $branch,
      commit_message: $message,
      actions: [{
        action: "update",
        file_path: ".gitlab-ci.yml",
        content: $content
      }]
    }')"

  resp="$(gitlab_curl -s -w "\n%{http_code}" \
    "${GITLAB_API_HDR[@]}" -X POST \
    "${GITLAB_API}/projects/${pid}/repository/commits" \
    -d "${payload}")"
  http="$(echo "${resp}" | tail -1)"
  resp="$(echo "${resp}" | sed '$d')"

  if [[ "${http}" == "201" ]]; then
    log "smoke-ci-overrides: committed smoke-ci.yml include to ${gitlab_path} (${branch})"
  else
    warn "smoke-ci-overrides: commit failed (HTTP ${http}) for ${gitlab_path}: ${resp}"
  fi
}
