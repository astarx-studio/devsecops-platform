#!/usr/bin/env bash
# =============================================================================
# bootstrap/smoke-test.sh
# =============================================================================
# Lightweight post-bootstrap checks: Docker API health, k3d context, in-cluster
# Traefik Deployment, Management API /health (host-mapped port).
#
# Does **not** deploy sample apps; use your own pipeline or curl an existing
# app URL after DNS is ready.
#
# Environment:
#   K3D_CLUSTER_NAME  Default: dsoaas
#   API_LOCAL_PORT    Default: 13000 (host port mapped to api:3000)
#
# Usage: ./bootstrap/smoke-test.sh
# =============================================================================
set -euo pipefail

K3D_CLUSTER_NAME="${K3D_CLUSTER_NAME:-dsoaas}"
API_LOCAL_PORT="${API_LOCAL_PORT:-13000}"

log()  { echo "[smoke-test] $*"; }
die()  { echo "[smoke-test] ERROR $*" >&2; exit 1; }

log "Checking Docker daemon..."
docker info >/dev/null 2>&1 || die "Docker not available"

log "Checking k3d cluster context k3d-${K3D_CLUSTER_NAME}..."
kubectl config use-context "k3d-${K3D_CLUSTER_NAME}" >/dev/null \
  || die "kubectl context k3d-${K3D_CLUSTER_NAME} missing — run bootstrap/k3d-cluster.sh"

log "Checking kube-system / Traefik deployment (helm release name: traefik)..."
kubectl get deployment traefik -n kube-system >/dev/null 2>&1 \
  || die "Deployment traefik not found in kube-system — run bootstrap/k8s-primitives.sh"

log "Checking External Secrets Operator CRD..."
kubectl get crd externalsecrets.external-secrets.io >/dev/null 2>&1 \
  || die "ESO CRD missing — run bootstrap/k8s-primitives.sh"

log "Checking Management API on http://127.0.0.1:${API_LOCAL_PORT}/health ..."
if curl -sf "http://127.0.0.1:${API_LOCAL_PORT}/health" | grep -q '"status"'; then
  log "Management API /health OK"
else
  die "Management API /health failed — is the api container up?"
fi

log "All smoke checks passed."
