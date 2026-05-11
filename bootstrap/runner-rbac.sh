#!/usr/bin/env bash
# =============================================================================
# bootstrap/runner-rbac.sh
# =============================================================================
# Creates a ServiceAccount, Role, and RoleBinding for the GitLab Runner
# ("gitlab-deployer") in each app namespace (dev, stg, prod).
# Also generates a per-env kubeconfig (base64-encoded) and stores it as
# env-scoped masked CI variables in GitLab under the "configs" group.
#
# Usage:
#   ./bootstrap/runner-rbac.sh
#
# Prerequisites:
#   - k3d cluster running (k3d-cluster.sh completed)
#   - GITLAB_ROOT_TOKEN       — GitLab PAT with api scope
#   - GITLAB_DOMAIN           — e.g. gitlab.devops.yadatechnology.com
#   - GITLAB_CONFIG_GROUP_ID  — numeric ID of the configs group in GitLab
#   - DOCKER_NETWORK          — Docker bridge network name.  Default: devops-network
#
# What it does (per namespace: dev, stg, prod):
#   1. Creates ServiceAccount "gitlab-deployer".
#   2. Creates Role "gitlab-deployer" with permissions for Deployments,
#      Services, Ingresses, ConfigMaps, Secrets, ExternalSecrets.
#   3. Creates RoleBinding binding the SA to the Role.
#   4. Generates a kubeconfig scoped to that namespace + SA token.
#   5. Base64-encodes the kubeconfig and upserts it as the CI variable
#      KUBECONFIG_B64 (env-scoped: dev / stg / prod) in GitLab.
# =============================================================================
set -euo pipefail

K3D_CLUSTER_NAME="${K3D_CLUSTER_NAME:-dsoaas}"
DOCKER_NETWORK="${DOCKER_NETWORK:-devops-network}"
GITLAB_DOMAIN="${GITLAB_DOMAIN:-}"
GITLAB_ROOT_TOKEN="${GITLAB_ROOT_TOKEN:-}"
GITLAB_CONFIG_GROUP_ID="${GITLAB_CONFIG_GROUP_ID:-}"
ENVS=(dev stg prod)
SA_NAME="gitlab-deployer"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KUBECONFIG_DIR="${SCRIPT_DIR}/../.vols/kubeconfigs"

log()  { echo "[runner-rbac] $*"; }
info() { echo "[runner-rbac] INFO  $*"; }
warn() { echo "[runner-rbac] WARN  $*" >&2; }
die()  { echo "[runner-rbac] ERROR $*" >&2; exit 1; }

# -----------------------------------------------------------------------------
# Preflight
# -----------------------------------------------------------------------------
kubectl config use-context "k3d-${K3D_CLUSTER_NAME}" >/dev/null \
  || die "Context 'k3d-${K3D_CLUSTER_NAME}' not found. Run k3d-cluster.sh first."

[[ -z "${GITLAB_DOMAIN}" ]]         && die "GITLAB_DOMAIN is not set."
[[ -z "${GITLAB_ROOT_TOKEN}" ]]     && die "GITLAB_ROOT_TOKEN is not set."
[[ -z "${GITLAB_CONFIG_GROUP_ID}" ]] && die "GITLAB_CONFIG_GROUP_ID is not set."

mkdir -p "${KUBECONFIG_DIR}"
info "Kubeconfigs will be written to: ${KUBECONFIG_DIR}"

# -----------------------------------------------------------------------------
# Retrieve cluster endpoint (as seen from inside devops-network)
# The k3d server LB container hostname resolves inside devops-network.
# -----------------------------------------------------------------------------
CLUSTER_HOST="k3d-${K3D_CLUSTER_NAME}-serverlb"
CLUSTER_PORT="6443"
CLUSTER_ENDPOINT="https://${CLUSTER_HOST}:${CLUSTER_PORT}"

# Fetch cluster CA from the current kubeconfig
CLUSTER_CA=$(kubectl config view --raw -o jsonpath="{.clusters[?(@.name==\"k3d-${K3D_CLUSTER_NAME}\")].cluster.certificate-authority-data}")
[[ -z "${CLUSTER_CA}" ]] && die "Could not extract cluster CA from kubeconfig."
info "Cluster endpoint : ${CLUSTER_ENDPOINT}"

