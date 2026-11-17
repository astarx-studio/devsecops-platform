"""Launcher settings. Everything comes from the environment (va/.env via Compose)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _csv(value: str) -> list[str]:
    return [v.strip().lower() for v in value.split(",") if v.strip()]


@dataclass
class Settings:
    database_url: str = field(default_factory=lambda: os.environ.get("VA_DATABASE_URL", "sqlite:///./va.db"))
    secret_key: str = field(default_factory=lambda: os.environ.get("VA_SECRET_KEY", ""))
    allowed_domains: list[str] = field(default_factory=lambda: _csv(os.environ.get("VA_ALLOWED_DOMAINS", "")))
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("VA_DATA_DIR", "/data")))
    manual_dir: Path = field(default_factory=lambda: Path(os.environ.get("VA_MANUAL_DIR", "/app/manual")))
    public_url: str = field(default_factory=lambda: os.environ.get("VA_PUBLIC_URL", ""))
    organisation: str = field(default_factory=lambda: os.environ.get("VA_ORGANISATION", ""))
    raw_retention_days: int = field(default_factory=lambda: int(os.environ.get("VA_RAW_RETENTION_DAYS", "30")))
    # Refuse to start when the data dir is not the junction-backed mount (see setup-storage.ps1).
    require_storage_marker: bool = field(
        default_factory=lambda: os.environ.get("VA_REQUIRE_STORAGE_MARKER", "false").lower() == "true"
    )

    # DefectDojo
    dojo_url: str = field(default_factory=lambda: os.environ.get("VA_DOJO_URL", "http://va-dojo-nginx:8080"))
    dojo_public_url: str = field(default_factory=lambda: os.environ.get("VA_DOJO_PUBLIC_URL", ""))
    dojo_user: str = field(default_factory=lambda: os.environ.get("VA_DOJO_USER", "admin"))
    dojo_password: str = field(default_factory=lambda: os.environ.get("VA_DOJO_PASSWORD", ""))

    # GVM / OpenVAS
    gvm_socket: str = field(default_factory=lambda: os.environ.get("VA_GVM_SOCKET", "/run/gvmd/gvmd.sock"))
    gvm_user: str = field(default_factory=lambda: os.environ.get("VA_GVM_USER", "admin"))
    gvm_password: str = field(default_factory=lambda: os.environ.get("VA_GVM_PASSWORD", ""))
    gvm_timeout_min: int = field(default_factory=lambda: int(os.environ.get("VA_GVM_TIMEOUT_MIN", "180")))

    # Scanner containers started through the Docker socket
    zap_image: str = field(default_factory=lambda: os.environ.get("VA_ZAP_IMAGE", "zaproxy/zap-stable:latest"))
    nuclei_image: str = field(default_factory=lambda: os.environ.get("VA_NUCLEI_IMAGE", "projectdiscovery/nuclei:latest"))
    testssl_image: str = field(default_factory=lambda: os.environ.get("VA_TESTSSL_IMAGE", "ghcr.io/testssl/testssl.sh:3.2"))
    trivy_image: str = field(default_factory=lambda: os.environ.get("VA_TRIVY_IMAGE", "aquasec/trivy:latest"))
    trivy_username: str = field(default_factory=lambda: os.environ.get("VA_TRIVY_USERNAME", ""))
    trivy_password: str = field(default_factory=lambda: os.environ.get("VA_TRIVY_PASSWORD", ""))
    scanner_mem_limit: str = field(default_factory=lambda: os.environ.get("VA_SCANNER_MEM_LIMIT", "4g"))
    scanner_cpus: float = field(default_factory=lambda: float(os.environ.get("VA_SCANNER_CPUS", "2")))

    # Networking: where scanners run and how the "internal route" finds Traefik
    ingress_network: str = field(default_factory=lambda: os.environ.get("VA_INGRESS_NETWORK", "devops-network"))
    scan_network: str = field(default_factory=lambda: os.environ.get("VA_SCAN_NETWORK", "va-internal"))
    traefik_container: str = field(default_factory=lambda: os.environ.get("VA_TRAEFIK_CONTAINER", "traefik"))

    # Traefik adds X-VA-Proxy-Secret after the SSO check. When set, requests without it
    # (anything reaching the container directly on devops-network) are refused.
    proxy_secret: str = field(default_factory=lambda: os.environ.get("VA_PROXY_SECRET", ""))
    proxy_secret_header: str = "x-va-proxy-secret"
    user_header: str = "x-auth-request-email"


settings = Settings()
