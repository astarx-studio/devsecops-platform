"""Target allowlist. Nothing outside VA_ALLOWED_DOMAINS is ever scanned."""
from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit


class NotAllowed(ValueError):
    """Raised when a URL or host is outside the allowlist."""


def host_allowed(host: str, allowed_domains: list[str]) -> bool:
    host = (host or "").strip().lower().rstrip(".")
    if not host:
        return False
    try:
        ipaddress.ip_address(host.strip("[]"))
        return False  # IP literals are never allowed; targets are named platform apps
    except ValueError:
        pass
    for domain in allowed_domains:
        domain = domain.strip().lower().lstrip(".")
        if domain and (host == domain or host.endswith("." + domain)):
            return True
    return False


def check_url(url: str, allowed_domains: list[str]) -> str:
    """Return the normalised URL, or raise NotAllowed with the reason."""
    url = (url or "").strip()
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise NotAllowed(f"Only http and https URLs can be scanned: {url!r}")
    if parts.username or parts.password:
        raise NotAllowed("URLs with embedded credentials are not accepted")
    host = parts.hostname or ""
    if not host_allowed(host, allowed_domains):
        raise NotAllowed(
            f"{host or url!r} is not on the allowlist ({', '.join(allowed_domains) or 'empty'})"
        )
    return url


def same_host(url: str, base_url: str) -> bool:
    a, b = urlsplit(url), urlsplit(base_url)
    return (a.hostname or "").lower() == (b.hostname or "").lower()
