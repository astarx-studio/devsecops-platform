#!/usr/bin/env bash
# =============================================================================
# prune-docker-host.sh — reclaim Docker Desktop / host Docker disk (optional)
# =============================================================================
# Safe default: exited containers, dangling images, build cache, unused networks.
# Does NOT remove named images still referenced by a container, named volumes,
# or GitLab registry blobs under .vols/ (those need GitLab cleanup + GC).
#
# Usage (from repo root):
#   make prune-docker-host
#   make prune-docker-host ARGS='--images'          # also unused images (not in any container)
#   make prune-docker-host ARGS='--images --volumes' # + unused volumes (destructive)
#   make prune-docker-host ARGS='--retention-days'   # unused images older than
#       GITLAB_RUNNER_IMAGE_RETENTION_DAYS (default 7)
#   make prune-docker-host ARGS='--retention-days 7' # same with explicit days
#
# After large reclaim on Docker Desktop (Windows), compact the VHDX — see
# __DOCS__/01_infra/04_operations.md (Disk hygiene).
# =============================================================================
set -euo pipefail

IMAGES=0
VOLUMES=0
RETENTION_DAYS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --images) IMAGES=1; shift ;;
    --volumes) VOLUMES=1; shift ;;
    --retention-days)
      shift
      if [[ $# -gt 0 && "$1" =~ ^[0-9]+$ ]]; then
        RETENTION_DAYS="$1"
        shift
      else
        RETENTION_DAYS="${GITLAB_RUNNER_IMAGE_RETENTION_DAYS:-7}"
      fi
      ;;
    -h|--help)
      sed -n '2,19p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1 (use --images, --volumes, and/or --retention-days [N])" >&2
      exit 1
      ;;
  esac
done

log() { echo "[prune-docker-host] $*" >&2; }

command -v docker >/dev/null 2>&1 || { echo "docker not found" >&2; exit 1; }

if [[ -n "$RETENTION_DAYS" ]]; then
  if ! [[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]]; then
    echo "Invalid --retention-days / GITLAB_RUNNER_IMAGE_RETENTION_DAYS: $RETENTION_DAYS (positive integer)" >&2
    exit 1
  fi
fi

log "Pruning exited containers..."
docker container prune -f

log "Pruning dangling images..."
docker image prune -f

log "Pruning build cache..."
docker builder prune -af

log "Pruning unused networks..."
docker network prune -f

if [[ "$IMAGES" -eq 1 ]]; then
  log "Pruning unused images (not referenced by any container)..."
  docker image prune -af
fi

if [[ -n "$RETENTION_DAYS" ]]; then
  HOURS=$((RETENTION_DAYS * 24))
  log "Pruning unused images older than ${RETENTION_DAYS} day(s) (until=${HOURS}h)..."
  docker image prune -af --filter "until=${HOURS}h"
fi

if [[ "$VOLUMES" -eq 1 ]]; then
  log "Pruning unused volumes (destructive for orphaned named volumes)..."
  docker volume prune -f
fi

log "Done. On Docker Desktop, reclaim host disk with VHDX compact after wsl --shutdown (see ops docs)."
log "GitLab registry under .vols/ is separate — use project cleanup policies + registry GC."
