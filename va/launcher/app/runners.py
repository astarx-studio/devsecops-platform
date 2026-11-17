"""One function per container-based scanner. Each returns a StepResult; a failure is
reported as a failure, never as an empty result."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from . import dockerrun, zapplan
from .config import settings


@dataclass
class StepResult:
    ok: bool
    message: str = ""
    output: Path | None = None  # file to import into DefectDojo
    scan_type: str = ""  # DefectDojo parser name
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class ScanContext:
    code: str
    workdir: Path
    target_url: str
    profile: str
    route: str  # internal | public
    headers: dict[str, str]
    secrets: list[str]

    @property
    def host(self) -> str:
        return urlsplit(self.target_url).hostname or ""

    @property
    def port(self) -> int:
        p = urlsplit(self.target_url)
        return p.port or (443 if p.scheme == "https" else 80)

    def network_args(self) -> dict[str, Any]:
        """Internal route: run next to Traefik and pin the hostname to it, so scan
        traffic stays on this host instead of leaving through the public edge."""
        if self.route == "internal":
            return {"network": settings.ingress_network, "extra_hosts": {self.host: dockerrun.traefik_ip()}}
        return {"network": settings.scan_network}

    def subdir(self, name: str) -> Path:
        d = self.workdir / name
        d.mkdir(parents=True, exist_ok=True)
        d.chmod(0o777)
        return d


def _nonempty(path: Path) -> bool:
    return path.exists() and path.stat().st_size > 0


# ------------------------------------------------------------------ ZAP


def run_zap(ctx: ScanContext, plan: dict[str, Any], files: dict[str, str]) -> StepResult:
    work = ctx.subdir("zap")
    (work / "plan.yaml").write_text(zapplan.dump(plan), encoding="utf-8")
    for name, content in files.items():
        (work / name).write_text(content, encoding="utf-8")
    timeout_min = 60 + sum(int(j.get("parameters", {}).get(k, 0)) for j in plan["jobs"]
                           for k in ("maxDuration", "maxScanDurationInMins"))
    code = dockerrun.run(
        image=settings.zap_image, name=f"va-zap-{ctx.code.lower()}",
        command=["zap.sh", "-cmd", "-addoninstall", "postman", "-autorun", f"{zapplan.WORK}/plan.yaml"],
        mounts={work: zapplan.WORK}, log_file=work / "zap.log", timeout_s=timeout_min * 60,
        secrets=ctx.secrets, shm_size="2g", **ctx.network_args(),
    )
    (work / "plan.yaml").unlink(missing_ok=True)  # contains credentials
    report = work / "zap-report.xml"
    log = (work / "zap.log").read_text(encoding="utf-8", errors="replace") if (work / "zap.log").exists() else ""
    extra: dict[str, Any] = {"requests": read_har(work / "history.har"), "zap_login": zap_login_state(log)}
    if code == 124:
        return StepResult(False, f"ZAP did not finish within {timeout_min} minutes and was stopped", extra=extra)
    if not _nonempty(report):
        return StepResult(False, f"ZAP exited with code {code} and produced no report; see zap.log", extra=extra)
    msg = "Completed" if code == 0 else f"Completed with warnings (exit code {code}); see zap.log"
    return StepResult(True, msg, report, "ZAP Scan", extra)


def zap_login_state(log: str) -> str:
    """'passed' / 'failed' / '' from the login-check test line in the ZAP log."""
    for line in log.splitlines():
        if "login-check" in line:
            low = line.lower()
            if "passed" in low:
                return "passed"
            if "failed" in low or "warn" in low:
                return "failed"
    return ""


def read_har(path: Path, limit: int = 20000) -> list[list[Any]]:
    """[(method, url, status)] from ZAP's HAR export. Bodies are dropped; only the
    logged-in marker check needs them and that is done here."""
    if not _nonempty(path):
        return []
    try:
        entries = json.loads(path.read_text(encoding="utf-8", errors="replace"))["log"]["entries"]
    except (ValueError, KeyError):
        return []
    out = []
    for e in entries[:limit]:
        try:
            out.append([e["request"]["method"], e["request"]["url"], int(e["response"]["status"])])
        except (KeyError, TypeError, ValueError):
            continue
    return out


def har_matches(path: Path, pattern: str) -> bool:
    if not pattern or not _nonempty(path):
        return False
    try:
        rx = re.compile(pattern)
        entries = json.loads(path.read_text(encoding="utf-8", errors="replace"))["log"]["entries"]
    except (ValueError, KeyError, re.error):
        return False
    return any(rx.search(str((e.get("response") or {}).get("content", {}).get("text", ""))) for e in entries)


# ------------------------------------------------------------------ Nuclei


def run_nuclei(ctx: ScanContext, urls: list[str]) -> StepResult:
    work = ctx.subdir("nuclei")
    targets = list(dict.fromkeys([ctx.target_url, *urls]))
    (work / "targets.txt").write_text("\n".join(targets) + "\n", encoding="utf-8")
    cmd = ["-l", "/work/targets.txt", "-jsonl", "-o", "/work/nuclei.jsonl", "-silent", "-no-color",
           "-disable-update-check", "-no-interactsh", "-rate-limit", "50", "-timeout", "10",
           "-exclude-tags", "dos,fuzz,bruteforce" + (",intrusive" if ctx.profile == "passive" else "")]
    for name, value in ctx.headers.items():
        cmd += ["-H", f"{name}: {value}"]
    templates = settings.data_dir / "cache" / "nuclei-templates"
    templates.mkdir(parents=True, exist_ok=True)
    # The scan runs with -disable-update-check, which also stops Nuclei from fetching
    # templates, so download or refresh them first.
    code = dockerrun.run(
        image=settings.nuclei_image, name=f"va-nuclei-update-{ctx.code.lower()}",
        command=["-update-templates", "-silent", "-no-color"],
        mounts={templates: "/root/nuclei-templates"}, log_file=work / "nuclei-update.log",
        timeout_s=15 * 60, network=settings.scan_network,
    )
    if code != 0 and not any(templates.glob("*/")):
        return StepResult(False, f"Nuclei could not download its templates (exit code {code}); see nuclei-update.log")
    code = dockerrun.run(
        image=settings.nuclei_image, name=f"va-nuclei-{ctx.code.lower()}", command=cmd,
        mounts={work: "/work", templates: "/root/nuclei-templates"}, log_file=work / "nuclei.log",
        timeout_s=90 * 60, secrets=ctx.secrets, **ctx.network_args(),
    )
    out = work / "nuclei.jsonl"
    if code != 0:
        why = "did not finish within 90 minutes" if code == 124 else f"exited with code {code}"
        return StepResult(False, f"Nuclei {why}; see nuclei.log")
    if not out.exists():
        out.write_text("", encoding="utf-8")  # nuclei writes no file when nothing matched
    count = sum(1 for line in out.read_text(encoding="utf-8", errors="replace").splitlines() if line.strip())
    return StepResult(True, f"Completed, {count} matches on {len(targets)} URLs",
                      out if count else None, "Nuclei Scan", {"urls": len(targets)})


# ------------------------------------------------------------------ testssl.sh


def run_testssl(ctx: ScanContext) -> StepResult:
    if not ctx.target_url.lower().startswith("https://"):
        return StepResult(True, "Skipped: the target is not served over HTTPS", extra={"skipped": True})
    work = ctx.subdir("testssl")
    out = work / "testssl.csv"
    out.unlink(missing_ok=True)
    # testssl.sh resolves names itself and ignores the pinned hosts entry, so the
    # internal route has to name Traefik's address explicitly.
    ip = dockerrun.traefik_ip() if ctx.route == "internal" else "one"
    code = dockerrun.run(
        image=settings.testssl_image, name=f"va-testssl-{ctx.code.lower()}",
        command=["--quiet", "--color", "0", "--warnings", "off", "--ip", ip,
                 "--csvfile", "/work/testssl.csv", f"{ctx.host}:{ctx.port}"],
        mounts={work: "/work"}, log_file=work / "testssl.log", timeout_s=30 * 60, user="0", **ctx.network_args(),
    )
    if not _nonempty(out):
        why = "did not finish within 30 minutes" if code == 124 else f"exited with code {code} and wrote no results"
        return StepResult(False, f"testssl.sh {why}; see testssl.log")
    filtered = work / "testssl-findings.csv"
    kept, grade = filter_testssl(out, filtered)
    msg = "Completed" + (f", overall grade {grade}" if grade else "") + f", {kept} problems"
    return StepResult(True, msg, filtered if kept else None, "Testssl Scan", {"grade": grade})


TESTSSL_PROBLEMS = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}


def filter_testssl(src: Path, dst: Path) -> tuple[int, str]:
    """testssl.sh writes one CSV row per check, most of them OK or INFO facts
    (certificate fields, client simulations). Only problems become findings.
    The per-cipher rows are folded into one finding, and the overall grade is
    kept for the report instead of being listed as an issue."""
    import csv

    with src.open(newline="", encoding="utf-8", errors="replace") as fh:
        rows = list(csv.DictReader(fh))
    grade, keep, ciphers = "", [], []
    for r in rows:
        rid, sev = (r.get("id") or "").strip(), (r.get("severity") or "").strip().upper()
        if rid == "overall_grade":
            grade = (r.get("finding") or "").strip()
        elif sev not in TESTSSL_PROBLEMS:
            continue
        elif rid.lower().startswith("cipher-tls"):
            ciphers.append(r)
        else:
            keep.append(r)
    if ciphers:
        rank = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
        worst = max((c["severity"].strip().upper() for c in ciphers), key=rank.index)
        lines = sorted({" ".join((c.get("finding") or "").split()) for c in ciphers})
        keep.append({**ciphers[0], "id": "weak_ciphers_offered", "severity": worst,
                     "finding": f"{len(ciphers)} weak cipher suites offered: " + "; ".join(lines)})
    with dst.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else ["id", "severity", "finding"],
                           quoting=csv.QUOTE_ALL)
        w.writeheader()
        w.writerows(keep)
    return len(keep), grade


# ------------------------------------------------------------------ Trivy


def run_trivy(ctx: ScanContext, image_ref: str) -> StepResult:
    if not image_ref:
        return StepResult(True, "Skipped: no container image is set on the target", extra={"skipped": True})
    work = ctx.subdir("trivy")
    cache = settings.data_dir / "cache" / "trivy"
    cache.mkdir(parents=True, exist_ok=True)
    env = {}
    if settings.trivy_username:
        env = {"TRIVY_USERNAME": settings.trivy_username, "TRIVY_PASSWORD": settings.trivy_password}
    code = dockerrun.run(
        image=settings.trivy_image, name=f"va-trivy-{ctx.code.lower()}",
        command=["image", "--quiet", "--format", "json", "--output", "/work/trivy.json",
                 "--scanners", "vuln", "--cache-dir", "/cache", image_ref],
        mounts={work: "/work", cache: "/cache"}, log_file=work / "trivy.log", timeout_s=30 * 60,
        environment=env, secrets=[settings.trivy_password], network=settings.ingress_network,
    )
    out = work / "trivy.json"
    if code != 0 or not _nonempty(out):
        why = "did not finish within 30 minutes" if code == 124 else f"exited with code {code}"
        return StepResult(False, f"Trivy {why} for {image_ref}; see trivy.log")
    return StepResult(True, f"Completed for {image_ref}", out, "Trivy Scan")
