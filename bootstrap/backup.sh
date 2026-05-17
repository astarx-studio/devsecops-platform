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

# Optional logical dumps when GitLab uses shared PostgreSQL (gitlab-backup excludes registry metadata DB).
dump_shared_pg() {
  local stamp="${1:?stamp required}"
  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi
  if ! docker inspect postgres >/dev/null 2>&1; then
    return 0
  fi
  # shellcheck source=/dev/null
  if [[ -f "${ROOT}/.env" ]]; then
    # shellcheck source=/dev/null
    source "${ROOT}/bootstrap/lib/load-env.sh"
    load_dotenv "${ROOT}/.env" 2>/dev/null || true
  fi
  local admin="${POSTGRES_ADMIN_USER:-admin}"
  local gitlab_db="${GITLAB_DB_NAME:-gitlabhq_production}"
  local registry_db="${REGISTRY_DB_NAME:-registry}"
  for db in "${gitlab_db}" "${registry_db}"; do
    if MSYS_NO_PATHCONV=1 docker exec postgres psql -U "${admin}" -d postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname='${db}';" 2>/dev/null | grep -q 1; then
      local out="${DST_DIR}/${db}-${stamp}.dump"
      log "Dumping shared PostgreSQL database ${db} → ${out}"
      MSYS_NO_PATHCONV=1 docker exec postgres pg_dump -U "${admin}" -d "${db}" -Fc -f "/tmp/${db}.dump"
      docker cp "postgres:/tmp/${db}.dump" "${out}"
    fi
  done
}

mkdir -p "${DST_DIR}"
dump_shared_pg "${STAMP}"
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
