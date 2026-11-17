"""Decides what address OpenVAS may scan.

OpenVAS port-scans an address. When a hostname sits behind a CDN such as
Cloudflare, that address belongs to the CDN, not to us: scanning it says
nothing about our server and probes someone else's network. In that case the
host scan is skipped unless the target names the real server address."""
from __future__ import annotations

import ipaddress
import socket

# https://www.cloudflare.com/ips-v4 and /ips-v6 (checked 2026-11-15)
CLOUDFLARE = [ipaddress.ip_network(n) for n in (
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
    "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
    "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
    "2a06:98c0::/29", "2c0f:f248::/32",
)]


class HostNotScannable(ValueError):
    pass


def resolve(host: str) -> list[str]:
    try:
        return sorted({info[4][0] for info in socket.getaddrinfo(host, None)})
    except socket.gaierror as exc:
        raise HostNotScannable(f"{host} does not resolve: {exc}") from exc


def cdn_of(ip: str) -> str | None:
    addr = ipaddress.ip_address(ip)
    return "Cloudflare" if any(addr in net for net in CLOUDFLARE) else None


def check_override(value: str) -> str:
    """The optional per-target OpenVAS address: a public IP of our own server."""
    value = (value or "").strip()
    if not value:
        return ""
    try:
        addr = ipaddress.ip_address(value)
    except ValueError as exc:
        raise HostNotScannable("The OpenVAS address must be an IP address, for example the edge server's public IP.") from exc
    if not addr.is_global:
        raise HostNotScannable("The OpenVAS address must be a public IP address.")
    if cdn_of(value):
        raise HostNotScannable(f"{value} belongs to {cdn_of(value)}, not to your server.")
    return value


def gvm_address(host: str, override: str = "") -> tuple[str, str]:
    """Returns (address to scan, explanation for the report)."""
    if override:
        return override, f"server address {override} set on the target ({host} is not scanned directly)"
    ips = resolve(host)
    cdns = {cdn_of(ip) for ip in ips} - {None}
    if cdns:
        raise HostNotScannable(
            f"{host} resolves to {', '.join(sorted(cdns))} ({', '.join(ips)}), not to your server. Scanning that "
            "address would probe the CDN's network and say nothing about yours. Set the server's public IP as the "
            "OpenVAS address on the target to include the host scan.")
    return host, f"{host} ({', '.join(ips)})"