# -----------------------------------------------------------------------------
# Per-environment loop
# -----------------------------------------------------------------------------
for ENV in "${ENVS[@]}"; do
  log "--- Processing namespace: ${ENV} ---"

  # 1. ServiceAccount
  if kubectl get serviceaccount "${SA_NAME}" -n "${ENV}" >/dev/null 2>&1; then
    info "ServiceAccount '${SA_NAME}' already exists in '${ENV}' — skipping."
  else
    kubectl create serviceaccount "${SA_NAME}" -n "${ENV}"
    info "ServiceAccount '${SA_NAME}' created in '${ENV}'."
  fi

  # 2. Role
  kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${SA_NAME}
  namespace: ${ENV}
  labels:
    app.kubernetes.io/managed-by: dsoaas-bootstrap
rules:
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets", "statefulsets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["services", "configmaps", "secrets", "pods", "pods/log", "serviceaccounts"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["external-secrets.io"]
    resources: ["externalsecrets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["autoscaling"]
    resources: ["horizontalpodautoscalers"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
EOF
  info "Role '${SA_NAME}' applied in '${ENV}'."

  # 3. RoleBinding
  kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${SA_NAME}
  namespace: ${ENV}
  labels:
    app.kubernetes.io/managed-by: dsoaas-bootstrap
subjects:
  - kind: ServiceAccount
    name: ${SA_NAME}
    namespace: ${ENV}
roleRef:
  kind: Role
  apiGroup: rbac.authorization.k8s.io
  name: ${SA_NAME}
EOF
  info "RoleBinding '${SA_NAME}' applied in '${ENV}'."

  # 4. Create a long-lived token secret (K8s ≥1.24 no longer auto-creates tokens)
  SECRET_NAME="${SA_NAME}-token"
  if kubectl get secret "${SECRET_NAME}" -n "${ENV}" >/dev/null 2>&1; then
    info "Token secret '${SECRET_NAME}' already exists in '${ENV}'."
  else
    kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: ${SECRET_NAME}
  namespace: ${ENV}
  annotations:
    kubernetes.io/service-account.name: ${SA_NAME}
  labels:
    app.kubernetes.io/managed-by: dsoaas-bootstrap
type: kubernetes.io/service-account-token
EOF
    # Wait for the token to be populated
    for i in $(seq 1 15); do
      TOKEN=$(kubectl get secret "${SECRET_NAME}" -n "${ENV}" \
        -o jsonpath='{.data.token}' 2>/dev/null | base64 -d 2>/dev/null || true)
      [[ -n "${TOKEN}" ]] && break
      sleep 2
    done
    info "Token secret '${SECRET_NAME}' created in '${ENV}'."
  fi

  # 5. Retrieve token
  TOKEN=$(kubectl get secret "${SECRET_NAME}" -n "${ENV}" \
    -o jsonpath='{.data.token}' | base64 -d)
  [[ -z "${TOKEN}" ]] && die "Could not retrieve SA token for namespace '${ENV}'."

  # 6. Write kubeconfig for this env
  KUBECONFIG_FILE="${KUBECONFIG_DIR}/kubeconfig-${ENV}.yaml"
  cat > "${KUBECONFIG_FILE}" <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: k3d-${K3D_CLUSTER_NAME}
    cluster:
      server: ${CLUSTER_ENDPOINT}
      certificate-authority-data: ${CLUSTER_CA}
contexts:
  - name: ${ENV}
    context:
      cluster: k3d-${K3D_CLUSTER_NAME}
      namespace: ${ENV}
      user: ${SA_NAME}-${ENV}
current-context: ${ENV}
users:
  - name: ${SA_NAME}-${ENV}
    user:
      token: ${TOKEN}
EOF
  info "Kubeconfig written: ${KUBECONFIG_FILE}"

  # 7. Base64-encode and upsert as GitLab CI variable (env-scoped, masked)
  KUBECONFIG_B64=$(base64 -w0 < "${KUBECONFIG_FILE}" 2>/dev/null \
    || base64 < "${KUBECONFIG_FILE}")  # macOS base64 has no -w flag

  # Map env name to GitLab environment scope pattern
  case "${ENV}" in
    dev)  GL_SCOPE="dev" ;;
    stg)  GL_SCOPE="stg" ;;
    prod) GL_SCOPE="prod" ;;
  esac

  # Pre-flight: warn if multiple KUBECONFIG_B64 variables already exist for
  # this scope from prior buggy runs (GitLab allows duplicates per scope via
  # POST, so we surface them early before the upsert).
  EXISTING_SCOPES=$(curl -sf \
    -H "PRIVATE-TOKEN: ${GITLAB_ROOT_TOKEN}" \
    "https://${GITLAB_DOMAIN}/api/v4/groups/${GITLAB_CONFIG_GROUP_ID}/variables?per_page=100" \
    2>/dev/null \
    | grep -o '"key":"KUBECONFIG_B64"[^}]*"environment_scope":"[^"]*"' \
    | grep -o '"environment_scope":"[^"]*"' \
    | sed 's/"environment_scope":"//;s/"//' || true)
  DUPE_COUNT=$(echo "${EXISTING_SCOPES}" | grep -c "^${GL_SCOPE}$" || true)
  if [[ "${DUPE_COUNT}" -gt 1 ]]; then
    warn "Found ${DUPE_COUNT} KUBECONFIG_B64 variables for scope '${GL_SCOPE}' — delete duplicates in GitLab UI before re-running."
  fi

  # Upsert: try PUT first (update) — the filter query param ensures GitLab
  # disambiguates by environment_scope, preventing updates to the wrong scope.
  HTTP_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" \
    --request PUT \
    --header "PRIVATE-TOKEN: ${GITLAB_ROOT_TOKEN}" \
    --form "value=${KUBECONFIG_B64}" \
    --form "masked=true" \
    --form "environment_scope=${GL_SCOPE}" \
    "https://${GITLAB_DOMAIN}/api/v4/groups/${GITLAB_CONFIG_GROUP_ID}/variables/KUBECONFIG_B64?filter%5Benvironment_scope%5D=${GL_SCOPE}" \
    2>/dev/null || echo "000")

  if [[ "${HTTP_STATUS}" == "200" ]]; then
    info "GitLab CI variable KUBECONFIG_B64 (scope: ${GL_SCOPE}) updated."
  else
    # PUT failed — try POST (create)
    HTTP_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" \
      --request POST \
      --header "PRIVATE-TOKEN: ${GITLAB_ROOT_TOKEN}" \
      --form "key=KUBECONFIG_B64" \
      --form "value=${KUBECONFIG_B64}" \
      --form "masked=true" \
      --form "environment_scope=${GL_SCOPE}" \
      "https://${GITLAB_DOMAIN}/api/v4/groups/${GITLAB_CONFIG_GROUP_ID}/variables" \
      2>/dev/null || echo "000")

    if [[ "${HTTP_STATUS}" =~ ^2 ]]; then
      info "GitLab CI variable KUBECONFIG_B64 (scope: ${GL_SCOPE}) created."
    else
      warn "Failed to upsert GitLab CI variable for scope '${GL_SCOPE}' (HTTP ${HTTP_STATUS})."
      warn "Set it manually: KUBECONFIG_B64 (env scope: ${GL_SCOPE}) = contents of ${KUBECONFIG_FILE} (base64)"
    fi
  fi

