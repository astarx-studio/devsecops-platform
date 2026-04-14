# ==========================================================================
# HashiCorp Vault — Server Configuration (Production Mode)
# ==========================================================================
# Used when running Vault in production mode:
#   command: server -config=/vault/config/config.hcl
#
# In dev mode (default), this file is mounted but not actively used.
# To switch to production mode:
#   1. Change docker-compose command to: server -config=/vault/prod-config/config.hcl
#   2. Remove VAULT_DEV_ROOT_TOKEN_ID from environment
#   3. Initialize and unseal Vault manually:
#        vault operator init
#        vault operator unseal <key>
# ==========================================================================

storage "file" {
  path = "/vault/data"
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
