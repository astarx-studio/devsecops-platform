#!/usr/bin/env bash
# =============================================================================
# bootstrap/vault-k8s-auth.sh
# =============================================================================
# Wires Vault (OpenBao) Kubernetes auth to the k3d cluster so that the
# External Secrets Operator can authenticate and read project secrets.
#
# Usage:
#   ./bootstrap/vault-k8s-auth.sh
#
# Environment variables (sourced from .env or inherited):
#   VAULT_ROOT_TOKEN      Root/admin token for Vault.  Required.
#   VAULT_ADDR            Vault API address reachable from this host.
#                         Default: http://localhost:8200 (via mapped port)
#   K3D_CLUSTER_NAME      k3d cluster name.  Default: dsoaas
#
# What it does:
#   1. Copies the k3d server CA cert into the vault container.
#   2. Creates vault-token-reviewer SA + system:auth-delegator binding + token.
#   3. Enables vault auth/kubernetes (idempotent).
#   4. Configures auth/kubernetes with k3d CA + Docker DNS hostname API URL + reviewer JWT.
#   5. Creates policy: app-secrets-read (read secret/data/projects/*).
#   6. Creates role: eso-reader (bound to eso-system/external-secrets, TTL 1h).
#   7. Applies ClusterSecretStore vault-backend via kubectl.
#   8. Runs a quick smoke test: writes a Vault secret, creates an ExternalSecret,
#      verifies the K8s Secret materialises, then cleans up.
# =============================================================================
set -euo pipefail

VAULT_ROOT_TOKEN="${VAULT_ROOT_TOKEN:-}"
VAULT_ADDR_HOST="${VAULT_ADDR_HOST:-http://localhost:8200}"
VAULT_CONTAINER="${VAULT_CONTAINER:-vault}"
K3D_CLUSTER_NAME="${K3D_CLUSTER_NAME:-dsoaas}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { echo "[vault-k8s-auth] $*"; }
info() { echo "[vault-k8s-auth] INFO  $*"; }
warn() { echo "[vault-k8s-auth] WARN  $*" >&2; }
die()  { echo "[vault-k8s-auth] ERROR $*" >&2; exit 1; }

# vault_cmd <subcommand…> — runs vault inside the vault container
vault_cmd() {
  docker exec \
    -e VAULT_TOKEN="${VAULT_ROOT_TOKEN}" \
    -e VAULT_ADDR=http://localhost:8200 \
    -e REVIEWER_JWT="${REVIEWER_JWT:-}" \
    "${VAULT_CONTAINER}" \
    vault "$@"
}

# -----------------------------------------------------------------------------
# Preflight
# -----------------------------------------------------------------------------
[[ -z "${VAULT_ROOT_TOKEN}" ]] && die "VAULT_ROOT_TOKEN is not set."
command -v kubectl >/dev/null || die "kubectl not found."
kubectl config use-context "k3d-${K3D_CLUSTER_NAME}" >/dev/null \
  || die "Context 'k3d-${K3D_CLUSTER_NAME}' not found. Run k3d-cluster.sh first."
kubectl get crd clustersecretstores.external-secrets.io >/dev/null 2>&1 \
  || die "ESO CRDs not found. Run k8s-primitives.sh first."

# -----------------------------------------------------------------------------
# 1. Extract k3d server CA cert
# -----------------------------------------------------------------------------
log "Extracting k3d server CA cert..."
CA_TMP="$(mktemp).crt"
docker cp "k3d-${K3D_CLUSTER_NAME}-server-0:/var/lib/rancher/k3s/server/tls/server-ca.crt" "${CA_TMP}" \
  || die "Could not copy CA cert from k3d server node."
docker cp "${CA_TMP}" "${VAULT_CONTAINER}:/tmp/k3d-ca.crt"
rm -f "${CA_TMP}"
info "CA cert copied into ${VAULT_CONTAINER}:/tmp/k3d-ca.crt"

