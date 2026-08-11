#!/usr/bin/env bash
# =============================================================================
# gitaly-promote-incoming.sh — recover leftover Gitaly quarantine objects
# =============================================================================
# Optional maintainer script. When GitLab OOMs or the disk fills during push,
# objects stay in objects/tmp_objdir-incoming-* and refs can point at missing
# SHAs (empty branch list, stuck MRs). Promoting those loose objects is safe:
# existing objects are left in place.
#
# Usage:
#   ./bootstrap/gitaly-promote-incoming.sh           # promote + report
#   ./bootstrap/gitaly-promote-incoming.sh --dry-run
# =============================================================================
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

log() { echo "[gitaly-promote] $*" >&2; }

if ! docker inspect gitlab >/dev/null 2>&1; then
  log "gitlab container missing — skip"
  exit 0
fi
if [[ "$(docker inspect -f '{{.State.Running}}' gitlab 2>/dev/null || true)" != "true" ]]; then
  log "gitlab not running — skip"
  exit 0
fi

script='
set -eu
root=/var/opt/gitlab/git-data/repositories
found=0
moved=0
for d in $(find "$root" -type d -name "tmp_objdir-incoming-*" 2>/dev/null); do
  found=$((found+1))
  repo=$(echo "$d" | sed "s#/objects/tmp_objdir-incoming-.*##")
  n=$(find "$d" -type f 2>/dev/null | wc -l | tr -d " ")
  echo "DIR $repo :: $(basename "$d") files=$n"
  if [ "${DRY}" = "1" ]; then
    continue
  fi
  find "$d" -type f 2>/dev/null | while read -r f; do
    rel=${f#$d/}
    case "$rel" in pack/*|info/*) continue ;; esac
    dest="$repo/objects/$rel"
    mkdir -p "$(dirname "$dest")"
    if [ ! -f "$dest" ]; then
      mv "$f" "$dest"
      echo "MOVED $rel"
    fi
  done
done
echo "SUMMARY dirs=$found"
'

if [[ "${DRY_RUN}" -eq 1 ]]; then
  docker exec -u git -e DRY=1 gitlab bash -lc "${script}"
else
  docker exec -u git -e DRY=0 gitlab bash -lc "${script}"
fi
