# ==========================================================================
# OpenBao — Production server configuration
# ==========================================================================
# Used with: command: server -config=/vault/prod-config/config.hcl
#
# PostgreSQL connection URL is supplied via BAO_PG_CONNECTION_URL in compose
# (see sample.env VAULT_DB_*). TLS for the listener is terminated by Traefik.
#
# First boot: run vault-prod-bootstrap (init, unseal, KV) then vault-oidc-init.
# ==========================================================================

storage "postgresql" {
  # connection_url empty: use PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE from compose.
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = 1
}

api_addr     = "http://0.0.0.0:8200"
cluster_addr = "http://0.0.0.0:8201"

ui = true

default_lease_ttl = "168h"
max_lease_ttl     = "720h"

log_level = "info"
