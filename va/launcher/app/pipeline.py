"""Runs one scan end to end: preflight, scanners in parallel, DefectDojo import, report."""
from __future__ import annotations

import datetime as dt
import shutil
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

from sqlalchemy import select

from . import apidef, auth, dockerrun, gvm, report, runners, zapplan
from .allowlist import check_url
from .config import settings
from .crypto import decrypt_json, read_secret_file
from .db import Scan, SessionLocal, Target, now
from .dojo import Dojo
from .runners import ScanContext, StepResult

TOOLS: dict[str, dict[str, str]] = {
    "zap": {"name": "OWASP ZAP", "purpose": "Crawls the application and API, then tests for web weaknesses such as injection, cross-site scripting and missing security headers."},
    "nuclei": {"name": "Nuclei", "purpose": "Checks for known vulnerabilities (CVEs), exposed files and panels, and common misconfigurations."},
    "testssl": {"name": "testssl.sh", "purpose": "Checks the HTTPS/TLS setup: protocol versions, ciphers, certificate."},
    "gvm": {"name": "OpenVAS", "purpose": "Scans the server behind the address for open ports and known vulnerabilities in exposed services."},
    "trivy": {"name": "Trivy", "purpose": "Checks the application's container image for known vulnerabilities in its packages."},
}
PROFILE_LABELS = {
    "passive": ("Passive", "crawls the target and observes responses; sends no attack payloads and submits no forms"),
    "standard": ("Standard", "crawls the target, then sends attack payloads at normal strength"),
    "deep": ("Deep", "longer crawl, then attack payloads at high strength with more variants"),
}
ENV_LABELS = {"dev": "Development", "stg": "Staging", "prod": "Production"}
STATUS_LABELS = {"done": "Completed", "failed": "Failed", "skipped": "Skipped", "running": "Running",
                 "pending": "Not started"}