# Use the stable Docker DNS hostname for the k3d API server instead of a
# dynamic IP address.  The hostname is fixed regardless of container restarts,
# so Vault's stored kubernetes auth config survives k3d server container
# restarts without needing to be reconfigured.
K3D_API_HOST="k3d-${K3D_CLUSTER_NAME}-server-0"
info "k3d API server hostname: ${K3D_API_HOST}"

# -----------------------------------------------------------------------------
# 2. Create vault-token-reviewer SA (idempotent)
# -----------------------------------------------------------------------------
log "Creating vault-token-reviewer ServiceAccount..."
kubectl apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: vault-token-reviewer
  namespace: kube-system
  labels:
    app.kubernetes.io/managed-by: dsoaas-bootstrap
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: vault-token-reviewer
  labels:
    app.kubernetes.io/managed-by: dsoaas-bootstrap
subjects:
  - kind: ServiceAccount
    name: vault-token-reviewer
    namespace: kube-system
roleRef:
  kind: ClusterRole
  name: system:auth-delegator
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: v1
kind: Secret
metadata:
  name: vault-token-reviewer-token
  namespace: kube-system
  annotations:
    kubernetes.io/service-account.name: vault-token-reviewer
  labels:
    app.kubernetes.io/managed-by: dsoaas-bootstrap
type: kubernetes.io/service-account-token
EOF
info "vault-token-reviewer SA applied."

log "Waiting for reviewer token to populate..."
for i in $(seq 1 15); do
  REVIEWER_JWT=$(kubectl get secret vault-token-reviewer-token -n kube-system \
    -o jsonpath='{.data.token}' 2>/dev/null | base64 -d 2>/dev/null || true)
  [[ -n "${REVIEWER_JWT}" ]] && break
  sleep 2
done
[[ -z "${REVIEWER_JWT}" ]] && die "vault-token-reviewer token did not populate."
export REVIEWER_JWT
info "Reviewer token obtained (length: ${#REVIEWER_JWT})."

# -----------------------------------------------------------------------------
# 3. Enable Kubernetes auth (idempotent)
# -----------------------------------------------------------------------------
log "Enabling kubernetes auth method..."
if vault_cmd auth list 2>/dev/null | grep -q "^kubernetes/"; then
  info "kubernetes auth already enabled."
else
  vault_cmd auth enable kubernetes
  info "kubernetes auth enabled."
fi

# -----------------------------------------------------------------------------
# 4. Configure Kubernetes auth
# -----------------------------------------------------------------------------
log "Configuring kubernetes auth..."
docker exec \
  -e VAULT_TOKEN="${VAULT_ROOT_TOKEN}" \
  -e VAULT_ADDR=http://localhost:8200 \
  -e REVIEWER_JWT="${REVIEWER_JWT}" \
  "${VAULT_CONTAINER}" \
  sh -c "vault write auth/kubernetes/config \
    kubernetes_host='https://${K3D_API_HOST}:6443' \
    kubernetes_ca_cert=@/tmp/k3d-ca.crt \
    token_reviewer_jwt=\"\$REVIEWER_JWT\" \
    issuer='https://kubernetes.default.svc.cluster.local'"
info "kubernetes auth configured."

# -----------------------------------------------------------------------------
# 5. Create app-secrets-read policy
# -----------------------------------------------------------------------------
log "Writing app-secrets-read policy..."
docker exec \
  -e VAULT_TOKEN="${VAULT_ROOT_TOKEN}" \
  -e VAULT_ADDR=http://localhost:8200 \
  "${VAULT_CONTAINER}" \
  sh -c 'vault policy write app-secrets-read - <<EOF
path "secret/data/projects/*" {
  capabilities = ["read"]
}
path "secret/metadata/projects/*" {
  capabilities = ["read", "list"]
}
EOF'
info "Policy app-secrets-read written."

