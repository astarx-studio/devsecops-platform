"""Login profiles: what each type needs, and how it turns into scanner input."""
from __future__ import annotations

import re
from typing import Any

import requests

from .allowlist import check_url
from .config import settings

AUTH_TYPES = {
    "none": "None (public pages only)",
    "header": "Bearer token / API key / cookie (static headers)",
    "oauth2": "OAuth2 token (client credentials or password grant)",
    "form": "App login form",
    "browser": "Browser login (Keycloak SSO, OIDC, SAML)",
    "script": "Custom ZAP authentication script",
}

# field name -> (label, secret?)
FIELDS: dict[str, dict[str, tuple[str, bool]]] = {
    "none": {},
    "header": {
        "headers": ("Headers, one per line as 'Name: value'", True),
        "check_url": ("URL that requires login (used to verify the credentials)", False),
    },
    "oauth2": {
        "token_url": ("Token URL", False),
        "grant": ("Grant: client_credentials or password", False),
        "client_id": ("Client ID", False),
        "client_secret": ("Client secret", True),
        "username": ("Username (password grant only)", False),
        "password": ("Password (password grant only)", True),
        "scope": ("Scope (optional)", False),
        "check_url": ("URL that requires login (used to verify the token)", False),
    },
    "form": {
        "login_url": ("Login form URL (where the form is posted)", False),
        "username_field": ("Username field name", False),
        "password_field": ("Password field name", False),
        "username": ("Test user", False),
        "password": ("Test user password", True),
        "extra": ("Extra form fields, e.g. remember=1 (optional)", False),
        "logged_in_regex": ("Text that only appears when logged in, e.g. Logout", False),
    },
    "browser": {
        "login_url": ("Page that starts the login (the app's login or protected page)", False),
        "username": ("Test user", False),
        "password": ("Test user password", True),
        "logged_in_regex": ("Text that only appears when logged in (optional but recommended)", False),
    },
    "script": {
        "script_engine": ("Script engine, e.g. Graal.js", False),
        "username": ("Test user", False),
        "password": ("Test user password", True),
        "logged_in_regex": ("Text that only appears when logged in", False),
    },
}


class AuthError(RuntimeError):
    pass


def validate(auth_type: str, cfg: dict[str, Any]) -> None:
    if auth_type not in AUTH_TYPES:
        raise AuthError(f"Unknown login type {auth_type!r}")
    required = {
        "header": ["headers"],
        "oauth2": ["token_url", "client_id"],
        "form": ["login_url", "username_field", "password_field", "username", "password"],
        "browser": ["login_url", "username", "password"],
        "script": ["username", "password", "script_file"],
    }.get(auth_type, [])
    missing = [f for f in required if not str(cfg.get(f, "")).strip()]
    if missing:
        raise AuthError("Missing login settings: " + ", ".join(missing))
    for key in ("token_url", "login_url", "check_url"):
        if cfg.get(key):
            check_url(cfg[key], settings.allowed_domains)  # secrets are only ever sent to allowlisted hosts
    if auth_type == "header":
        parse_headers(cfg["headers"])
    if auth_type == "oauth2" and cfg.get("grant", "client_credentials") not in ("client_credentials", "password"):
        raise AuthError("Grant must be client_credentials or password")


def parse_headers(text: str) -> dict[str, str]:
    headers: dict[str, str] = {}
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        if ":" not in line:
            raise AuthError(f"Header line needs the form 'Name: value': {line.split()[0]!r}…")
        name, value = line.split(":", 1)
        if not re.fullmatch(r"[A-Za-z0-9!#$%&'*+.^_`|~-]+", name.strip()):
            raise AuthError(f"Invalid header name {name.strip()!r}")
        headers[name.strip()] = value.strip()
    if not headers:
        raise AuthError("No headers given")
    return headers


def fetch_oauth_token(cfg: dict[str, Any], session: requests.Session | None = None) -> str:
    http = session or requests
    data = {"grant_type": cfg.get("grant") or "client_credentials", "client_id": cfg["client_id"]}
    if cfg.get("client_secret"):
        data["client_secret"] = cfg["client_secret"]
    if data["grant_type"] == "password":
        data.update(username=cfg.get("username", ""), password=cfg.get("password", ""))
    if cfg.get("scope"):
        data["scope"] = cfg["scope"]
    try:
        resp = http.post(cfg["token_url"], data=data, timeout=30, allow_redirects=False)
    except requests.RequestException as exc:
        raise AuthError(f"Token request failed: {type(exc).__name__}") from exc
    if resp.status_code != 200:
        raise AuthError(f"Token endpoint answered HTTP {resp.status_code}; check the client and credentials")
    token = (resp.json() or {}).get("access_token")
    if not token:
        raise AuthError("Token endpoint returned no access_token")
    return token


def request_headers(auth_type: str, cfg: dict[str, Any]) -> dict[str, str]:
    """Headers added to every scanner request for header-style logins."""
    if auth_type == "header":
        return parse_headers(cfg["headers"])
    if auth_type == "oauth2":
        return {"Authorization": "Bearer " + fetch_oauth_token(cfg)}
    return {}


def token_expiry(headers: dict[str, str]) -> int | None:
    """Unix expiry time of a JWT bearer token in the headers, if there is one.
    The scanners send a fixed header for the whole run, so a token that expires
    mid-scan silently turns the rest of the scan into an unauthenticated one."""
    import base64
    import json

    value = headers.get("Authorization") or headers.get("authorization") or ""
    token = value.split(" ", 1)[1] if value.lower().startswith("bearer ") else ""
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
        return int(payload["exp"])
    except (ValueError, KeyError, TypeError):
        return None


def secrets_of(auth_type: str, cfg: dict[str, Any], headers: dict[str, str]) -> list[str]:
    out = [str(cfg[k]) for k, (_, secret) in FIELDS.get(auth_type, {}).items() if secret and cfg.get(k)]
    out += list(headers.values())
    out += [v.split(" ", 1)[1] for v in headers.values() if " " in v]
    return out


def login_check(url: str, headers: dict[str, str], verify: bool | str = True,
                session: requests.Session | None = None) -> dict[str, Any]:
    """For header-style logins: the protected URL must answer differently with
    the credentials than a 401/403. Result is recorded in the report."""
    http = session or requests
    try:
        resp = http.get(url, headers=headers, timeout=30, allow_redirects=False, verify=verify)
    except requests.RequestException as exc:
        return {"state": "failed", "detail": f"Could not reach {url}: {type(exc).__name__}"}
    if resp.status_code in (401, 403):
        return {"state": "failed", "detail": f"{url} answered HTTP {resp.status_code} with the supplied credentials"}
    if resp.status_code in (301, 302, 303, 307, 308) and re.search(r"login|signin|auth", resp.headers.get("location", ""), re.I):
        return {"state": "failed", "detail": f"{url} redirected to a login page with the supplied credentials"}
    return {"state": "passed", "detail": f"{url} answered HTTP {resp.status_code} with the supplied credentials"}