def fmt(ts: dt.datetime | None) -> str:
    return ts.astimezone(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") if ts else "-"


class Runner:
    """Executes a single scan. State is written to the Scan row as it goes so the
    UI can show progress."""

    def __init__(self, scan_id: int):
        self.scan_id = scan_id
        self._lock = threading.Lock()

    # ---- state helpers

    def _update(self, fn: Callable[[Scan], None]) -> None:
        with self._lock, SessionLocal() as s:
            scan = s.get(Scan, self.scan_id)
            fn(scan)
            s.commit()

    def _step(self, tool: str, status: str, message: str = "") -> None:
        def apply(scan: Scan) -> None:
            steps = dict(scan.steps or {})
            entry = dict(steps.get(tool) or {})
            entry.update(status=status, message=message)
            entry["started" if status == "running" else "finished"] = now().isoformat()
            steps[tool] = entry
            scan.steps = steps
        self._update(apply)

    def _detail(self, **values: Any) -> None:
        def apply(scan: Scan) -> None:
            scan.details = {**(scan.details or {}), **values}
        self._update(apply)

    def cancelled(self) -> bool:
        with SessionLocal() as s:
            return s.get(Scan, self.scan_id).status == "cancelled"

    # ---- the scan

    def run(self) -> None:
        try:
            self._run()
        except Exception as exc:  # noqa: BLE001 - recorded on the scan, shown in the UI
            traceback.print_exc()
            def fail(scan: Scan) -> None:
                if scan.status != "cancelled":
                    scan.status = "failed"
                scan.error = f"{type(exc).__name__}: {exc}"
                scan.finished_at = now()
            self._update(fail)

    def _run(self) -> None:
        with SessionLocal() as s:
            scan = s.get(Scan, self.scan_id)
            target = s.get(Target, scan.target_id)
            s.expunge_all()
        check_url(target.base_url, settings.allowed_domains)
        workdir = settings.data_dir / "scans" / scan.code
        workdir.mkdir(parents=True, exist_ok=True)

        feeds = gvm.feed_status()
        if not feeds["ready"]:
            raise RuntimeError("OpenVAS is not ready: " + feeds["detail"])
        dojo = Dojo()
        if not dojo.ready():
            raise RuntimeError("DefectDojo is not reachable; findings cannot be stored")

        def start(sc: Scan) -> None:
            sc.status, sc.started_at = "running", now()
            sc.steps = {t: {"status": "pending", "message": ""} for t in TOOLS}
        self._update(start)

        # -- login
        auth_cfg = decrypt_json(target.auth_config_enc) if target.auth_type != "none" else {}
        headers = auth.request_headers(target.auth_type, auth_cfg)

        # -- API definition
        prepared = None
        all_endpoints: list[apidef.Endpoint] = []
        excluded = set(target.apidef_excluded or [])
        if target.apidef_file:
            raw = read_secret_file(settings.data_dir / target.apidef_file)
            env_raw = read_secret_file(settings.data_dir / target.apidef_env_file) if target.apidef_env_file else None
            overrides = decrypt_json(target.apidef_vars_enc) if target.apidef_vars_enc else {}
            summary = apidef.parse(raw, settings.allowed_domains, env_raw, overrides)
            all_endpoints = summary.endpoints
            prepared = apidef.prepare(raw, target.base_url, settings.allowed_domains, env_raw, overrides, excluded)
            if not headers and prepared.headers:  # the login profile wins over auth saved in the collection
                headers = prepared.headers

        secrets = auth.secrets_of(target.auth_type, auth_cfg, headers)
        ctx = ScanContext(code=scan.code, workdir=workdir, target_url=target.base_url, profile=scan.profile,
                          route=scan.route, headers=headers, secrets=secrets)

        login = {"state": "none", "detail": ""}
        if headers:
            verify_url = auth_cfg.get("check_url") or (prepared.urls[0] if prepared and prepared.urls else target.base_url)
            login = auth.login_check(verify_url, headers)
        self._detail(login_check=login, feeds=feeds["feeds"])

        graphql_endpoint = ""
        if target.graphql_path:
            p = urlsplit(target.base_url)
            graphql_endpoint = f"{p.scheme}://{p.netloc}/{target.graphql_path.lstrip('/')}"
        plan = zapplan.build_plan(
            target_url=target.base_url, profile=scan.profile, auth_type=target.auth_type, auth_cfg=auth_cfg,
            headers=headers, apidef_kind=prepared.kind if prepared else "",
            apidef_file=prepared.filename if prepared else "", graphql_endpoint=graphql_endpoint,
        )
        zap_files = {prepared.filename: prepared.content} if prepared else {}
        if target.auth_type == "script" and auth_cfg.get("script_file"):
            zap_files["auth-script"] = read_secret_file(settings.data_dir / auth_cfg["script_file"]).decode("utf-8", errors="replace")

        jobs: dict[str, Callable[[], StepResult]] = {
            "zap": lambda: runners.run_zap(ctx, plan, zap_files),
            "nuclei": lambda: runners.run_nuclei(ctx, prepared.urls if prepared else []),
            "testssl": lambda: runners.run_testssl(ctx),
            "gvm": lambda: gvm.run_gvm(ctx, self.cancelled, target.gvm_host),
            "trivy": lambda: runners.run_trivy(ctx, target.image_ref),
        }
        results: dict[str, StepResult] = {}

        def guarded(tool: str) -> StepResult:
            self._step(tool, "running")
            try:
                res = jobs[tool]()
            except Exception as exc:  # noqa: BLE001 - one tool failing must not hide the others
                traceback.print_exc()
                res = StepResult(False, f"{type(exc).__name__}: {exc}")
            status = "skipped" if res.extra.get("skipped") else ("done" if res.ok else "failed")
            self._step(tool, status, res.message)
            return res

        with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
            futures = {tool: pool.submit(guarded, tool) for tool in jobs}
            results = {tool: f.result() for tool, f in futures.items()}
        if self.cancelled():
            dockerrun.kill_scan_containers()
            self._update(lambda sc: setattr(sc, "finished_at", now()))
            return

        # -- login check for form / browser / script logins comes from ZAP
        zap_res = results["zap"]
        if target.auth_type in ("form", "browser", "script"):
            marker = auth_cfg.get("logged_in_regex", "")
            har = workdir / "zap" / "history.har"
            if marker and runners.har_matches(har, marker):
                login = {"state": "passed", "detail": "The logged-in marker text was seen in responses."}
            elif marker:
                login = {"state": "failed", "detail": "The logged-in marker text was never seen in any response."}
            elif zap_res.extra.get("zap_login") == "passed":
                login = {"state": "passed", "detail": "ZAP recorded a successful authentication."}
            else:
                login = {"state": "unconfirmed",
                         "detail": "No logged-in marker text is set on the login profile, so success could not be verified."}
        (workdir / "zap" / "history.har").unlink(missing_ok=True)  # large, and may hold session data
        expiry = auth.token_expiry(headers)
        if expiry and login.get("state") == "passed" and expiry < time.time():
            login = {"state": "failed", "detail": (
                "The access token was valid at the start but expired at "
                + dt.datetime.fromtimestamp(expiry, dt.timezone.utc).strftime("%H:%M UTC")
                + ", before the scan finished. Requests after that time were sent without a valid login. "
                "Use a token or client with a lifetime longer than the scan.")}

        seen = [tuple(r) for r in zap_res.extra.get("requests", [])]
        cov_rows = apidef.coverage(prepared.endpoints, seen, excluded, all_endpoints) if prepared else []
        cov_counts: dict[str, int] = {}
        for row in cov_rows:
            cov_counts[row["result"]] = cov_counts.get(row["result"], 0) + 1
        self._detail(login_check=login, coverage={"urls": len({u for _, u, _ in seen}), "api": cov_rows,
                                                 "api_counts": cov_counts},
                     skipped_requests=prepared.skipped if prepared else [])

        # -- DefectDojo
        dojo.configure()
        product_id = dojo.product_id(target.name, f"{target.base_url} ({ENV_LABELS.get(target.environment, '')})")
        engagement_id = dojo.create_engagement(
            product_id, f"{scan.code} {PROFILE_LABELS[scan.profile][0]} scan",
            f"Launched by {scan.requested_by or 'unknown'} from the VA launcher.")
        self._update(lambda sc: setattr(sc, "dojo_engagement_id", engagement_id))
        for tool, res in results.items():
            if res.ok and res.output:
                try:
                    dojo.import_scan(engagement_id, res.scan_type, res.output)
                except Exception as exc:  # noqa: BLE001
                    self._step(tool, "failed", f"{res.message}. Results could not be imported into DefectDojo: {exc}")

        self.build_report(dojo=dojo, attach=True)
        dojo.close_engagement(engagement_id)

        def finish(sc: Scan) -> None:
            failed = [t for t, st in (sc.steps or {}).items() if st.get("status") == "failed"]
            sc.status = "done"
            sc.error = ("Incomplete: " + ", ".join(TOOLS[t]["name"] for t in failed) + " failed.") if failed else ""
            sc.finished_at = now()
        self._update(finish)

    # ---- report (also used by "Regenerate report" after triage in DefectDojo)

    def build_report(self, dojo: Dojo | None = None, attach: bool = False) -> dict[str, str]:
        dojo = dojo or Dojo()
        with SessionLocal() as s:
            scan = s.get(Scan, self.scan_id)
            target = s.get(Target, scan.target_id)
            prev = s.scalars(select(Scan).where(Scan.target_id == scan.target_id, Scan.id < scan.id,
                                                Scan.status == "done").order_by(Scan.id.desc())).first()
            previous = None
            if prev and (prev.details or {}).get("fingerprints") is not None:
                previous = {"code": prev.code, "date": fmt(prev.started_at),
                            "fingerprints": prev.details["fingerprints"]}
            s.expunge_all()
        details = scan.details or {}
        findings = dojo.findings(scan.dojo_engagement_id) if scan.dojo_engagement_id else []
        finished = scan.finished_at or now()
        duration = str(finished - scan.started_at).split(".")[0] if scan.started_at else "-"
        summary = target.apidef_summary or {}
        cov = details.get("coverage") or {"urls": 0, "api": [], "api_counts": {}}
        login = details.get("login_check") or {"state": "none", "detail": ""}
        login["label"] = {"none": "Not applicable (no login used)", "passed": "Passed", "failed": "Failed",
                          "unconfirmed": "Could not be confirmed"}.get(login.get("state", "none"), "Unknown")
        images = {"zap": settings.zap_image, "nuclei": settings.nuclei_image, "testssl": settings.testssl_image,
                  "trivy": settings.trivy_image}
        steps = []
        for tool, meta in TOOLS.items():
            st = (scan.steps or {}).get(tool) or {}
            version = dockerrun.image_version(images[tool]) if tool in images else "Greenbone Community Edition"
            steps.append({**meta, "status": st.get("status", "pending"), "message": st.get("message", ""),
                          "status_label": STATUS_LABELS.get(st.get("status", "pending"), st.get("status", "")),
                          "version": version})
        excluded_n = len(target.apidef_excluded or [])
        scan_ctx = {
            "code": scan.code, "target_name": target.name, "target_url": target.base_url,
            "environment_label": ENV_LABELS.get(target.environment, target.environment),
            "profile_label": PROFILE_LABELS[scan.profile][0], "profile_description": PROFILE_LABELS[scan.profile][1],
            "route_label": ("Internal: scanners reached the target through the platform's own reverse proxy"
                            if scan.route == "internal" else "Public: scanners reached the target over the internet")
                           + ("; OpenVAS scanned the server address " + target.gvm_host + "."
                              if target.gvm_host else "; OpenVAS scans the public address unless it belongs to a CDN."),
            "requested_by": scan.requested_by, "organisation": settings.organisation,
            "started": fmt(scan.started_at), "finished": fmt(finished), "duration": duration,
            "auth_label": auth.AUTH_TYPES.get(target.auth_type, target.auth_type), "login_check": login,
            "steps": steps, "feeds": [f for f in details.get("feeds", []) if f.get("version")],
            "apidef": ({"kind_label": "OpenAPI/Swagger definition" if target.apidef_kind == "openapi" else "Postman collection",
                        "title": summary.get("title", ""), "version": summary.get("version", ""),
                        "total": len(summary.get("endpoints", [])),
                        "scanned": len([r for r in cov["api"] if not r["result"].startswith("skipped")]),
                        "excluded": excluded_n} if target.apidef_kind else None),
            "coverage": cov,
            "dojo_url": (f"{settings.dojo_public_url.rstrip('/')}/engagement/{scan.dojo_engagement_id}"
                         if settings.dojo_public_url and scan.dojo_engagement_id else ""),
            "settings": {
                "Scan ID": scan.code, "Target": target.base_url, "Profile": PROFILE_LABELS[scan.profile][0],
                "Network route": scan.route, "Login type": auth.AUTH_TYPES.get(target.auth_type, target.auth_type),
                "API definition": target.apidef_kind or "none", "Excluded endpoints": str(excluded_n),
                "Requests skipped (other host)": str(len(details.get("skipped_requests", []))),
                "Container image scanned": target.image_ref or "none",
                "OpenVAS address": target.gvm_host or "the target's public address",
                "Allowlisted domains": ", ".join(settings.allowed_domains),
                "OpenVAS scan configuration": "Full and fast, all IANA-assigned TCP ports, results with QoD 70% or higher",
            },
        }
        context = report.build_context(scan=scan_ctx, findings=findings, previous=previous)
        paths = report.write(context, settings.data_dir / "reports", f"{scan.code}-{_slug(target.name)}")
        self._detail(fingerprints=context["fingerprints"], report=paths,
                     counts=context["counts"], rating=context["rating"])
        if attach and scan.dojo_engagement_id:
            for kind in ("pdf", "html"):
                if paths.get(kind):
                    try:
                        dojo.attach(scan.dojo_engagement_id, f"{scan.code} report ({kind.upper()})", Path(paths[kind]))
                    except Exception:  # noqa: BLE001 - the report is still downloadable from the launcher
                        traceback.print_exc()
        return paths


def _slug(text: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "target"


def prune_raw_output() -> None:
    """Raw tool output is deleted after the retention period; reports are kept."""
    root = settings.data_dir / "scans"
    if not root.exists():
        return
    cutoff = time.time() - settings.raw_retention_days * 86400
    for d in root.iterdir():
        if d.is_dir() and d.stat().st_mtime < cutoff:
            shutil.rmtree(d, ignore_errors=True)


def worker_loop(stop: threading.Event) -> None:
    """One scan at a time, oldest first."""
    with SessionLocal() as s:  # scans interrupted by a restart cannot be resumed
        for scan in s.scalars(select(Scan).where(Scan.status == "running")):
            scan.status, scan.error, scan.finished_at = "failed", "Interrupted: the launcher was restarted during the scan.", now()
        s.commit()
    last_prune = 0.0
    while not stop.is_set():
        with SessionLocal() as s:
            nxt = s.scalars(select(Scan).where(Scan.status == "queued").order_by(Scan.id)).first()
            scan_id = nxt.id if nxt else None
        if scan_id:
            Runner(scan_id).run()
        elif time.time() - last_prune > 6 * 3600:
            last_prune = time.time()
            try:
                prune_raw_output()
            except Exception:  # noqa: BLE001
                traceback.print_exc()
        stop.wait(5)
