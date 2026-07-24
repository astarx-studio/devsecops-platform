#!/usr/bin/env bash
# =============================================================================
# devtools/apply-k8s-bridge.sh
# =============================================================================
# Bridges the devtools-postgres Docker container into the k3d cluster so pods
# in dev/stg/prod namespaces can reach it via normal k8s DNS. Idempotent.
#
# Usage:
#   ./devtools/apply-k8s-bridge.sh
#
# Prerequisites:
#   - devtools/docker-compose.yml stack is up (devtools-postgres running)
#   - k3d cluster is up (bootstrap/k3d-cluster.sh) and kubectl context is set
#
# Not part of the mandatory `make bootstrap` chain — devtools is opt-in and
# this is applied manually once, after both stacks above are running.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { echo "[devtools-bridge] $*"; }
info() { echo "[devtools-bridge] INFO  $*"; }
die()  { echo "[devtools-bridge] ERROR $*" >&2; exit 1; }

command -v kubectl >/dev/null || die "kubectl is not installed."

log "Checking devtools-postgres container is running..."
docker inspect -f '{{.State.Running}}' devtools-postgres 2>/dev/null | grep -q true \
  || die "devtools-postgres is not running. Start it first: docker compose -p devtools -f devtools/docker-compose.yml up -d"

log "Applying k8s-bridge.yaml (namespace/Service/Endpoints) to current context: $(kubectl config current-context)..."
kubectl apply -f "${SCRIPT_DIR}/k8s-bridge.yaml"

info "Bridge applied. In-cluster DNS name: devtools-postgres.devtools.svc.cluster.local:5432"
