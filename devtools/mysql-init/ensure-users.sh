#!/bin/sh
# Idempotent MySQL bootstrap for shared DevTools:
# - wait for server
# - ensure admin (full privileges) and esa_dev (esa_dev DB)
# - create logical DB esa_dev
set -eu

log() { echo "[devtools-mysql-init] $*"; }
die() { echo "[devtools-mysql-init] ERROR $*" >&2; exit 1; }

: "${MYSQL_ROOT_PASSWORD:?}"
: "${DEVTOOLS_MYSQL_ADMIN_USER:?}"
: "${DEVTOOLS_MYSQL_ADMIN_PASSWORD:?}"
: "${DEVTOOLS_MYSQL_ESA_USER:?}"
: "${DEVTOOLS_MYSQL_ESA_PASSWORD:?}"
MYSQL_HOST="${MYSQL_HOST:-devtools-mysql}"
MYSQL_DATABASE="${MYSQL_DATABASE:-devtools}"
ESA_DB="${DEVTOOLS_MYSQL_ESA_DB:-esa_dev}"

mysql_exec() {
  mysql --protocol=TCP -h"${MYSQL_HOST}" -uroot -p"${MYSQL_ROOT_PASSWORD}" \
    --connect-timeout=5 --batch --raw "$@"
}

sql_escape() {
  printf '%s' "$1" | sed "s/'/''/g"
}

log "Waiting for MySQL at ${MYSQL_HOST}:3306..."
i=0
until mysql_exec -e "SELECT 1" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    die "MySQL not ready after ${i} attempts"
  fi
  sleep 2
done
log "MySQL ready."

ADMIN_ESC="$(sql_escape "${DEVTOOLS_MYSQL_ADMIN_PASSWORD}")"
ESA_ESC="$(sql_escape "${DEVTOOLS_MYSQL_ESA_PASSWORD}")"
SQL_FILE="$(mktemp)"
trap 'rm -f "${SQL_FILE}"' EXIT

# printf (not a double-quoted heredoc) so '$' in passwords is not expanded.
{
  printf "CREATE DATABASE IF NOT EXISTS \`%s\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n" \
    "${MYSQL_DATABASE}"
  printf "CREATE DATABASE IF NOT EXISTS \`%s\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n" \
    "${ESA_DB}"

  printf "CREATE USER IF NOT EXISTS '%s'@'%%' IDENTIFIED BY '%s';\n" \
    "${DEVTOOLS_MYSQL_ADMIN_USER}" "${ADMIN_ESC}"
  printf "ALTER USER '%s'@'%%' IDENTIFIED BY '%s';\n" \
    "${DEVTOOLS_MYSQL_ADMIN_USER}" "${ADMIN_ESC}"
  printf "GRANT ALL PRIVILEGES ON *.* TO '%s'@'%%' WITH GRANT OPTION;\n" \
    "${DEVTOOLS_MYSQL_ADMIN_USER}"

  printf "CREATE USER IF NOT EXISTS '%s'@'%%' IDENTIFIED BY '%s';\n" \
    "${DEVTOOLS_MYSQL_ESA_USER}" "${ESA_ESC}"
  printf "ALTER USER '%s'@'%%' IDENTIFIED BY '%s';\n" \
    "${DEVTOOLS_MYSQL_ESA_USER}" "${ESA_ESC}"
  printf "GRANT ALL PRIVILEGES ON \`%s\`.* TO '%s'@'%%';\n" \
    "${ESA_DB}" "${DEVTOOLS_MYSQL_ESA_USER}"

  printf "FLUSH PRIVILEGES;\n"
  printf "SELECT user, host FROM mysql.user WHERE user IN ('%s','%s') ORDER BY user;\n" \
    "${DEVTOOLS_MYSQL_ADMIN_USER}" "${DEVTOOLS_MYSQL_ESA_USER}"
} > "${SQL_FILE}"

log "Ensuring users '${DEVTOOLS_MYSQL_ADMIN_USER}' (ALL) and '${DEVTOOLS_MYSQL_ESA_USER}' (${ESA_DB}.*)."
mysql_exec < "${SQL_FILE}"
log "Done."
