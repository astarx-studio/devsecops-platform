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

# AI MR reviewer: vhost ai-review. The worker owns ai-review.* queues; n8n may
# only read (and declare) ai-review.results. Skipped when the passwords are unset.
if [ -n "${AI_REVIEW_RMQ_PASSWORD:-}" ] && [ -n "${AI_REVIEW_RMQ_N8N_PASSWORD:-}" ]; then
  vh="ai-review"
  echo "devtools-rabbitmq-init: PUT vhost ${vh}"
  curl -sf -u "${RMQ_USER}:${RMQ_PASS}" -X PUT "${BASE}/vhosts/${vh}"
  curl -sf -u "${RMQ_USER}:${RMQ_PASS}" -X PUT -H 'content-type: application/json' \
    -d '{"configure":".*","write":".*","read":".*"}' "${BASE}/permissions/${vh}/${RMQ_USER}"
  for pair in "ai-review:${AI_REVIEW_RMQ_PASSWORD}" "ai-review-n8n:${AI_REVIEW_RMQ_N8N_PASSWORD}"; do
    u="${pair%%:*}"
    p="${pair#*:}"
    echo "devtools-rabbitmq-init: PUT user ${u}"
    printf '{"password":"%s","tags":""}' "${p}" |
      curl -sf -u "${RMQ_USER}:${RMQ_PASS}" -X PUT -H 'content-type: application/json' -d @- "${BASE}/users/${u}"
  done
  curl -sf -u "${RMQ_USER}:${RMQ_PASS}" -X PUT -H 'content-type: application/json' \
    -d '{"configure":"^ai-review\\..*","write":"^(ai-review\\..*|amq\\.default)$","read":"^ai-review\\..*"}' \
    "${BASE}/permissions/${vh}/ai-review"
  curl -sf -u "${RMQ_USER}:${RMQ_PASS}" -X PUT -H 'content-type: application/json' \
    -d '{"configure":"^ai-review\\.results$","write":"^$","read":"^ai-review\\.results$"}' \
    "${BASE}/permissions/${vh}/ai-review-n8n"
  echo "devtools-rabbitmq-init: vhost ai-review ready"
fi

# Qestor estimator. Its own vhost so it cannot publish into ai-review.jobs.
# The n8n user ai-review-n8n stays read-only on ai-review.results.
# Skipped when the password is unset.
if [ -n "${QESTOR_ESTIMATOR_RMQ_PASSWORD:-}" ]; then
  vh="qestor"
  echo "devtools-rabbitmq-init: PUT vhost ${vh}"
  curl -sf -u "${RMQ_USER}:${RMQ_PASS}" -X PUT "${BASE}/vhosts/${vh}"
  curl -sf -u "${RMQ_USER}:${RMQ_PASS}" -X PUT -H 'content-type: application/json' \
    -d '{"configure":".*","write":".*","read":".*"}' "${BASE}/permissions/${vh}/${RMQ_USER}"
  echo "devtools-rabbitmq-init: PUT user qestor-estimator"
  printf '{"password":"%s","tags":""}' "${QESTOR_ESTIMATOR_RMQ_PASSWORD}" |
    curl -sf -u "${RMQ_USER}:${RMQ_PASS}" -X PUT -H 'content-type: application/json' -d @- "${BASE}/users/qestor-estimator"
  curl -sf -u "${RMQ_USER}:${RMQ_PASS}" -X PUT -H 'content-type: application/json' \
    -d '{"configure":"^qestor-ai-estimate-v2$","write":"^amq\\.default$","read":"^qestor-ai-estimate-v2$"}' \
    "${BASE}/permissions/${vh}/qestor-estimator"
  echo "devtools-rabbitmq-init: PUT queue qestor-ai-estimate-v2"
  curl -sf -u "${RMQ_USER}:${RMQ_PASS}" -X PUT -H 'content-type: application/json' \
    -d '{"durable":true,"auto_delete":false,"arguments":{}}' \
    "${BASE}/queues/${vh}/qestor-ai-estimate-v2"
  echo "devtools-rabbitmq-init: vhost qestor ready"
fi
