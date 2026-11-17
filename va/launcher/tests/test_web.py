import json

import pytest
from fastapi.testclient import TestClient

from app import gvm, main
from app.config import settings
from app.db import Scan, SessionLocal, Target, init_db
from app.dojo import Dojo

from .test_apidef import OPENAPI3, POSTMAN21, POSTMAN_ENV

ORIGIN = {"origin": "http://testserver", "x-auth-request-email": "ops@example.test"}


@pytest.fixture()
def client(monkeypatch):
    init_db()
    for sub in ("uploads", "scans", "reports"):
        (settings.data_dir / sub).mkdir(exist_ok=True)
    with SessionLocal() as s:
        s.query(Scan).delete()
        s.query(Target).delete()
        s.commit()
    monkeypatch.setattr(gvm, "feed_status", lambda: {"ready": True, "detail": "ok", "feeds": []})
    monkeypatch.setattr(Dojo, "ready", lambda self: True)
    return TestClient(main.app, follow_redirects=False)  # no lifespan: the worker thread is not started


def add_target(client, name="Portal", url="https://app.dev.apps.example.org/", env="dev"):
    r = client.post("/targets/new", data={"name": name, "base_url": url, "environment": env}, headers=ORIGIN)
    assert r.status_code == 303, r.text
    return int(r.headers["location"].rsplit("/", 1)[1])


def test_cross_site_posts_are_refused(client):
    assert client.post("/targets/new", data={"name": "x", "base_url": "https://example.test"}).status_code == 403
    r = client.post("/targets/new", data={"name": "x", "base_url": "https://example.test"}, headers={"origin": "https://evil.com"})
    assert r.status_code == 403


def test_target_outside_allowlist_is_refused(client):
    r = client.post("/targets/new", data={"name": "Evil", "base_url": "https://evil.com/"}, headers=ORIGIN)
    assert r.status_code == 200 and "not on the allowlist" in r.text
    with SessionLocal() as s:
        assert s.query(Target).count() == 0


def test_pages_render(client):
    tid = add_target(client)
    for path in ("/", "/targets", "/targets/new", f"/targets/{tid}", "/scans/new", f"/scans/new?target_id={tid}", "/help", "/healthz"):
        assert client.get(path).status_code == 200, path
    assert client.get("/targets/999").status_code == 404


def test_login_profile_secrets_are_encrypted_and_never_rendered(client):
    tid = add_target(client)
    r = client.post(f"/targets/{tid}/auth", headers=ORIGIN,
                    data={"auth_type": "header", "header__headers": "Authorization: Bearer super-secret-token"})
    assert "Login profile saved" in r.text and "super-secret-token" not in r.text
    with SessionLocal() as s:
        t = s.get(Target, tid)
        assert t.auth_type == "header" and "super-secret-token" not in t.auth_config_enc
    r = client.post(f"/targets/{tid}/auth", headers=ORIGIN,
                    data={"auth_type": "oauth2", "oauth2__token_url": "https://evil.com/token", "oauth2__client_id": "c"})
    assert "not on the allowlist" in r.text


def test_openapi_upload_validation_and_production_defaults(client):
    tid = add_target(client, env="prod")
    bad = client.post(f"/targets/{tid}/apidef", headers=ORIGIN, files={"definition": ("x.json", b"{broken")})
    assert "was not accepted" in bad.text
    r = client.post(f"/targets/{tid}/apidef", headers=ORIGIN,
                    files={"definition": ("openapi.json", json.dumps(OPENAPI3).encode())})
    assert "4 endpoints found" in r.text
    with SessionLocal() as s:
        t = s.get(Target, tid)
        assert t.apidef_kind == "openapi"
        assert set(t.apidef_excluded) == {"POST /v1/orders", "DELETE /v1/orders/{orderId}"}  # prod default
        assert b"openapi" not in (settings.data_dir / t.apidef_file).read_bytes()  # encrypted on disk
    r = client.post(f"/targets/{tid}/apidef/settings", headers=ORIGIN,
                    data={"include": ["GET /v1/orders", "POST /v1/orders"], "var__orderId": "77"})
    assert "saved" in r.text
    with SessionLocal() as s:
        assert set(s.get(Target, tid).apidef_excluded) == {"GET /v1/orders/{orderId}", "DELETE /v1/orders/{orderId}"}


