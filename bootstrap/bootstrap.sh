#!/usr/bin/env bash
# =============================================================================
# bootstrap/bootstrap.sh
# =============================================================================
# One-shot orchestration: Docker Compose platform → GitLab ready → k3d →
# in-cluster operators → Vault K8s auth → runner RBAC → optional seed → smoke.
#
# Prereqs: filled `.env` at repo root; Docker running.
#
# Optional environment:
#   COMPOSE_EXTRA_ARGS  e.g. "--profile cftunnel" or "--profile vpnedge"
#   SKIP_SEED          set to 1 to skip seed-platform-projects.sh
#   SKIP_SMOKE         set to 1 to skip smoke-test.sh
#
# Usage (from repo root):
#   ./bootstrap/bootstrap.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log()  { echo "[bootstrap] $*"; }
die()  { echo "[bootstrap] ERROR $*" >&2; exit 1; }

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  log "Loaded .env"
else
  die "Missing .env in ${REPO_ROOT}. Copy sample.env to .env and fill values."
fi

"${SCRIPT_DIR}/checks/prereqs.sh"

log "Starting Docker Compose stack..."
# shellcheck disable=SC2086
docker compose ${COMPOSE_EXTRA_ARGS:-} up -d

"${SCRIPT_DIR}/checks/wait-gitlab.sh"

log "Creating / updating k3d cluster..."
"${SCRIPT_DIR}/k3d-cluster.sh"

log "Installing in-cluster Traefik, ESO, Reloader..."
"${SCRIPT_DIR}/k8s-primitives.sh"

log "Configuring Vault Kubernetes auth and ESO ClusterSecretStore..."
"${SCRIPT_DIR}/vault-k8s-auth.sh"

log "Applying GitLab runner RBAC and kubeconfig CI variables..."
"${SCRIPT_DIR}/runner-rbac.sh"

if [[ "${SKIP_SEED:-0}" != "1" ]]; then
  log "Seeding GitLab config/template projects (idempotent)..."
  "${SCRIPT_DIR}/seed-platform-projects.sh"
else
  log "SKIP_SEED=1 — skipping seed-platform-projects.sh"
fi

if [[ "${SKIP_SMOKE:-0}" != "1" ]]; then
  log "Running smoke checks..."
  "${SCRIPT_DIR}/smoke-test.sh"
else
  log "SKIP_SMOKE=1 — skipping smoke-test.sh"
fi

log "Bootstrap finished successfully."
