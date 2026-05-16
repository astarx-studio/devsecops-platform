#!/usr/bin/env bash
# =============================================================================
# bootstrap/checks/prereqs.sh
# =============================================================================
# Verifies host tools required before k3d / Kubernetes bootstrap.
# Keeps checks minimal; k3d-cluster.sh repeats k3d/helm/kubectl with stricter messages.
#
# Usage: ./bootstrap/checks/prereqs.sh
# =============================================================================
set -euo pipefail

log()  { echo "[prereqs] $*"; }
die()  { echo "[prereqs] ERROR $*" >&2; exit 1; }

log "Checking docker..."
command -v docker >/dev/null || die "docker not found."
docker info >/dev/null 2>&1 || die "docker daemon not reachable."

log "Checking docker compose..."
docker compose version >/dev/null 2>&1 || die "docker compose plugin not found."

log "Checking k3d, helm, kubectl, jq..."
command -v k3d   >/dev/null || die "k3d not found."
command -v helm  >/dev/null || die "helm not found."
command -v kubectl >/dev/null || die "kubectl not found."
command -v jq    >/dev/null || die "jq not found."

log "All prerequisite checks passed."
