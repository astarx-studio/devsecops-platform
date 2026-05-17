#!/usr/bin/env bash
# =============================================================================
# bootstrap/smoke-test.sh
# =============================================================================
# Lightweight post-bootstrap checks: Docker, k3d, Traefik, ESO/Vault secret
# pipeline, Management API, optional SonarQube and Postgres headroom.
#
# Catches deploy failures such as:
#   - ClusterSecretStore vault-backend not Ready (Vault K8s auth drift)
#   - ExternalSecret SecretSyncedError → missing app Secret → CreateContainerConfigError
#   - Postgres connection exhaustion (registry / GitLab 500 on push)
#
# Does **not** deploy sample apps; use make smoke-deploy for E2E app pipelines.
#
# Environment:
#   K3D_CLUSTER_NAME       Default: dsoaas
#   API_LOCAL_PORT         Default: 13000
#   VAULT_ROOT_TOKEN       Optional; enables live Vault→ESO→Secret sync probe
#   VAULT_CONTAINER        Default: vault
#   POSTGRES_MAX_UTIL_PCT  Warn/fail threshold for shared Postgres (default: 90)
#
# Usage: ./bootstrap/smoke-test.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

K3D_CLUSTER_NAME="${K3D_CLUSTER_NAME:-dsoaas}"
API_LOCAL_PORT="${API_LOCAL_PORT:-13000}"
VAULT_CONTAINER="${VAULT_CONTAINER:-vault}"
POSTGRES_MAX_UTIL_PCT="${POSTGRES_MAX_UTIL_PCT:-90}"
APP_NAMESPACES=(dev stg prod)

log()  { echo "[smoke-test] $*"; }
warn() { echo "[smoke-test] WARN  $*" >&2; }
die()  { echo "[smoke-test] ERROR $*" >&2; exit 1; }

