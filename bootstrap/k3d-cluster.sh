#!/usr/bin/env bash
# =============================================================================
# bootstrap/k3d-cluster.sh
# =============================================================================
# Creates (or idempotently re-uses) the dsoaas k3d cluster, attaches it to the
# Docker devops-network, and creates the required namespaces.
#
# Usage:
#   ./bootstrap/k3d-cluster.sh
#
# Environment variables (sourced from .env or inherited):
#   DOCKER_NETWORK      Docker bridge network shared by the platform stack.
#                       Default: devops-network
#   K3D_CLUSTER_NAME    Name of the k3d cluster.
#                       Default: dsoaas
#
# What it does:
#   1. Creates the k3d cluster (skips if it already exists — idempotent).
#   2. Creates the app namespaces: dev, stg, prod.
#   3. Creates eso-system namespace for External Secrets Operator.
#   4. Verifies that secrets encryption is active on the server.
#   5. Writes the merged kubeconfig to ~/.kube/config (k3d default).
# =============================================================================
set -euo pipefail

DOCKER_NETWORK="${DOCKER_NETWORK:-devops-network}"
K3D_CLUSTER_NAME="${K3D_CLUSTER_NAME:-dsoaas}"

NAMESPACES=(dev stg prod eso-system)

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
log()  { echo "[k3d-cluster] $*"; }
info() { echo "[k3d-cluster] INFO  $*"; }
warn() { echo "[k3d-cluster] WARN  $*" >&2; }
die()  { echo "[k3d-cluster] ERROR $*" >&2; exit 1; }

# -----------------------------------------------------------------------------
# 1. Preflight checks
# -----------------------------------------------------------------------------
log "Checking prerequisites..."
command -v k3d  >/dev/null || die "k3d is not installed. Run: choco install k3d"
command -v helm >/dev/null || die "helm is not installed. Run: choco install kubernetes-helm"
command -v kubectl >/dev/null || die "kubectl is not installed."

# Verify the Docker network exists
docker network inspect "${DOCKER_NETWORK}" >/dev/null 2>&1 \
  || die "Docker network '${DOCKER_NETWORK}' not found. Start the platform stack first."

info "Prerequisites OK."

# -----------------------------------------------------------------------------
# 2. Create cluster (idempotent)
# -----------------------------------------------------------------------------
if k3d cluster list | grep -q "^${K3D_CLUSTER_NAME} "; then
  warn "Cluster '${K3D_CLUSTER_NAME}' already exists — skipping creation."
else
  log "Creating k3d cluster '${K3D_CLUSTER_NAME}' on network '${DOCKER_NETWORK}'..."
  k3d cluster create "${K3D_CLUSTER_NAME}" \
    --network "${DOCKER_NETWORK}" \
    --api-port 0.0.0.0:16443 \
    --port "8081:80@loadbalancer" \
    --port "8444:443@loadbalancer" \
    --k3s-arg "--disable=servicelb@server:*" \
    --k3s-arg "--disable=traefik@server:*" \
    --k3s-arg "--secrets-encryption=true@server:*"
  info "Cluster created."
fi

# -----------------------------------------------------------------------------
# 3. Ensure kubeconfig is current
# -----------------------------------------------------------------------------
log "Merging kubeconfig for cluster '${K3D_CLUSTER_NAME}'..."
k3d kubeconfig merge "${K3D_CLUSTER_NAME}" --kubeconfig-merge-default >/dev/null
kubectl config use-context "k3d-${K3D_CLUSTER_NAME}"
info "Active context: $(kubectl config current-context)"

# Docker Desktop on Windows/Mac routes host.docker.internal through an internal
# VM bridge that may not forward the k3d API port. Patch to 127.0.0.1 when the
# generated server address is not reachable but localhost is.
SERVER_ADDR=$(kubectl config view --raw \
  -o jsonpath="{.clusters[?(@.name==\"k3d-${K3D_CLUSTER_NAME}\")].cluster.server}")
if ! curl -sk --max-time 5 "${SERVER_ADDR}/readyz" >/dev/null 2>&1; then
  warn "Server address '${SERVER_ADDR}' not reachable; patching to https://127.0.0.1:16443..."
  kubectl config set-cluster "k3d-${K3D_CLUSTER_NAME}" --server=https://127.0.0.1:16443
  info "Patched server to https://127.0.0.1:16443."
fi

# -----------------------------------------------------------------------------
# 4. Wait for the API server to be ready
# -----------------------------------------------------------------------------
log "Waiting for Kubernetes API server..."
for i in $(seq 1 30); do
  kubectl cluster-info >/dev/null 2>&1 && break
  sleep 2
done
kubectl cluster-info >/dev/null 2>&1 || die "Kubernetes API server not reachable after 60s."
info "API server is ready."

# -----------------------------------------------------------------------------
# 5. Create required namespaces (idempotent)
# -----------------------------------------------------------------------------
log "Ensuring namespaces: ${NAMESPACES[*]}"
for ns in "${NAMESPACES[@]}"; do
  if kubectl get namespace "${ns}" >/dev/null 2>&1; then
    info "Namespace '${ns}' already exists — skipping."
  else
    kubectl create namespace "${ns}"
    info "Namespace '${ns}' created."
  fi
done

# -----------------------------------------------------------------------------
# 6. Verify secrets encryption is active
# -----------------------------------------------------------------------------
log "Verifying secrets encryption (EncryptionConfiguration)..."
ENC_CHECK=$(kubectl get secret -n kube-system 2>/dev/null | grep -c "enc" || true)
# A more reliable check: inspect the server args
SERVER_ARGS=$(docker inspect "k3d-${K3D_CLUSTER_NAME}-server-0" \
  --format '{{range .Config.Cmd}}{{.}} {{end}}' 2>/dev/null || echo "")
if echo "${SERVER_ARGS}" | grep -q "secrets-encryption=true"; then
  info "Secrets encryption flag confirmed on server node."
else
  warn "Could not confirm secrets encryption flag. Inspect 'k3d-${K3D_CLUSTER_NAME}-server-0' manually."
fi

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
log "k3d cluster setup complete."
log "  Cluster   : ${K3D_CLUSTER_NAME}"
log "  Network   : ${DOCKER_NETWORK}"
log "  Context   : k3d-${K3D_CLUSTER_NAME}"
log "  Namespaces: ${NAMESPACES[*]}"
log ""
log "Next step: run bootstrap/k8s-primitives.sh to install in-cluster Traefik and ESO."
