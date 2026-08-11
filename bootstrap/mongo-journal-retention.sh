#!/usr/bin/env bash
# =============================================================================
# mongo-journal-retention.sh — bound / reclaim WiredTiger journal
# =============================================================================
# Optional maintainer script (not part of greenfield bootstrap).
#
# WiredTigerLog.* is a sequential WAL. You cannot delete "old" files while
# mongod is running, and you cannot keep the last N of a dirty sequence.
# After a clean stop, all journal files are obsolete — wipe the directory.
#
# Live data is the named volume dsoaas-mongo-data (not .vols/mongo).
# This script inspects /data/db/journal via the mongo container.
#
# Thresholds: if file count > KEEP_N or any log is older than DAYS → reclaim.
#
# Usage:
#   ./bootstrap/mongo-journal-retention.sh            # report; exit 1 if over limit
#   ./bootstrap/mongo-journal-retention.sh --dry-run  # same, never stop mongo
#   ./bootstrap/mongo-journal-retention.sh --apply    # clean-stop, wipe journal, start
#
# See __DOCS__/01_infra/04_operations.md (Mongo WiredTiger journal).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

KEEP_N="${MONGO_JOURNAL_KEEP_N:-100}"
DAYS="${MONGO_JOURNAL_MAX_DAYS:-7}"
STOP_TIMEOUT="${MONGO_JOURNAL_STOP_TIMEOUT:-300}"

APPLY=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

log() { echo "[mongo-journal-retention] $*" >&2; }

if ! docker inspect mongo >/dev/null 2>&1; then
  log "mongo container missing"
  exit 0
fi

# Busybox/mongo image: count logs and size from inside the data volume.
COUNT="$(docker exec mongo sh -c 'ls /data/db/journal/WiredTigerLog.* 2>/dev/null | wc -l' | tr -d ' ')"
SIZE="$(docker exec mongo sh -c 'du -sh /data/db/journal 2>/dev/null | awk "{print \$1}"')"
OLD="$(docker exec mongo sh -c "
  cutoff=\$(( \$(date +%s) - ${DAYS} * 86400 ))
  n=0
  for f in /data/db/journal/WiredTigerLog.*; do
    [ -f \"\$f\" ] || continue
    mt=\$(stat -c %Y \"\$f\" 2>/dev/null || echo 0)
    if [ \"\$mt\" -lt \"\$cutoff\" ]; then n=\$((n+1)); fi
  done
  echo \$n
" | tr -d ' ')"

OVER=0
if [[ "${COUNT}" -gt "${KEEP_N}" || "${OLD}" -gt 0 ]]; then
  OVER=1
fi

log "journal=/data/db/journal (dsoaas-mongo-data) files=${COUNT} size=${SIZE} older_than_${DAYS}d=${OLD} keep_n=${KEEP_N}"
if [[ "${OVER}" -eq 1 ]]; then
  log "OVER LIMIT (max ${KEEP_N} files, or any file older than ${DAYS}d)"
else
  log "within limits"
fi

if [[ "${APPLY}" -eq 0 ]]; then
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    log "DRY-RUN: would clean-stop mongo, delete WiredTigerLog.*, start mongo"
  else
    log "reclaim: ./bootstrap/mongo-journal-retention.sh --apply"
  fi
  exit "${OVER}"
fi

if [[ "${DRY_RUN}" -eq 1 ]]; then
  log "--apply and --dry-run are mutually exclusive" >&2
  exit 2
fi

log "clean-stop mongo (timeout ${STOP_TIMEOUT}s) — API will be down briefly"
docker compose stop -t "${STOP_TIMEOUT}" mongo

for _ in $(seq 1 60); do
  if ! docker inspect -f '{{.State.Running}}' mongo 2>/dev/null | grep -qx true; then
    break
  fi
  sleep 2
done
if docker inspect -f '{{.State.Running}}' mongo 2>/dev/null | grep -qx true; then
  log "mongo still running after stop — abort (will not delete journal)" >&2
  exit 1
fi

LOCK_SIZE="$(docker run --rm --volumes-from mongo alpine:3.20 sh -c 'wc -c < /data/db/mongod.lock' | tr -d ' ')"
if [[ -n "${LOCK_SIZE}" && "${LOCK_SIZE}" -gt 0 ]]; then
  log "mongod.lock is non-empty after stop — unclean shutdown, abort" >&2
  exit 1
fi

log "deleting WiredTigerLog.* / WiredTigerPreplog.* on data volume"
docker run --rm --volumes-from mongo alpine:3.20 sh -c \
  'rm -f /data/db/journal/WiredTigerLog.* /data/db/journal/WiredTigerPreplog.*'
LEFT="$(docker run --rm --volumes-from mongo alpine:3.20 sh -c \
  'ls /data/db/journal/WiredTigerLog.* 2>/dev/null | wc -l' | tr -d ' ')"
log "journal files remaining=${LEFT}"

log "starting mongo"
docker compose up -d --no-deps --force-recreate mongo

ok=0
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' mongo 2>/dev/null || true)"
  if [[ "${status}" == "healthy" ]]; then
    ok=1
    break
  fi
  sleep 2
done
if [[ "${ok}" -ne 1 ]]; then
  log "mongo did not become healthy — check: docker logs mongo" >&2
  exit 1
fi

NEW_COUNT="$(docker exec mongo sh -c 'ls /data/db/journal/WiredTigerLog.* 2>/dev/null | wc -l' | tr -d ' ')"
NEW_SIZE="$(docker exec mongo sh -c 'du -sh /data/db/journal 2>/dev/null | awk "{print \$1}"')"
log "done. journal files=${NEW_COUNT} size=${NEW_SIZE}"
