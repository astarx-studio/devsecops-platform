#!/usr/bin/env bash
# Applies or removes nftables DNAT + SNAT on the edge VM so public TCP ports are
# forwarded over WireGuard to the Docker host (HOME_TRAFFIC_IP).
#
# Usage:
#   sudo ./apply-nat.sh apply   path/to/forward-ports.env
#   sudo ./apply-nat.sh remove
#
# Requires: nftables (nft), iproute2.
# Edge bootstrap checklist: __DOCS__/99_maintainers/05_networking.md (Edge VM bootstrap).
set -euo pipefail

TABLE="vpnedge"
ENV_FILE="${2:-}"

log_info() {
  printf '[vpn-edge-nat][INFO] %s\n' "$*"
}

log_error() {
  printf '[vpn-edge-nat][ERROR] %s\n' "$*" >&2
}

detect_wan_iface() {
  ip -4 route show default 2>/dev/null | awk '{print $5; exit}'
}

remove_rules() {
  if nft list table ip "${TABLE}" >/dev/null 2>&1; then
    nft delete table ip "${TABLE}"
    log_info "Removed table ip ${TABLE}"
  else
    log_info "Table ip ${TABLE} was not present"
  fi
}

apply_rules() {
  if [[ -z "${ENV_FILE}" || ! -f "${ENV_FILE}" ]]; then
    log_error "Missing env file. Usage: $0 apply /path/to/forward-ports.env"
    exit 1
  fi

  # shellcheck disable=SC1090
  source "${ENV_FILE}"

  if [[ -z "${HOME_TRAFFIC_IP:-}" ]]; then
    log_error "HOME_TRAFFIC_IP must be set in ${ENV_FILE}"
    exit 1
  fi

  local wan="${WAN_IFACE:-$(detect_wan_iface)}"
  local wg="${WG_IFACE:-wg0}"

  if [[ -z "${wan}" ]]; then
    log_error "Could not detect WAN_IFACE; set WAN_IFACE in ${ENV_FILE}"
    exit 1
  fi

  local pairs="${FORWARD_TCP:-80:10080,443:10443,12222:12222}"

  remove_rules

  nft add table ip "${TABLE}"
  nft add chain ip "${TABLE}" forward '{ type filter hook forward priority 0; policy drop; }'
  nft add chain ip "${TABLE}" prerouting '{ type nat hook prerouting priority dstnat; policy accept; }'
  nft add chain ip "${TABLE}" postrouting '{ type nat hook postrouting priority srcnat; policy accept; }'

  IFS=',' read -ra MAPS <<< "${pairs}"
  for entry in "${MAPS[@]}"; do
    entry="${entry// /}"
    if [[ -z "${entry}" ]]; then
      continue
    fi
    local pub dest
    pub="${entry%%:*}"
    dest="${entry#*:}"
    if [[ "${pub}" == "${entry}" || -z "${dest}" ]]; then
      log_error "Bad FORWARD_TCP entry (expected public:dest): ${entry}"
      exit 1
    fi
    nft add rule ip "${TABLE}" prerouting iifname "${wan}" tcp dport "${pub}" \
      dnat to "${HOME_TRAFFIC_IP}:${dest}"
    log_info "DNAT tcp/${pub} -> ${HOME_TRAFFIC_IP}:${dest} (iif ${wan})"
  done

  nft add rule ip "${TABLE}" postrouting oifname "${wg}" masquerade
  log_info "SNAT masquerade on oif ${wg}"

  # MSS clamp on both directions of the WireGuard tunnel. Must precede the
  # accept rules below: nftables walks rules top-to-bottom and stops at the
  # first accept verdict, so the MSS modification has to land first.
  # Covers stacked-VPN clients (e.g. ProtonVPN) whose effective PMTU is
  # smaller than wg0's 1420 and whose path drops ICMP "frag needed".
  nft add rule ip "${TABLE}" forward oifname "${wg}" \
    tcp flags syn / syn,rst counter tcp option maxseg size set rt mtu
  nft add rule ip "${TABLE}" forward iifname "${wg}" \
    tcp flags syn / syn,rst counter tcp option maxseg size set rt mtu
  log_info "MSS clamp to PMTU on ${wg} (both directions)"

  nft add rule ip "${TABLE}" forward iifname "${wan}" oifname "${wg}" accept
  nft add rule ip "${TABLE}" forward iifname "${wg}" oifname "${wan}" ct state established,related accept

  sysctl -w net.ipv4.ip_forward=1 >/dev/null
  log_info "Applied table ip ${TABLE} (WAN=${wan}, WG=${wg}, HOME=${HOME_TRAFFIC_IP})"
}

main() {
  local cmd="${1:-}"
  case "${cmd}" in
    apply)
      apply_rules
      ;;
    remove)
      remove_rules
      ;;
    *)
      log_error "Usage: $0 apply /path/to/forward-ports.env | $0 remove"
      exit 1
      ;;
  esac
}

main "$@"