# Patch kubeconfig when Docker Desktop cannot reach host.docker.internal:16443.
ensure_kubectl_api() {
  local ctx="k3d-${K3D_CLUSTER_NAME}"
  local cluster="${ctx}"
  kubectl config use-context "${ctx}" >/dev/null \
    || die "kubectl context ${ctx} missing — run bootstrap/k3d-cluster.sh"

  if kubectl cluster-info >/dev/null 2>&1; then
    return 0
  fi

  local server
  server="$(kubectl config view --raw \
    -o jsonpath="{.clusters[?(@.name==\"${cluster}\")].cluster.server}")"
  if [[ -n "${server}" ]] && curl -sk --max-time 5 "https://127.0.0.1:16443/readyz" >/dev/null 2>&1; then
    warn "kubectl API unreachable at ${server}; patching cluster server to https://127.0.0.1:16443"
    kubectl config set-cluster "${cluster}" --server=https://127.0.0.1:16443
  fi
  kubectl cluster-info >/dev/null 2>&1 \
    || die "Kubernetes API not reachable — run bootstrap/k3d-cluster.sh"
}

cluster_secret_store_ready() {
  local status reason message
  if ! kubectl get clustersecretstore vault-backend >/dev/null 2>&1; then
    die "ClusterSecretStore vault-backend missing — run bootstrap/vault-k8s-auth.sh"
  fi
  status="$(kubectl get clustersecretstore vault-backend \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
  reason="$(kubectl get clustersecretstore vault-backend \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].reason}' 2>/dev/null || true)"
  message="$(kubectl get clustersecretstore vault-backend \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].message}' 2>/dev/null || true)"
  if [[ "${status}" != "True" ]]; then
    die "ClusterSecretStore vault-backend not Ready (reason=${reason:-unknown}, message=${message:-none}) — run: ./bootstrap/vault-k8s-auth.sh"
  fi
  log "ClusterSecretStore vault-backend Ready"
}

check_eso_controller() {
  if ! kubectl get deployment external-secrets -n eso-system >/dev/null 2>&1; then
    die "ESO deployment external-secrets missing in eso-system — run bootstrap/k8s-primitives.sh"
  fi
  if ! kubectl rollout status deployment/external-secrets -n eso-system --timeout=30s >/dev/null 2>&1; then
    die "ESO deployment external-secrets not ready — check: kubectl get pods -n eso-system"
  fi
  log "External Secrets Operator deployment ready"
}

# Fail when any ExternalSecret in app namespaces is not synced (e.g. smoke-api).
check_app_externalsecrets() {
  local ns failures=()
  for ns in "${APP_NAMESPACES[@]}"; do
    kubectl get namespace "${ns}" >/dev/null 2>&1 || continue
    while IFS= read -r line; do
      [[ -z "${line}" ]] && continue
      failures+=("${line}")
    done < <(kubectl get externalsecret -n "${ns}" -o json 2>/dev/null | jq -r '
      .items[] |
      select(
        ([.status.conditions[]? | select(.type == "Ready" and .status == "True")] | length) == 0
      ) |
      "\(.metadata.namespace)/\(.metadata.name): \(
        [.status.conditions[]? | select(.type == "Ready") | .reason] | join(",")
      )"
    ' 2>/dev/null || true)
  done
  if [[ ${#failures[@]} -gt 0 ]]; then
    die "ExternalSecret(s) not synced (Vault→K8s Secret pipeline broken):
$(printf '  - %s\n' "${failures[@]}")
Fix: ./bootstrap/vault-k8s-auth.sh then verify: kubectl describe externalsecret -n <ns> <name>"
  fi
  log "ExternalSecrets in ${APP_NAMESPACES[*]} are synced (or none present)"
}

# Pods referencing a Secret via envFrom fail with CreateContainerConfigError when ESO has not materialised it.
check_pods_missing_secrets() {
  local ns failures=()
  for ns in "${APP_NAMESPACES[@]}"; do
    kubectl get namespace "${ns}" >/dev/null 2>&1 || continue
    while IFS= read -r line; do
      [[ -z "${line}" ]] && continue
      failures+=("${line}")
    done < <(kubectl get pods -n "${ns}" -o json 2>/dev/null | jq -r '
      .items[] | . as $p |
      (
        [.status.containerStatuses[]?.state.waiting? |
          select(.reason == "CreateContainerConfigError") | .message] +
        [.status.initContainerStatuses[]?.state.waiting? |
          select(.reason == "CreateContainerConfigError") | .message]
      )[] |
      select(test("secret .+ not found"; "i")) |
      "\($p.metadata.namespace)/\($p.metadata.name): \(.)"
    ' 2>/dev/null || true)
  done
  if [[ ${#failures[@]} -gt 0 ]]; then
    die "Pod(s) blocked by missing Secret (usually ESO/Vault):
$(printf '  - %s\n' "${failures[@]}")
Fix: ./bootstrap/vault-k8s-auth.sh and confirm ExternalSecret Ready, then rollout restart the Deployment"
  fi
  log "No pods blocked by missing Secrets in ${APP_NAMESPACES[*]}"
}

# End-to-end: Vault write → ExternalSecret → K8s Secret (requires VAULT_ROOT_TOKEN in .env).
probe_vault_eso_sync() {
  local smoke_path="projects/_smoketest/dev"
  local ready foo_val

  if [[ -z "${VAULT_ROOT_TOKEN:-}" ]]; then
    log "VAULT_ROOT_TOKEN unset — skipping live Vault→ESO sync probe (ClusterSecretStore check still ran)"
    return 0
  fi

  if ! docker ps --format '{{.Names}}' | grep -qx "${VAULT_CONTAINER}"; then
    warn "Vault container ${VAULT_CONTAINER} not running — skipping Vault→ESO sync probe"
    return 0
  fi

  log "Probing Vault→ESO→K8s Secret sync (${smoke_path})..."
  docker exec \
    -e VAULT_TOKEN="${VAULT_ROOT_TOKEN}" \
    -e VAULT_ADDR=http://localhost:8200 \
    "${VAULT_CONTAINER}" \
    vault kv put "secret/${smoke_path}" foo=bar >/dev/null

  kubectl apply -f "${SCRIPT_DIR}/k8s/smoketest-external-secret.yaml" >/dev/null
  for _ in $(seq 1 20); do
    ready="$(kubectl get externalsecret smoketest-secret -n dev \
      -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
    [[ "${ready}" == "True" ]] && break
    sleep 2
  done

  foo_val="$(kubectl get secret smoketest-secret -n dev \
    -o jsonpath='{.data.foo}' 2>/dev/null | base64 -d 2>/dev/null || true)"

  kubectl delete externalsecret smoketest-secret -n dev --ignore-not-found >/dev/null
  kubectl delete secret smoketest-secret -n dev --ignore-not-found >/dev/null
  docker exec \
    -e VAULT_TOKEN="${VAULT_ROOT_TOKEN}" \
    -e VAULT_ADDR=http://localhost:8200 \
    "${VAULT_CONTAINER}" \
    vault kv metadata delete -mount=secret "${smoke_path}" >/dev/null 2>&1 || true

  if [[ "${foo_val}" != "bar" ]]; then
    die "Vault→ESO sync probe failed (expected secret key foo=bar, got '${foo_val}') — run: ./bootstrap/vault-k8s-auth.sh"
  fi
  log "Vault→ESO→K8s Secret sync probe OK"
}

check_postgres_headroom() {
  local max used pct

  if ! docker ps --format '{{.Names}}' | grep -qx postgres; then
    log "postgres container not running — skipping connection headroom check"
    return 0
  fi

  if [[ -z "${POSTGRES_ADMIN_USER:-}" || -z "${POSTGRES_ADMIN_PASSWORD:-}" ]]; then
    log "POSTGRES_ADMIN_* unset — skipping connection headroom check"
    return 0
  fi

  max="$(docker exec -e PGPASSWORD="${POSTGRES_ADMIN_PASSWORD}" postgres \
    psql -U "${POSTGRES_ADMIN_USER}" -d postgres -tAc "SHOW max_connections;" 2>/dev/null | tr -d '\r\n ')"
  used="$(docker exec -e PGPASSWORD="${POSTGRES_ADMIN_PASSWORD}" postgres \
    psql -U "${POSTGRES_ADMIN_USER}" -d postgres -tAc "SELECT count(*)::int FROM pg_stat_activity;" 2>/dev/null | tr -d '\r\n ')"
  [[ -n "${max}" && -n "${used}" && "${max}" =~ ^[0-9]+$ && "${used}" =~ ^[0-9]+$ ]] \
    || { warn "Could not read Postgres connection stats — skipping headroom check"; return 0; }

  pct=$(( used * 100 / max ))
  log "Postgres connections: ${used}/${max} (${pct}%)"
  if (( pct >= POSTGRES_MAX_UTIL_PCT )); then
    die "Postgres connection utilisation ${pct}% (>= ${POSTGRES_MAX_UTIL_PCT}%) — registry/GitLab may return 500; raise POSTGRES_MAX_CONNECTIONS in .env and restart postgres"
  fi
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
log "Checking Docker daemon..."
docker info >/dev/null 2>&1 || die "Docker not available"

if [[ -f "${ROOT}/.env" ]]; then
  # shellcheck source=lib/load-env.sh
  source "${SCRIPT_DIR}/lib/load-env.sh"
  load_dotenv "${ROOT}/.env"
fi

log "Checking k3d cluster context k3d-${K3D_CLUSTER_NAME}..."
ensure_kubectl_api

log "Checking kube-system / Traefik deployment (helm release name: traefik)..."
kubectl get deployment traefik -n kube-system >/dev/null 2>&1 \
  || die "Deployment traefik not found in kube-system — run bootstrap/k8s-primitives.sh"

log "Checking External Secrets Operator CRD..."
kubectl get crd externalsecrets.external-secrets.io >/dev/null 2>&1 \
  || die "ESO CRD missing — run bootstrap/k8s-primitives.sh"

check_eso_controller
cluster_secret_store_ready
probe_vault_eso_sync
check_app_externalsecrets
check_pods_missing_secrets
check_postgres_headroom

log "Checking Management API on http://127.0.0.1:${API_LOCAL_PORT}/health ..."
if curl -sf "http://127.0.0.1:${API_LOCAL_PORT}/health" | grep -q '"status"'; then
  log "Management API /health OK"
else
  die "Management API /health failed — is the api container up?"
fi

if docker compose ps sonarqube 2>/dev/null | grep -qE 'sonarqube'; then
  log "Checking SonarQube on devops-network..."
  if docker run --rm --network devops-network curlimages/curl:8.12.1 -sf \
    http://sonarqube:9000/api/system/status | grep -q '"status":"UP"'; then
    log "SonarQube /api/system/status UP"
  else
    die "SonarQube health check failed — run: ./bootstrap/checks/wait-sonarqube.sh"
  fi
else
  log "sonarqube service not in compose project — skipping Sonar check"
fi

log "All smoke checks passed."
