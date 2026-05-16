#!/bin/sh
# Post-deploy checks for SonarQube stack replicability (run from repo root).
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "[FAIL] .env missing — copy from sample.env"
  exit 1
fi

# Read .env without sourcing (values may contain spaces/special chars).
env_val() {
  grep -E "^${1}=" .env | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//'
}

fail() {
  echo "[FAIL] $1"
  exit 1
}

ok() {
  echo "[OK] $1"
}

SONARQUBE_DOMAIN="$(env_val SONARQUBE_DOMAIN)"
SONARQUBE_EXTERNAL_URL="$(env_val SONARQUBE_EXTERNAL_URL)"
SONAR_DB_NAME="$(env_val SONAR_DB_NAME)"
SONAR_DB_USER="$(env_val SONAR_DB_USER)"
SONAR_DB_PASSWORD="$(env_val SONAR_DB_PASSWORD)"
SONAR_ADMIN_PASSWORD="$(env_val SONAR_ADMIN_PASSWORD)"

for var in SONARQUBE_DOMAIN SONARQUBE_EXTERNAL_URL SONAR_DB_NAME SONAR_DB_USER \
  SONAR_DB_PASSWORD SONAR_ADMIN_PASSWORD; do
  eval "val=\$$var"
  [ -n "${val}" ] || fail "${var} is empty in .env"
done

case "${SONARQUBE_EXTERNAL_URL}" in
  "https://${SONARQUBE_DOMAIN}" | "https://${SONARQUBE_DOMAIN}/") ;;
  *) fail "SONARQUBE_EXTERNAL_URL must be https://${SONARQUBE_DOMAIN}" ;;
esac
ok "SONARQUBE_* env consistency"

props=".vols/sonarqube/conf/sonar.properties"
[ -f "${props}" ] || fail "${props} missing — run: docker compose up sonarqube-config-init"
grep -q 'sonar.auth.saml.enabled=true' "${props}" || fail "SAML not enabled in ${props}"
grep -q 'sonar.auth.saml.user.name=login' "${props}" || fail "SAML user.name must be login in ${props}"
ok "Generated sonar.properties"

if docker compose ps sonarqube 2>/dev/null | grep -q '(healthy)'; then
  ok "sonarqube container healthy"
else
  echo "[WARN] sonarqube not healthy — skip container checks"
  exit 0
fi

if docker compose ps -a sonarqube-init 2>/dev/null | grep -qE 'Exited \(0\)'; then
  ok "sonarqube-init completed successfully"
else
  echo "[WARN] sonarqube-init missing or failed — run: docker compose run --rm sonarqube-init"
fi

echo "[DONE] SonarQube setup verification finished."
