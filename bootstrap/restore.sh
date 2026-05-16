#!/usr/bin/env bash
# =============================================================================
# bootstrap/restore.sh
# =============================================================================
# Restores from a platform-*.tar.gz produced by bootstrap/backup.sh.
# Requires the Compose stack to be stopped so files are not held open.
#
# Usage:
#   ./bootstrap/restore.sh backups/platform-YYYYMMDD-HHMMSS.tar.gz
#   make restore ARCHIVE=backups/platform-YYYYMMDD-HHMMSS.tar.gz
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="${1:-}"

log() { echo "[restore] $*"; }
die() { echo "[restore] ERROR $*" >&2; exit 1; }

[[ -f "${ARCHIVE}" ]] || die "Usage: $0 path/to/platform-YYYYMMDD-HHMMSS.tar.gz"

cd "${ROOT}"
running="$(docker compose ps -q 2>/dev/null | tr -d '\n' || true)"
if [[ -n "${running}" ]]; then
  die "Compose stack has running containers. Run 'docker compose down' (with your profile flags if any), then retry."
fi

log "Extracting ${ARCHIVE} into ${ROOT}..."
tar -xzf "${ARCHIVE}" -C "${ROOT}"
log "Done. Next: docker compose up -d (and profiles as needed), then ./bootstrap/bootstrap.sh if k3d/Vault must be rebuilt."
