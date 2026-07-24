#!/bin/sh
# Idempotent: create vhosts dev/stg and grant admin full permissions via
# the Management HTTP API. Run after rabbitmq is healthy (compose init service).
#
# Env: RMQ_USER, RMQ_PASS, RMQ_HOST (default devtools-rabbitmq), RMQ_MGMT_PORT (15672)
set -eu

RMQ_HOST="${RMQ_HOST:-devtools-rabbitmq}"
RMQ_MGMT_PORT="${RMQ_MGMT_PORT:-15672}"
BASE="http://${RMQ_HOST}:${RMQ_MGMT_PORT}/api"

: "${RMQ_USER:?RMQ_USER required}"
: "${RMQ_PASS:?RMQ_PASS required}"

echo "devtools-rabbitmq-init: ensuring vhosts on ${BASE} as user ${RMQ_USER}..."

for vh in dev stg; do
  echo "devtools-rabbitmq-init: PUT vhost ${vh}"
  curl -sf -u "${RMQ_USER}:${RMQ_PASS}" -X PUT "${BASE}/vhosts/${vh}"
  echo "devtools-rabbitmq-init: PUT permissions ${vh}/${RMQ_USER}"
  curl -sf -u "${RMQ_USER}:${RMQ_PASS}" -X PUT \
    -H 'content-type: application/json' \
    -d '{"configure":".*","write":".*","read":".*"}' \
    "${BASE}/permissions/${vh}/${RMQ_USER}"
done

echo "devtools-rabbitmq-init: vhosts dev/stg ready"
