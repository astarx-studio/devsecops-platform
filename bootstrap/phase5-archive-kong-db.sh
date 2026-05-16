#!/usr/bin/env bash
# =============================================================================
# bootstrap/phase5-archive-kong-db.sh
# =============================================================================
# Optional one-shot run after Phase 5 Kong removal: if `.vols/kong-db` still
# exists on disk, pack it into `backups/v1-kong-db-YYYYMMDD.tar.gz` (idempotent
# skip if archive for today already exists) so you can delete the working copy
# and reclaim disk space without losing a cold-storage snapshot.
#
# Usage: ./bootstrap/phase5-archive-kong-db.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT}/.vols/kong-db"
DST_DIR="${ROOT}/backups"
STAMP="$(date +%Y%m%d)"
ARCHIVE="${DST_DIR}/v1-kong-db-${STAMP}.tar.gz"

if [[ ! -d "${SRC}" ]]; then
  echo "[phase5-archive] No ${SRC} — nothing to archive."
  exit 0
fi

mkdir -p "${DST_DIR}"
if [[ -f "${ARCHIVE}" ]]; then
  echo "[phase5-archive] Already exists: ${ARCHIVE}"
  exit 0
fi

echo "[phase5-archive] Creating ${ARCHIVE} ..."
tar -czf "${ARCHIVE}" -C "${ROOT}/.vols" kong-db
echo "[phase5-archive] Done. You may now remove ${SRC} if desired."
