"""Runs one-shot scanner containers through the Docker socket."""
from __future__ import annotations

import socket
import threading
from pathlib import Path
from typing import Any

import docker
from docker.types import Mount

from .config import settings
from .crypto import redact

_client: docker.DockerClient | None = None
_lock = threading.Lock()
_host_data_dir: str | None = None


def client() -> docker.DockerClient:
    global _client
    with _lock:
        if _client is None:
            _client = docker.from_env(timeout=120)
        return _client


def host_data_dir() -> str:
    """Scanner containers are siblings, so their bind mounts need the *host* path of
    our data dir. Read it from our own container's mount table."""
    global _host_data_dir
    if _host_data_dir is None:
        me = client().containers.get(socket.gethostname())
        for m in me.attrs.get("Mounts", []):
            if m.get("Destination") == str(settings.data_dir):
                _host_data_dir = str(m["Source"]).replace("\\", "/")
                break
        else:
            raise RuntimeError(f"{settings.data_dir} is not a mount of this container; cannot share scan files")
    return _host_data_dir


def to_host(path: Path) -> str:
    rel = path.resolve().relative_to(settings.data_dir.resolve())
    return f"{host_data_dir().rstrip('/')}/{rel.as_posix()}"


def traefik_ip() -> str:
    c = client().containers.get(settings.traefik_container)
    nets = c.attrs["NetworkSettings"]["Networks"]
    ip = (nets.get(settings.ingress_network) or {}).get("IPAddress")
    if not ip:
        raise RuntimeError(f"{settings.traefik_container} has no address on {settings.ingress_network}")
    return ip


def image_version(image: str) -> str:
    try:
        img = client().images.get(image)
        digest = (img.attrs.get("RepoDigests") or [""])[0].split("@")[-1][:19]
        return f"{image} ({digest or img.short_id})"
    except Exception:  # noqa: BLE001 - version is informational only
        return image


def ensure_image(image: str) -> None:
    try:
        client().images.get(image)
    except docker.errors.ImageNotFound:
        client().images.pull(image)


def run(*, image: str, command: list[str] | str, name: str, log_file: Path, mounts: dict[Path, str] | None = None,
        named_volumes: dict[str, str] | None = None, network: str | None = None,
        extra_hosts: dict[str, str] | None = None, environment: dict[str, str] | None = None,
        entrypoint: list[str] | None = None, timeout_s: int = 3600, user: str | None = None,
        secrets: list[str] | None = None, shm_size: str | None = None) -> int:
    """Run to completion, write (redacted) logs to log_file, return the exit code.
    Returns 124 when the timeout was hit."""
    ensure_image(image)
    mount_objs = [Mount(target=target, source=to_host(src), type="bind") for src, target in (mounts or {}).items()]
    mount_objs += [Mount(target=target, source=vol, type="volume") for vol, target in (named_volumes or {}).items()]
    kwargs: dict[str, Any] = dict(
        image=image, command=command, name=name, detach=True, mounts=mount_objs,
        network=network or settings.scan_network, extra_hosts=extra_hosts or {},
        environment=environment or {}, mem_limit=settings.scanner_mem_limit,
        nano_cpus=int(settings.scanner_cpus * 1e9), labels={"va.scan": "true"},
    )
    if entrypoint is not None:
        kwargs["entrypoint"] = entrypoint
    if user:
        kwargs["user"] = user
    if shm_size:
        kwargs["shm_size"] = shm_size
    try:
        client().containers.get(name).remove(force=True)  # leftover from a crashed run
    except docker.errors.NotFound:
        pass
    container = client().containers.run(**kwargs)
    code = 124
    try:
        try:
            code = int(container.wait(timeout=timeout_s).get("StatusCode", 1))
        except Exception:  # noqa: BLE001 - requests ReadTimeout / ConnectionError on timeout
            container.kill()
        logs = container.logs(stdout=True, stderr=True).decode("utf-8", errors="replace")
        log_file.write_text(redact(logs, secrets or []), encoding="utf-8")
    finally:
        try:
            container.remove(force=True)
        except Exception:  # noqa: BLE001
            pass
    return code


def kill_scan_containers() -> None:
    for c in client().containers.list(filters={"label": "va.scan=true"}):
        try:
            c.remove(force=True)
        except Exception:  # noqa: BLE001
            pass