# -----------------------------------------------------------------------------
# 6. Create eso-reader role
# -----------------------------------------------------------------------------
log "Creating eso-reader role..."
vault_cmd write auth/kubernetes/role/eso-reader \
  bound_service_account_names="external-secrets" \
  bound_service_account_namespaces="eso-system" \
  policies="app-secrets-read" \
  ttl="1h"
info "Role eso-reader created."

# -----------------------------------------------------------------------------
# 7. Apply ClusterSecretStore
# -----------------------------------------------------------------------------
log "Applying ClusterSecretStore vault-backend..."
# Restart ESO to pick up fresh Vault config before applying the store
kubectl rollout restart deployment/external-secrets -n eso-system >/dev/null
kubectl rollout status deployment/external-secrets -n eso-system --timeout=120s >/dev/null
kubectl apply -f "${SCRIPT_DIR}/k8s/cluster-secret-store.yaml"
info "ClusterSecretStore applied."

log "Waiting for ClusterSecretStore to become Ready..."
for i in $(seq 1 30); do
  STATUS=$(kubectl get clustersecretstore vault-backend \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)
  [[ "${STATUS}" == "True" ]] && break
  sleep 3
done
STATUS=$(kubectl get clustersecretstore vault-backend \
  -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)
if [[ "${STATUS}" == "True" ]]; then
  info "ClusterSecretStore vault-backend is Ready."
else
  warn "ClusterSecretStore not Ready after 90s. Check: kubectl describe clustersecretstore vault-backend"
fi

# -----------------------------------------------------------------------------
# 8. Smoke test
# -----------------------------------------------------------------------------
log "Running smoke test..."
SMOKE_PATH="projects/_smoketest/dev"

docker exec \
  -e VAULT_TOKEN="${VAULT_ROOT_TOKEN}" \
  -e VAULT_ADDR=http://localhost:8200 \
  "${VAULT_CONTAINER}" \
  vault kv put "secret/${SMOKE_PATH}" foo=bar >/dev/null
info "Vault smoke-test secret written at secret/${SMOKE_PATH}."

kubectl apply -f "${SCRIPT_DIR}/k8s/smoketest-external-secret.yaml" >/dev/null
log "Waiting for ExternalSecret to sync..."
for i in $(seq 1 20); do
  READY=$(kubectl get externalsecret smoketest-secret -n dev \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)
  [[ "${READY}" == "True" ]] && break
  sleep 3
done

FOO_VAL=$(kubectl get secret smoketest-secret -n dev \
  -o jsonpath='{.data.foo}' 2>/dev/null | base64 -d 2>/dev/null || true)

if [[ "${FOO_VAL}" == "bar" ]]; then
  info "SMOKE TEST PASSED: foo=${FOO_VAL}"
else
  warn "SMOKE TEST FAILED: expected 'bar', got '${FOO_VAL}'."
  warn "Check: kubectl describe externalsecret smoketest-secret -n dev"
fi

# Cleanup smoke-test resources
kubectl delete externalsecret smoketest-secret -n dev --ignore-not-found >/dev/null
kubectl delete secret smoketest-secret -n dev --ignore-not-found >/dev/null
docker exec \
  -e VAULT_TOKEN="${VAULT_ROOT_TOKEN}" \
  -e VAULT_ADDR=http://localhost:8200 \
  "${VAULT_CONTAINER}" \
  vault kv delete "secret/${SMOKE_PATH}" >/dev/null 2>&1 || true
info "Smoke-test resources cleaned up."

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
log "vault-k8s-auth setup complete."
log "  Vault K8s auth : auth/kubernetes/"
log "  Policy         : app-secrets-read"
log "  Role           : eso-reader (eso-system/external-secrets, TTL 1h)"
log "  ClusterSecretStore: vault-backend (Status: ${STATUS:-unknown})"
log ""
log "Next step: proceed to Phase 3 (Helm chart wrapper + Auto DevOps templates)."
