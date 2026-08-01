#!/usr/bin/env bash
# =============================================================================
# devtools/apply-k8s-bridge.sh
# =============================================================================
# Bridges shared Postgres + RabbitMQ + Loki Docker containers into the k3d
# cluster so pods in dev/stg/prod namespaces can reach them via k8s DNS.
# Idempotent.
#
# Usage:
#   ./devtools/apply-k8s-bridge.sh
#
# Not part of make bootstrap — devtools is opt-in.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { echo "[devtools-bridge] $*"; }
info() { echo "[devtools-bridge] INFO  $*"; }
die()  { echo "[devtools-bridge] ERROR $*" >&2; exit 1; }

command -v kubectl >/dev/null || die "kubectl is not installed."

COMPOSE='docker compose -p devtools -f devtools/docker-compose.yml'

for c in devtools-postgres devtools-rabbitmq devtools-loki devtools-minio; do
  log "Checking ${c} container is running..."
  if ! docker inspect -f '{{.State.Running}}' "${c}" 2>/dev/null | grep -q true; then
    die "${c} is not running. Start it first: ${COMPOSE} up -d"
  fi
done

log "Applying k8s-bridge.yaml to context: $(kubectl config current-context)..."
# Pipe YAML so Windows path casing does not break kubectl -f <path>
cat "${SCRIPT_DIR}/k8s-bridge.yaml" | kubectl apply -f -

info "Bridge applied."
info "  Postgres:  devtools-postgres.devtools.svc.cluster.local:5432"
info "  RabbitMQ:  devtools-rabbitmq.devtools.svc.cluster.local:5672  (vhosts: dev, stg)"
info "  Mgmt UI:   devtools-rabbitmq.devtools.svc.cluster.local:15672"
info "  Loki:      devtools-loki.devtools.svc.cluster.local:3100"
info "  MinIO S3:  devtools-minio.devtools.svc.cluster.local:9000"
info "Then: cat devtools/k8s/alloy-daemonset.yaml | kubectl apply -f -"
