#!/usr/bin/env bash
# GCP instance metadata startup-script for the VPN edge VM.
#
# Defense-in-depth after custom-image boot / reinstantiation:
#   - ensure wireguard + nftables packages
#   - ensure IP forwarding
#   - install/enable systemd units from ~/vpn-edge/systemd if present
#   - re-apply NAT if vpn-edge-nat is not active
#
# Does NOT embed secrets (WireGuard keys live in /etc/wireguard/wg0.conf from the
# custom image, or are restored manually from home .vols/wireguard/peer_edge/).
#
# Primary operator docs: __DOCS__/99_maintainers/10_gcp_edge_template.md
set -euo pipefail

log() { printf '[vpn-edge-startup][INFO] %s\n' "$*"; }
warn() { printf '[vpn-edge-startup][WARN] %s\n' "$*" >&2; }

EDGE_USER="${VPN_EDGE_USER:-iam_msams}"
VPN_EDGE_DIR="/home/${EDGE_USER}/vpn-edge"
APPLY_SCRIPT="${VPN_EDGE_DIR}/apply-nat.sh"
ENV_FILE="${VPN_EDGE_DIR}/forward-ports.env"
SYSTEMD_DIR="${VPN_EDGE_DIR}/systemd"

export DEBIAN_FRONTEND=noninteractive

if command -v apt-get >/dev/null 2>&1; then
  log "Ensuring wireguard + nftables packages..."
  apt-get update -qq
  apt-get install -y -qq wireguard wireguard-tools nftables iproute2 >/dev/null
fi

if [[ -f "${VPN_EDGE_DIR}/sysctl-ip-forward.conf" ]]; then
  install -m 644 "${VPN_EDGE_DIR}/sysctl-ip-forward.conf" \
    /etc/sysctl.d/99-vpn-edge-ip-forward.conf
  sysctl --system >/dev/null 2>&1 || sysctl -w net.ipv4.ip_forward=1 >/dev/null
else
  sysctl -w net.ipv4.ip_forward=1 >/dev/null
fi

if [[ -d "${SYSTEMD_DIR}" ]]; then
  if [[ ! -f /etc/systemd/system/vpn-edge-nat.service ]]; then
    log "Installing vpn-edge-nat.service from ${SYSTEMD_DIR}"
    bash "${SYSTEMD_DIR}/install.sh"
  fi
  if [[ ! -f /etc/default/vpn-edge-nat ]]; then
    cat >/etc/default/vpn-edge-nat <<EOF
VPN_EDGE_APPLY_SCRIPT=${APPLY_SCRIPT}
VPN_EDGE_ENV_FILE=${ENV_FILE}
EOF
    log "Wrote /etc/default/vpn-edge-nat"
  fi
  systemctl daemon-reload
fi

if [[ -f /etc/wireguard/wg0.conf ]]; then
  systemctl enable wg-quick@wg0.service >/dev/null 2>&1 || true
  systemctl start wg-quick@wg0.service || warn "wg-quick@wg0 failed to start"
else
  warn "/etc/wireguard/wg0.conf missing — restore from home peer_edge.conf"
fi

systemctl enable vpn-edge-nat.service >/dev/null 2>&1 || true

if systemctl is-active --quiet vpn-edge-nat.service; then
  log "vpn-edge-nat already active"
elif [[ -x "${APPLY_SCRIPT}" && -f "${ENV_FILE}" ]]; then
  log "Applying NAT via ${APPLY_SCRIPT}"
  systemctl start vpn-edge-nat.service || "${APPLY_SCRIPT}" apply "${ENV_FILE}"
else
  warn "Cannot apply NAT — missing ${APPLY_SCRIPT} or ${ENV_FILE}"
fi

log "Startup complete"