def test_postman_unresolved_variables_block_the_scan_until_set(client):
    tid = add_target(client)
    r = client.post(f"/targets/{tid}/apidef", headers=ORIGIN,
                    files={"definition": ("c.json", json.dumps(POSTMAN21).encode())})
    assert "Variables without a value: productName, token" in r.text
    assert "variables without a value" in client.get(f"/scans/new?target_id={tid}").text
    blocked = client.post("/scans/new", headers=ORIGIN, data={"target_id": tid, "profile": "passive", "confirm_authorised": "1"})
    assert blocked.status_code == 200 and "cannot start yet" in blocked.text
    r = client.post(f"/targets/{tid}/apidef/settings", headers=ORIGIN,
                    data={"include": ["GET /products"], "var__token": "tok-abc-123", "var__productName": "W"})
    assert "tok-abc-123" not in r.text and "Variables without a value" not in r.text
    with SessionLocal() as s:
        t = s.get(Target, tid)
        assert "tok-abc-123" not in json.dumps(t.apidef_summary) and "tok-abc-123" not in t.apidef_vars_enc
    ok = client.post("/scans/new", headers=ORIGIN, data={"target_id": tid, "profile": "passive", "confirm_authorised": "1"})
    assert ok.status_code == 303


def test_postman_environment_file_values_are_not_stored_in_clear(client):
    tid = add_target(client)
    r = client.post(f"/targets/{tid}/apidef", headers=ORIGIN,
                    files={"definition": ("c.json", json.dumps(POSTMAN21).encode()),
                           "environment_file": ("e.json", json.dumps(POSTMAN_ENV).encode())})
    assert "4 endpoints found" in r.text and "tok-123" not in r.text
    with SessionLocal() as s:
        t = s.get(Target, tid)
        assert "tok-123" not in json.dumps(t.apidef_summary)
        assert b"tok-123" not in (settings.data_dir / t.apidef_env_file).read_bytes()


def test_scan_needs_authorisation_and_production_confirmation(client):
    tid = add_target(client, env="prod")
    base = {"target_id": tid, "route": "internal"}
    r = client.post("/scans/new", headers=ORIGIN, data={**base, "profile": "passive"})
    assert r.status_code == 200 and "authorised" in r.text
    r = client.post("/scans/new", headers=ORIGIN, data={**base, "profile": "standard", "confirm_authorised": "1"})
    assert r.status_code == 200 and "production target" in r.text
    r = client.post("/scans/new", headers=ORIGIN, data={**base, "profile": "standard", "confirm_authorised": "1", "confirm_prod": "1"})
    assert r.status_code == 303
    with SessionLocal() as s:
        scan = s.query(Scan).one()
        assert scan.status == "queued" and scan.requested_by == "ops@example.test" and scan.code == f"VA-{scan.id:05d}"
    page = client.get(r.headers["location"])
    assert page.status_code == 200 and "Waiting in the queue" in page.text


def test_scans_are_blocked_while_feeds_load(client, monkeypatch):
    tid = add_target(client)
    monkeypatch.setattr(gvm, "feed_status", lambda: {"ready": False, "detail": "syncing: NVT", "feeds": []})
    r = client.post("/scans/new", headers=ORIGIN, data={"target_id": tid, "profile": "passive", "confirm_authorised": "1"})
    assert r.status_code == 200 and "OpenVAS is not ready" in r.text
    with SessionLocal() as s:
        assert s.query(Scan).count() == 0


def test_log_download_cannot_escape_the_scan_folder(client):
    tid = add_target(client)
    r = client.post("/scans/new", headers=ORIGIN, data={"target_id": tid, "profile": "passive", "confirm_authorised": "1"})
    sid = int(r.headers["location"].rsplit("/", 1)[1])
    assert client.get(f"/scans/{sid}/log/..%2F..%2Fva.db").status_code == 404
    assert client.get(f"/scans/{sid}/log/zap/zap.log").status_code == 404
    assert client.get(f"/scans/{sid}/report.pdf").status_code == 404


def test_requests_without_the_proxy_secret_are_refused(client, monkeypatch):
    monkeypatch.setattr(settings, "proxy_secret", "s3cret-from-traefik")
    assert client.get("/healthz").status_code == 200  # container healthcheck
    assert client.get("/", headers=ORIGIN).status_code == 403
    assert client.get("/", headers={**ORIGIN, "x-va-proxy-secret": "wrong"}).status_code == 403
    r = client.post("/targets/new", data={"name": "x", "base_url": "https://example.test/"}, headers=ORIGIN)
    assert r.status_code == 403
    assert client.get("/", headers={**ORIGIN, "x-va-proxy-secret": "s3cret-from-traefik"}).status_code == 200
