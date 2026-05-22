#!/bin/sh
# ==========================================================================
# OpenBao production bootstrap — init, unseal, enable KV v2 (idempotent)
# ==========================================================================
# Writes Shamir unseal keys and init output under VAULT_BOOTSTRAP_DIR (default
# /work, bind-mounted to ./.vols/vault). After first init, copy root_token from
# init.txt into .env as VAULT_ROOT_TOKEN (never commit).
#
# Required env:
#   VAULT_ADDR              OpenBao API (e.g. http://vault:8200)
# Optional:
#   VAULT_BOOTSTRAP_DIR     Default /work
#   VAULT_INIT_KEY_SHARES   Default 5
#   VAULT_INIT_KEY_THRESHOLD Default 3
# ==========================================================================

set -eu

VAULT_ADDR="${VAULT_ADDR:-http://vault:8200}"
export VAULT_ADDR
VAULT_BOOTSTRAP_DIR="${VAULT_BOOTSTRAP_DIR:-/work}"
INIT_RECORD="${VAULT_BOOTSTRAP_DIR}/init.txt"
UNSEAL_KEYS="${VAULT_BOOTSTRAP_DIR}/unseal-keys"
ROOT_TOKEN_FILE="${VAULT_BOOTSTRAP_DIR}/root-token"
KEY_SHARES="${VAULT_INIT_KEY_SHARES:-5}"
KEY_THRESHOLD="${VAULT_INIT_KEY_THRESHOLD:-3}"

log() { echo "[INFO] $*"; }
warn() { echo "[WARN] $*" >&2; }
die() { echo "[ERROR] $*" >&2; exit 1; }

mkdir -p "${VAULT_BOOTSTRAP_DIR}"
chmod 700 "${VAULT_BOOTSTRAP_DIR}" 2>/dev/null || true

log "Waiting for OpenBao API at ${VAULT_ADDR}..."
until wget -qO- "${VAULT_ADDR}/v1/sys/health" >/dev/null 2>&1 \
  || wget -qO- "${VAULT_ADDR}/v1/sys/seal-status" >/dev/null 2>&1; do
  sleep 2
done

initialized() {
  wget -qO- "${VAULT_ADDR}/v1/sys/init" 2>/dev/null | grep -q '"initialized":true'
}

sealed() {
  wget -qO- "${VAULT_ADDR}/v1/sys/seal-status" 2>/dev/null | grep -q '"sealed":true'
}

if ! initialized; then
  log "Cluster not initialized — running operator init (${KEY_SHARES}/${KEY_THRESHOLD})..."
  bao operator init \
    -key-shares="${KEY_SHARES}" \
    -key-threshold="${KEY_THRESHOLD}" > "${INIT_RECORD}" 2>&1
  chmod 600 "${INIT_RECORD}"

  # OpenBao image is busybox-based (no jq); parse standard init text output.
  grep -E 'Unseal Key [0-9]+:' "${INIT_RECORD}" | awk '{print $NF}' > "${UNSEAL_KEYS}"
  awk -F': ' '/Initial Root Token:/ {print $2; exit}' "${INIT_RECORD}" > "${ROOT_TOKEN_FILE}"
  if [ ! -s "${UNSEAL_KEYS}" ] || [ ! -s "${ROOT_TOKEN_FILE}" ]; then
    die "Could not parse operator init output in ${INIT_RECORD}"
  fi
  chmod 600 "${UNSEAL_KEYS}" "${ROOT_TOKEN_FILE}"
  log "Wrote unseal keys to ${UNSEAL_KEYS} and root token to ${ROOT_TOKEN_FILE}"
  warn "Copy root token into .env as VAULT_ROOT_TOKEN, then restart the api service."
else
  log "OpenBao already initialized (skipping operator init)."
fi

if sealed; then
  if [ ! -s "${UNSEAL_KEYS}" ]; then
    die "OpenBao is sealed but ${UNSEAL_KEYS} is missing — restore keys from backup or re-init (destructive)."
  fi
  log "Unsealing OpenBao..."
  n=0
  while sealed; do
    n=$((n + 1))
    key=$(sed -n "${n}p" "${UNSEAL_KEYS}")
    [ -n "${key}" ] || die "Ran out of unseal keys at line ${n} (threshold ${KEY_THRESHOLD})"
    bao operator unseal "${key}" >/dev/null
    log "Applied unseal key ${n}/${KEY_THRESHOLD}"
    if ! sealed; then
      break
    fi
    if [ "${n}" -ge "${KEY_THRESHOLD}" ] && sealed; then
      die "Still sealed after ${KEY_THRESHOLD} keys — check unseal-keys file"
    fi
  done
  log "OpenBao is unsealed."
else
  log "OpenBao already unsealed."
fi

# Root token for KV enable (prefer file from init, else VAULT_TOKEN env)
if [ -s "${ROOT_TOKEN_FILE}" ]; then
  VAULT_TOKEN=$(cat "${ROOT_TOKEN_FILE}")
  export VAULT_TOKEN
elif [ -n "${VAULT_TOKEN:-}" ]; then
  log "Using VAULT_TOKEN from environment for post-unseal setup."
else
  die "Unsealed but no VAULT_TOKEN and no ${ROOT_TOKEN_FILE} — set VAULT_ROOT_TOKEN in .env"
fi

if bao secrets list -format=json 2>/dev/null | grep -q '"secret/"'; then
  log "KV mount secret/ already present."
else
  log "Enabling KV v2 at secret/..."
  bao secrets enable -path=secret kv-v2
fi

log "OpenBao production bootstrap complete."
