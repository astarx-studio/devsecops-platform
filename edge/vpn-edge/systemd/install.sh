#!/usr/bin/env bash
# Installs vpn-edge-nat.service on the edge VM (run from edge, not Windows).
# Usage: sudo ./install.sh
# After install, edit /etc/default/vpn-edge-nat with real paths, then:
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now wg-quick@wg0.service vpn-edge-nat.service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

install -m 644 "${SCRIPT_DIR}/vpn-edge-nat.service" /etc/systemd/system/vpn-edge-nat.service

if [[ ! -f /etc/default/vpn-edge-nat ]]; then
  install -m 644 "${SCRIPT_DIR}/vpn-edge-nat.default.sample" /etc/default/vpn-edge-nat
  echo "[INFO] Created /etc/default/vpn-edge-nat — edit VPN_EDGE_* paths, then:"
else
  echo "[INFO] /etc/default/vpn-edge-nat already exists — not overwriting."
fi

systemctl daemon-reload
echo "[INFO] Next: edit /etc/default/vpn-edge-nat, then:"
echo "       systemctl enable --now wg-quick@wg0.service vpn-edge-nat.service"
