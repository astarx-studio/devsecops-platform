#!/bin/sh
# Verify that every GitLab seam the DSOaaS plugins depend on still exists.
# Usage: check-seams.sh <seams.txt> <gitlab-rails root>
# A path may contain * (shell glob): the needle must appear in at least one match.
# Exits non-zero (failing the image build) and lists each missing seam.
set -eu

SEAMS="${1:?seams file required}"
ROOT="${2:?gitlab-rails root required}"
TAB="$(printf '\t')"
missing=0
checked=0

while IFS= read -r line || [ -n "$line" ]; do
  line="$(printf '%s' "$line" | tr -d '\r')" # tolerate a CRLF checkout
  case "$line" in ''|'#'*) continue ;; esac

  case "$line" in
    '!'*)
      path="${line#!}"
      checked=$((checked + 1))
      if [ -e "${ROOT}/${path}" ]; then
        echo "[seams] FORBIDDEN  ${path} exists (this plugin set is CE-only)" >&2
        missing=$((missing + 1))
      fi
      continue
      ;;
  esac

  path="${line%%"${TAB}"*}"
  needle="${line#*"${TAB}"}"
  checked=$((checked + 1))
  case "$path" in
    *'*'*)
      # Glob path (e.g. hash-named compiled assets): any matching file will do.
      if ! grep -qlF -- "${needle}" ${ROOT}/${path} 2>/dev/null; then
        echo "[seams] MISSING  ${path}: ${needle}" >&2
        missing=$((missing + 1))
      fi
      continue
      ;;
  esac
  if [ ! -f "${ROOT}/${path}" ]; then
    echo "[seams] MISSING FILE  ${path}" >&2
    missing=$((missing + 1))
  elif ! grep -qF -- "${needle}" "${ROOT}/${path}"; then
    echo "[seams] MISSING  ${path}: ${needle}" >&2
    missing=$((missing + 1))
  fi
done < "${SEAMS}"

if [ "${missing}" -gt 0 ]; then
  echo "[seams] ${missing}/${checked} seam(s) broken. This GitLab version needs a plugin review before upgrading." >&2
  exit 1
fi
echo "[seams] all ${checked} seams present"
