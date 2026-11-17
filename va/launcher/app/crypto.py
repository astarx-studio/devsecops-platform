"""Encrypts login profiles and secret variables at rest (Fernet, key from VA_SECRET_KEY)."""
from __future__ import annotations

import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from .config import settings


def _fernet(key: str | None = None) -> Fernet:
    key = key or settings.secret_key
    if not key:
        raise RuntimeError("VA_SECRET_KEY is not set; refusing to store secrets unencrypted")
    return Fernet(key.encode())


def encrypt_json(value: Any, key: str | None = None) -> str:
    return _fernet(key).encrypt(json.dumps(value).encode()).decode()


def decrypt_json(token: str | None, key: str | None = None) -> Any:
    if not token:
        return {}
    try:
        return json.loads(_fernet(key).decrypt(token.encode()).decode())
    except InvalidToken as exc:
        raise RuntimeError("Stored secret cannot be decrypted; was VA_SECRET_KEY changed?") from exc


def redact(text: str, secrets: list[str]) -> str:
    """Remove secret values from text that is about to be logged or shown."""
    for secret in sorted({s for s in secrets if s and len(s) >= 4}, key=len, reverse=True):
        text = text.replace(secret, "***")
    return text


def write_secret_file(path, data: bytes, key: str | None = None) -> None:
    """Uploads (API definitions, Postman environments, auth scripts) can hold
    tokens, so they are encrypted on disk as well."""
    path.write_bytes(_fernet(key).encrypt(data))


def read_secret_file(path, key: str | None = None) -> bytes:
    try:
        return _fernet(key).decrypt(path.read_bytes())
    except InvalidToken as exc:
        raise RuntimeError(f"{path.name} cannot be decrypted; was VA_SECRET_KEY changed?") from exc
