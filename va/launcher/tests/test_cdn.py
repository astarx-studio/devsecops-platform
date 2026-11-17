import pytest

from app import cdn, gvm
from app.runners import ScanContext


@pytest.mark.parametrize("ip,expected", [
    ("172.67.175.181", "Cloudflare"), ("104.21.3.4", "Cloudflare"), ("2606:4700:3030::6815:300c", "Cloudflare"),
    ("34.101.10.20", None), ("2001:db8::1", None),
])
def test_cdn_detection(ip, expected):
    assert cdn.cdn_of(ip) == expected


def test_cdn_fronted_host_is_not_scanned(monkeypatch):
    monkeypatch.setattr(cdn, "resolve", lambda host: ["172.67.175.181", "2606:4700:3030::6815:300c"])
    with pytest.raises(cdn.HostNotScannable, match="Cloudflare"):
        cdn.gvm_address("qestor.app")
    assert cdn.gvm_address("qestor.app", "34.101.10.20")[0] == "34.101.10.20"


def test_direct_host_is_scanned_by_name(monkeypatch):
    monkeypatch.setattr(cdn, "resolve", lambda host: ["34.101.10.20"])
    assert cdn.gvm_address("app.example.test") == ("app.example.test", "app.example.test (34.101.10.20)")


@pytest.mark.parametrize("value,ok", [
    ("", True), ("34.101.10.20", True), ("10.0.0.5", False), ("127.0.0.1", False), ("172.67.175.181", False),
    ("evil.com", False), ("34.101.10.0/24", False),
])
def test_override_validation(value, ok):
    if ok:
        assert cdn.check_override(value) == value
    else:
        with pytest.raises(cdn.HostNotScannable):
            cdn.check_override(value)


def test_run_gvm_skips_cdn_hosts_without_touching_openvas(monkeypatch, tmp_path):
    monkeypatch.setattr(cdn, "resolve", lambda host: ["172.67.175.181"])
    monkeypatch.setattr(gvm, "_gmp", lambda: (_ for _ in ()).throw(AssertionError("OpenVAS must not be called")))
    ctx = ScanContext(code="VA-00001", workdir=tmp_path, target_url="https://qestor.app/", profile="passive",
                      route="internal", headers={}, secrets=[])
    res = gvm.run_gvm(ctx)
    assert res.ok and res.extra.get("skipped") and "Cloudflare" in res.message
