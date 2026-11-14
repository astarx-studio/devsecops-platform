#!/usr/bin/env bash
# =============================================================================
# gitlab/test/canary.sh: prove a built platform GitLab image works BEFORE it
# replaces production.
#
# Boots the image as a throwaway container with its own embedded PostgreSQL and
# Redis, anonymous volumes, no published ports and no Traefik labels. It shares
# nothing with the production stack. Then it runs:
#   1. contract.rb  - seams/shape checks (same script is safe in production)
#   2. e2e.rb       - full approval scenario on scratch data
# and always removes the container afterwards.
#
# Usage:  gitlab/test/canary.sh <image>         e.g. dsoaas-gitlab:19.5.3-ce.0
# Env:    CANARY_TIMEOUT=<s>  boot timeout (default 1200)
#         KEEP_CANARY=1       leave the container running for debugging
#         CANARY_PORT=<port>  also publish the UI on http://127.0.0.1:<port> (local only),
#                             for checking the plugin UI in a browser
# Needs ~4 GB free RAM while it runs.
# =============================================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: don't rewrite /opt/... paths

IMAGE="${1:?usage: canary.sh <image>}"
NAME="dsoaas-gitlab-canary"
TIMEOUT="${CANARY_TIMEOUT:-1200}"

log() { echo "[canary] $*"; }
die() { echo "[canary] ERROR $*" >&2; exit 1; }

cleanup() {
  if [[ "${KEEP_CANARY:-0}" == "1" ]]; then
    log "KEEP_CANARY=1, leaving ${NAME} running (docker rm -fv ${NAME} when done)"
  else
    docker rm -fv "${NAME}" >/dev/null 2>&1 || true
  fi
}

docker rm -fv "${NAME}" >/dev/null 2>&1 || true
trap cleanup EXIT

PLUGIN_DB_URL='postgresql://gitlab@/dsoaas_gitlab_plugins?host=/var/opt/gitlab/postgresql'

EXTERNAL_URL="http://${NAME}"
PORT_ARGS=()
if [[ -n "${CANARY_PORT:-}" ]]; then
  EXTERNAL_URL="http://127.0.0.1:${CANARY_PORT}"
  PORT_ARGS=(-p "127.0.0.1:${CANARY_PORT}:80")
fi

log "Starting ${IMAGE} as ${NAME}..."
docker run -d --name "${NAME}" --hostname "${NAME}" --shm-size 256m ${PORT_ARGS[@]+"${PORT_ARGS[@]}"} \
  -e DSOAAS_CANARY=1 \
  -e GITLAB_OMNIBUS_CONFIG="
external_url '${EXTERNAL_URL}'
nginx['listen_port'] = 80
prometheus_monitoring['enable'] = false
registry['enable'] = false
gitlab_pages['enable'] = false
gitlab_kas['enable'] = false
puma['workers'] = 0
sidekiq['concurrency'] = 5
gitlab_rails['env'] = { 'DSOAAS_CANARY' => '1', 'DSOAAS_PLUGINS_DB_URL' => '${PLUGIN_DB_URL}' }
" \
  "${IMAGE}" >/dev/null

log "Waiting for GitLab to become healthy (up to ${TIMEOUT}s)..."
start=$(date +%s)
while :; do
  state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${NAME}" 2>/dev/null || echo gone)"
  [[ "${state}" == "healthy" ]] && break
  [[ "${state}" == "gone" || "${state}" == "exited" ]] && { docker logs --tail 80 "${NAME}" || true; die "canary container stopped"; }
  (( $(date +%s) - start > TIMEOUT )) && { docker logs --tail 80 "${NAME}" || true; die "canary not healthy after ${TIMEOUT}s"; }
  sleep 15
done
log "Healthy after $(( $(date +%s) - start ))s; waiting for all readiness probes (Puma, Gitaly, Redis, DB)..."
until docker exec "${NAME}" curl -sf -o /dev/null 'http://localhost/-/readiness?all=1'; do
  (( $(date +%s) - start > TIMEOUT )) && die "canary not ready after ${TIMEOUT}s"
  sleep 10
done
sleep 30 # let Puma finish warming up so git pushes through the internal API don't hit a 502
log "Ready after $(( $(date +%s) - start ))s."

# Separate plugin database inside the canary's embedded PostgreSQL. Created only
# now, after boot, which also proves the plugin connects lazily (no DB needed at boot).
docker exec "${NAME}" gitlab-psql -d postgres -c 'CREATE DATABASE dsoaas_gitlab_plugins OWNER gitlab' >/dev/null

# $1: output file inside the container. Prints the dump's md5.
# --restrict-key pins the otherwise random \restrict token newer pg_dump emits.
schema_digest() {
  docker exec "${NAME}" sh -c \
    "/opt/gitlab/embedded/bin/chpst -u gitlab-psql /opt/gitlab/embedded/bin/pg_dump --schema-only --restrict-key=dsoaascanary -h /var/opt/gitlab/postgresql -d gitlabhq_production | grep -v '^--' > $1 && md5sum < $1"
}

log "Snapshotting GitLab's own schema..."
before="$(schema_digest /tmp/schema-before.sql)"

log "Running contract tests..."
docker exec "${NAME}" gitlab-rails runner /opt/dsoaas/test/contract.rb

log "Running end-to-end approval scenario..."
docker exec "${NAME}" gitlab-rails runner /opt/dsoaas/test/e2e.rb

log "Checking GitLab's schema is unchanged..."
after="$(schema_digest /tmp/schema-after.sql)"
if [[ -z "${before}" || "${before}" != "${after}" ]]; then
  docker exec "${NAME}" diff /tmp/schema-before.sql /tmp/schema-after.sql | head -60 || true
  die "gitlabhq_production schema changed while plugins ran"
fi

log "CANARY PASSED for ${IMAGE}"
