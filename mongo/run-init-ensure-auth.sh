#!/bin/sh
# One-shot: create Mongo users, then flag volume for mongod --auth on next start.
set -eu

: "${MONGO_ADMIN_USER:?MONGO_ADMIN_USER required}"
: "${MONGO_ADMIN_PASSWORD:?MONGO_ADMIN_PASSWORD required}"
: "${MONGO_APP_USER:?MONGO_APP_USER required}"
: "${MONGO_APP_PASSWORD:?MONGO_APP_PASSWORD required}"

mongosh_ping() {
  if [ -f /data/db/.auth-enabled ]; then
    mongosh --host mongo --quiet \
      --username "${MONGO_ADMIN_USER}" \
      --password "${MONGO_ADMIN_PASSWORD}" \
      --authenticationDatabase admin \
      --eval "db.adminCommand('ping')" "$@"
  else
    mongosh --host mongo --quiet --eval "db.adminCommand('ping')" "$@"
  fi
}

mongosh_run() {
  if [ -f /data/db/.auth-enabled ]; then
    mongosh --host mongo --quiet \
      --username "${MONGO_ADMIN_USER}" \
      --password "${MONGO_ADMIN_PASSWORD}" \
      --authenticationDatabase admin \
      "$@"
  else
    mongosh --host mongo --quiet "$@"
  fi
}

echo "[INFO] Waiting for MongoDB at mongo:27017..."
until mongosh_ping >/dev/null 2>&1; do
  sleep 2
done

if [ -f /data/db/.auth-enabled ]; then
  echo "[INFO] MongoDB auth already enabled; ensuring users exist..."
  mongosh_run --file /scripts/init-ensure-auth.js
  echo "[INFO] MongoDB users verified."
  exit 0
fi

mongosh_run --file /scripts/init-ensure-auth.js

echo "enabled" > /data/db/.auth-enabled
echo "[INFO] Restarting mongod to enable --auth..."
mongosh_run --eval 'db.adminCommand({ shutdown: 1 })' >/dev/null 2>&1 || true
sleep 3

echo "[INFO] MongoDB users ready."
