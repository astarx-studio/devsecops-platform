#!/bin/sh
# Enables --auth after mongo-init creates users and touches /data/db/.auth-enabled.
set -eu

if [ -f /data/db/.auth-enabled ]; then
  echo "[mongo] Authentication enabled (.auth-enabled present)"
  exec mongod --auth --bind_ip_all "$@"
fi

echo "[mongo] Running without --auth until mongo-init completes"
exec mongod --bind_ip_all "$@"
