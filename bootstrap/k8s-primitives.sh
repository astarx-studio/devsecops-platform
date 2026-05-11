#!/usr/bin/env bash
# =============================================================================
# bootstrap/k8s-primitives.sh
# =============================================================================
# Installs in-cluster Traefik via Helm, the External Secrets Operator (ESO),
# and Stakater Reloader.
# Called after bootstrap/k3d-cluster.sh has created the cluster and namespaces.
#
# Usage:
#   ./bootstrap/k8s-primitives.sh
#
# Environment variables (sourced from .env or inherited):
#   K3D_CLUSTER_NAME    Name of the k3d cluster.  Default: dsoaas
#
# What it does:
#   1. Installs in-cluster Traefik (traefik/traefik chart) into kube-system.
#   2. Installs External Secrets Operator into eso-system.
#   3. Installs Stakater Reloader into reloader-system.
#      Reloader watches Deployments annotated with reloader.stakater.com/auto: "true"
#      and triggers a rolling restart whenever a referenced Secret or ConfigMap
#      changes — ensuring pods always run with the latest Vault-sourced secrets.
#   4. Waits for all operator pods to become healthy.
# =============================================================================
set -euo pipefail

K3D_CLUSTER_NAME="${K3D_CLUSTER_NAME:-dsoaas}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { echo "[k8s-primitives] $*"; }
info() { echo "[k8s-primitives] INFO  $*"; }
warn() { echo "[k8s-primitives] WARN  $*" >&2; }
die()  { echo "[k8s-primitives] ERROR $*" >&2; exit 1; }

# Ensure we're targeting the right cluster
kubectl config use-context "k3d-${K3D_CLUSTER_NAME}" >/dev/null \
  || die "Context 'k3d-${K3D_CLUSTER_NAME}' not found. Run k3d-cluster.sh first."

# -----------------------------------------------------------------------------
# 1. In-cluster Traefik
# -----------------------------------------------------------------------------
log "Adding Traefik Helm repo..."
helm repo add traefik https://traefik.github.io/charts --force-update >/dev/null
helm repo update >/dev/null

if helm status traefik -n kube-system >/dev/null 2>&1; then
  info "Traefik already installed — upgrading..."
  helm upgrade traefik traefik/traefik \
    -n kube-system \
    -f "${SCRIPT_DIR}/charts/traefik-values.yaml" \
    --wait --timeout 5m
else
  log "Installing in-cluster Traefik..."
  helm install traefik traefik/traefik \
    -n kube-system \
    -f "${SCRIPT_DIR}/charts/traefik-values.yaml" \
    --wait --timeout 5m
fi
info "In-cluster Traefik installed."

# -----------------------------------------------------------------------------
# 2. External Secrets Operator
# -----------------------------------------------------------------------------
log "Adding external-secrets Helm repo..."
helm repo add external-secrets https://charts.external-secrets.io --force-update >/dev/null
helm repo update >/dev/null

if helm status external-secrets -n eso-system >/dev/null 2>&1; then
  info "ESO already installed — upgrading..."
  helm upgrade external-secrets external-secrets/external-secrets \
    -n eso-system \
    --wait --timeout 5m
else
  log "Installing External Secrets Operator..."
  helm install external-secrets external-secrets/external-secrets \
    -n eso-system \
    --wait --timeout 5m
fi
info "External Secrets Operator installed."

# -----------------------------------------------------------------------------
# 3. Stakater Reloader
# -----------------------------------------------------------------------------
log "Adding stakater Helm repo..."
helm repo add stakater https://stakater.github.io/stakater-charts --force-update >/dev/null
helm repo update >/dev/null

if helm status reloader -n reloader-system >/dev/null 2>&1; then
  info "Reloader already installed — upgrading..."
  helm upgrade reloader stakater/reloader \
    -n reloader-system \
    --wait --timeout 5m
else
  log "Installing Stakater Reloader..."
  helm install reloader stakater/reloader \
    -n reloader-system \
    --create-namespace \
    --wait --timeout 5m
fi
info "Stakater Reloader installed."

# -----------------------------------------------------------------------------
# 4. Health checks
# -----------------------------------------------------------------------------
log "Waiting for Traefik pod to be ready..."
kubectl rollout status deployment/traefik -n kube-system --timeout=120s
info "Traefik ready."

log "Waiting for ESO pod to be ready..."
kubectl rollout status deployment/external-secrets -n eso-system --timeout=120s
info "ESO ready."

log "Waiting for Reloader pod to be ready..."
kubectl rollout status deployment/reloader -n reloader-system --timeout=120s
info "Reloader ready."

log "Verifying ESO CRDs..."
kubectl get crd externalsecrets.external-secrets.io >/dev/null \
  && info "CRD externalsecrets.external-secrets.io present." \
  || warn "CRD not found — ESO install may have failed."
kubectl get crd clustersecretstores.external-secrets.io >/dev/null \
  && info "CRD clustersecretstores.external-secrets.io present." \
  || warn "CRD not found — ESO install may have failed."

log "k8s-primitives setup complete."
