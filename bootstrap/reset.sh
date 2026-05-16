#!/usr/bin/env bash
# =============================================================================
# bootstrap/reset.sh
# =============================================================================
# Destroys the k3d cluster and optionally removes Compose volumes.
#
# Usage:
#   ./bootstrap/reset.sh           # k3d cluster only (Compose / .vols kept)
#   ./bootstrap/reset.sh --all     # k3d + docker compose down -v (DESTRUCTIVE)
#   make reset
#   make reset ARGS=--all
#
# Loads .env when present for K3D_CLUSTER_NAME and COMPOSE_EXTRA_ARGS.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT}"

log() { echo "[reset] $*"; }

# shellcheck source=lib/load-env.sh
source "${SCRIPT_DIR}/lib/load-env.sh"
[[ -f .env ]] && load_dotenv .env

ALL=0
[[ "${1:-}" == "--all" ]] && ALL=1

if [[ "${ALL}" == "1" ]]; then
  echo "[reset] WARNING: this will delete the k3d cluster AND all Compose volumes (.vols)."
  echo "[reset] Run ./bootstrap/backup.sh first if you want to keep state."
  read -r -p "[reset] Type 'yes' to continue: " confirm
  [[ "${confirm}" == "yes" ]] || { echo "[reset] Aborted."; exit 1; }
fi

log "Deleting k3d cluster ${K3D_CLUSTER_NAME:-dsoaas}..."
k3d cluster delete "${K3D_CLUSTER_NAME:-dsoaas}" 2>/dev/null || true

if [[ "${ALL}" == "1" ]]; then
  log "Stopping Compose and removing volumes..."
  # shellcheck disable=SC2086
  docker compose ${COMPOSE_EXTRA_ARGS:-} down -v --remove-orphans
fi

log "Done."