done

# -----------------------------------------------------------------------------
# Validate: kubectl test from a throwaway container on devops-network.
#
# Host-side validation is unreliable because the kubeconfig server address
# (k3d-dsoaas-serverlb) is a Docker DNS hostname only resolvable inside the
# bridge network — not from the host.  A sidecar container joined to the same
# network can resolve it correctly and serves as the ground truth.
#
# MSYS_NO_PATHCONV / MSYS2_ARG_CONV_EXCL suppress Git Bash path mangling on
# Windows when passing Unix-style volume mounts to docker run.
# -----------------------------------------------------------------------------
log "Validating kubeconfigs from devops-network sidecar..."
for ENV in "${ENVS[@]}"; do
  KC="${KUBECONFIG_DIR}/kubeconfig-${ENV}.yaml"
  if MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
      docker run --rm \
        --network "${DOCKER_NETWORK}" \
        -v "${KC}:/kc:ro" \
        bitnami/kubectl:latest \
        --kubeconfig=/kc get pods -n "${ENV}" >/dev/null 2>&1; then
    info "kubeconfig-${ENV}.yaml: access OK."
  else
    warn "kubeconfig-${ENV}.yaml: access FAILED. Check SA permissions."
  fi
done

log "runner-rbac setup complete."
log "Kubeconfigs: ${KUBECONFIG_DIR}/"
log "GitLab CI variable KUBECONFIG_B64 set (env-scoped) on group ${GITLAB_CONFIG_GROUP_ID}."
