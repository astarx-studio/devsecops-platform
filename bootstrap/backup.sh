#!/usr/bin/env bash
# =============================================================================
# bootstrap/backup.sh
# =============================================================================
# Idempotent backup of platform Compose state. Writes a tarball under backups/.
# Includes: .env (when present), .vols/ (persistent volumes). Excludes heavy or
# rebuildable paths (GitLab build cache, logs, node artifacts).
#
# Usage (from repo root):
#   ./bootstrap/backup.sh
#   make backup
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST_DIR="${ROOT}/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="${DST_DIR}/platform-${STAMP}.tar.gz"

log() { echo "[backup] $*"; }

mkdir -p "${DST_DIR}"
log "Creating ${ARCHIVE}..."

members=()
[[ -f "${ROOT}/.env" ]] && members+=(".env") || log "WARN  No .env at repo root — archive will contain .vols only"
[[ -d "${ROOT}/.vols" ]] && members+=(".vols") || { log "WARN  No .vols directory — nothing to archive"; exit 1; }

# shellcheck disable=SC2086
tar -czf "${ARCHIVE}" \
  --exclude='.vols/gitlab/data/builds' \
  --exclude='.vols/gitlab/logs' \
  --exclude='node_modules' \
  --exclude='api/node_modules' \
  --exclude='api/dist' \
  -C "${ROOT}" "${members[@]}"

log "Done. Size: $(du -h "${ARCHIVE}" | cut -f1)"
log "To restore: ./bootstrap/restore.sh ${ARCHIVE}"
log "Or: make restore ARCHIVE=backups/$(basename "${ARCHIVE}")"
