"""OpenVAS/GVM host scan, driven over gvmd's unix socket with python-gvm."""
from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from .config import settings
from .runners import ScanContext, StepResult

FULL_AND_FAST = "daba56c8-73ec-11df-a475-002264764cea"
OPENVAS_SCANNER = "08b69003-5fc2-4037-a479-93b440211c73"
PORTS_ALL_IANA_TCP = "33d0cd82-57c6-11e1-8ed1-406186ea4fc5"
REPORT_FORMAT_XML = "a994b278-1f62-11e1-96ac-406186ea4fc5"
REPORT_FILTER = "apply_overrides=0 levels=hmlg min_qod=70 rows=-1 sort-reverse=severity"


def _gmp():
    from gvm.connections import UnixSocketConnection
    from gvm.protocols.gmp import Gmp
    from gvm.transforms import EtreeCheckCommandTransform

    return Gmp(UnixSocketConnection(path=settings.gvm_socket, timeout=120), transform=EtreeCheckCommandTransform())


def feed_status() -> dict[str, Any]:
    """{'ready': bool, 'detail': str, 'feeds': [{type, version, syncing}]}"""
    if not Path(settings.gvm_socket).exists():
        return {"ready": False, "detail": "OpenVAS is not running yet (no gvmd socket)", "feeds": []}
    try:
        with _gmp() as gmp:
            gmp.authenticate(settings.gvm_user, settings.gvm_password)
            feeds = []
            for f in gmp.get_feeds().findall("feed"):
                feeds.append({"type": f.findtext("type") or "", "version": f.findtext("version") or "",
                              "syncing": f.find("currently_syncing") is not None})
            configs = gmp.get_scan_configs().findall("config")
            has_config = any(c.get("id") == FULL_AND_FAST for c in configs)
    except Exception as exc:  # noqa: BLE001 - shown to the user as "not ready"
        return {"ready": False, "detail": f"OpenVAS is not answering yet: {type(exc).__name__}: {exc}", "feeds": []}
    syncing = [f["type"] for f in feeds if f["syncing"]]
    missing = [f["type"] for f in feeds if not f["version"]]
    if syncing or missing or not feeds or not has_config:
        parts = []
        if syncing:
            parts.append("syncing: " + ", ".join(syncing))
        if missing:
            parts.append("not loaded: " + ", ".join(missing))
        if not has_config:
            parts.append("scan configuration not loaded yet")
        return {"ready": False, "detail": "Vulnerability feeds are still loading (" + "; ".join(parts or ["no feeds"]) + ")",
                "feeds": feeds}
    return {"ready": True, "detail": "Feeds loaded", "feeds": feeds}


def run_gvm(ctx: ScanContext, cancelled=lambda: False, override: str = "") -> StepResult:
    """Scans the target's public address: exposed ports and services are what matter here.
    Skipped when that address belongs to a CDN and no server address is set (see cdn.py)."""
    from gvm.protocols.gmp.requests.v225 import AliveTest  # available from GMP 22.5 on

    from .cdn import HostNotScannable, gvm_address

    try:
        address, scanned = gvm_address(ctx.host, override)
    except HostNotScannable as exc:
        return StepResult(True, f"Skipped: {exc}", extra={"skipped": True})
    work = ctx.subdir("gvm")
    name = f"{ctx.code} {ctx.host}"
    deadline = time.time() + settings.gvm_timeout_min * 60
    with _gmp() as gmp:
        gmp.authenticate(settings.gvm_user, settings.gvm_password)
        target_id = gmp.create_target(name=name, hosts=[address], port_list_id=PORTS_ALL_IANA_TCP,
                                      alive_test=AliveTest.CONSIDER_ALIVE).get("id")
        task_id = gmp.create_task(name=name, config_id=FULL_AND_FAST, target_id=target_id,
                                  scanner_id=OPENVAS_SCANNER).get("id")
        report_id = gmp.start_task(task_id).findtext("report_id")
    status, progress = "Requested", "0"
    while True:
        time.sleep(30)
        with _gmp() as gmp:  # reconnect each poll; scans outlive socket timeouts
            gmp.authenticate(settings.gvm_user, settings.gvm_password)
            task = gmp.get_task(task_id).find("task")
            status, progress = task.findtext("status") or "", task.findtext("progress") or "0"
            if status in ("Done", "Stopped", "Interrupted"):
                break
            if cancelled() or time.time() > deadline:
                gmp.stop_task(task_id)
                why = "cancelled" if cancelled() else f"did not finish within {settings.gvm_timeout_min} minutes"
                return StepResult(False, f"OpenVAS scan {why} (stopped at {progress}%)")
    if status != "Done":
        return StepResult(False, f"OpenVAS scan of {scanned} ended with status {status} at {progress}%")
    from lxml import etree

    with _gmp() as gmp:
        gmp.authenticate(settings.gvm_user, settings.gvm_password)
        resp = gmp.get_report(report_id, report_format_id=REPORT_FORMAT_XML, filter_string=REPORT_FILTER,
                              ignore_pagination=True, details=True)
    report = resp.find("report")
    if report is None:
        return StepResult(False, "OpenVAS finished but returned no report")
    out = work / "openvas.xml"
    out.write_bytes(etree.tostring(report, xml_declaration=True, encoding="UTF-8"))
    results = len(report.findall(".//results/result"))
    return StepResult(True, f"Completed for {scanned}, {results} results", out if results else None, "OpenVAS Parser",
                      {"results": results})
