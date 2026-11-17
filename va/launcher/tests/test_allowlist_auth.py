import base64
import json
import time

import pytest

from app import auth
from app.allowlist import NotAllowed, check_url, host_allowed
from app.crypto import decrypt_json, encrypt_json, read_secret_file, redact, write_secret_file

from .conftest import ALLOWED


@pytest.mark.parametrize("url", [
    "https://example.test/", "https://api.dev.apps.example.org/v1", "http://a.b.example.test:8080/x",
    "https://EXAMPLE.test/",
])
def test_allowed_urls(url):
    assert check_url(url, ALLOWED) == url


@pytest.mark.parametrize("url", [
    "https://evil.com/", "https://example.test.evil.com/", "https://notexample.test/",
    "https://evil.com/?x=example.test", "https://example.test@evil.com/", "https://user:pw@example.test/",
    "ftp://example.test/", "file:///etc/passwd", "https://127.0.0.1/", "https://[::1]/", "https://10.0.0.5/",
    "//example.test/", "example.test", "", "https://evil.com#.example.test", "https://evil.com\\@example.test/",
])
def test_refused_urls(url):
    with pytest.raises(NotAllowed):
        check_url(url, ALLOWED)


def test_empty_allowlist_refuses_everything():
    assert not host_allowed("example.test", [])


def test_secrets_roundtrip_and_redaction(tmp_path):
    token = encrypt_json({"password": "s3cret-value"})
    assert "s3cret-value" not in token
    assert decrypt_json(token) == {"password": "s3cret-value"}
    assert redact("Authorization: Bearer abcdef123456", ["abcdef123456"]) == "Authorization: Bearer ***"
    f = tmp_path / "upload"
    write_secret_file(f, b'{"token": "abcdef123456"}')
    assert b"abcdef123456" not in f.read_bytes()
    assert read_secret_file(f) == b'{"token": "abcdef123456"}'


def test_header_profile():
    cfg = {"headers": "Authorization: Bearer abc.def.ghi\nX-Api-Key: k1"}
    auth.validate("header", cfg)
    assert auth.request_headers("header", cfg) == {"Authorization": "Bearer abc.def.ghi", "X-Api-Key": "k1"}
    with pytest.raises(auth.AuthError):
        auth.validate("header", {"headers": "no colon here"})
    with pytest.raises(auth.AuthError):
        auth.validate("header", {"headers": ""})


def test_secrets_are_only_sent_to_allowlisted_hosts():
    with pytest.raises(NotAllowed):
        auth.validate("oauth2", {"token_url": "https://evil.com/token", "client_id": "x"})
    with pytest.raises(NotAllowed):
        auth.validate("form", {"login_url": "https://evil.com/login", "username_field": "u", "password_field": "p",
                               "username": "a", "password": "b"})
    auth.validate("oauth2", {"token_url": "https://auth.example.test/token", "client_id": "x"})


class _Resp:
    def __init__(self, status, body=None, headers=None):
        self.status_code, self._body, self.headers = status, body or {}, headers or {}

    def json(self):
        return self._body


class _Http:
    def __init__(self, resp):
        self.resp, self.calls = resp, []

    def post(self, url, **kw):
        self.calls.append((url, kw))
        return self.resp

    get = post


def test_oauth_token_fetch():
    http = _Http(_Resp(200, {"access_token": "tok"}))
    cfg = {"token_url": "https://auth.example.test/token", "client_id": "c", "client_secret": "s", "scope": "api"}
    assert auth.fetch_oauth_token(cfg, http) == "tok"
    assert http.calls[0][1]["data"] == {"grant_type": "client_credentials", "client_id": "c", "client_secret": "s",
                                        "scope": "api"}
    with pytest.raises(auth.AuthError):
        auth.fetch_oauth_token(cfg, _Http(_Resp(401)))
    with pytest.raises(auth.AuthError):
        auth.fetch_oauth_token(cfg, _Http(_Resp(200, {})))


@pytest.mark.parametrize("status,headers,state", [
    (200, {}, "passed"), (401, {}, "failed"), (403, {}, "failed"),
    (302, {"location": "/login?next=/"}, "failed"), (302, {"location": "/dashboard"}, "passed"),
])
def test_login_check(status, headers, state):
    res = auth.login_check("https://example.test/me", {"Authorization": "Bearer x"}, session=_Http(_Resp(status, headers=headers)))
    assert res["state"] == state


def test_token_expiry():
    payload = base64.urlsafe_b64encode(json.dumps({"exp": int(time.time()) + 300}).encode()).decode().rstrip("=")
    exp = auth.token_expiry({"Authorization": f"Bearer aaa.{payload}.sig"})
    assert exp and exp > time.time()
    assert auth.token_expiry({"Authorization": "Bearer opaque-token"}) is None
    assert auth.token_expiry({"X-Api-Key": "k"}) is None
