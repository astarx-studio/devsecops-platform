"""Builds the fixed-layout report (HTML and PDF) from DefectDojo findings.

The layout never changes between scans: the same nine sections always appear, in
the same order, even when a section has nothing to show."""
from __future__ import annotations

import datetime as dt
import hashlib
import re
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from . import owasp

SEVERITIES = ["Critical", "High", "Medium", "Low", "Info"]
RANK = {s: i for i, s in enumerate(SEVERITIES)}
TOOL_NAMES = {"ZAP Scan": "OWASP ZAP", "Nuclei Scan": "Nuclei", "Testssl Scan": "testssl.sh",
              "OpenVAS Parser": "OpenVAS", "Trivy Scan": "Trivy"}
# Suggested fix deadlines shown in the report and the manual.
FIX_WITHIN = {"Critical": "7 days", "High": "30 days", "Medium": "90 days", "Low": "180 days", "Info": "no deadline"}

_env = Environment(loader=FileSystemLoader(str(Path(__file__).parent / "templates")),
                   autoescape=select_autoescape(["html"]), trim_blocks=True, lstrip_blocks=True)


def _norm_title(title: str) -> str:
    return re.sub(r"\s+", " ", (title or "").strip().lower())


def _cves(f: dict[str, Any]) -> list[str]:
    ids = [v.get("vulnerability_id", "") for v in f.get("vulnerability_ids") or [] if isinstance(v, dict)]
    return sorted({i for i in ids if i.upper().startswith("CVE-")})


def _trim(text: str | None, limit: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[:limit].rstrip() + " […]"


# OpenVAS findings arrive titled "<name>_<host>_<port>/tcp" (or "_general/tcp").
_OPENVAS_SUFFIX = re.compile(r"^(?P<name>.+?)_(?P<host>[^_\s/]+)_(?P<where>\d+/(?:tcp|udp)|general/\S+)$")


def split_title(title: str) -> tuple[str, str]:
    """(clean title, "host:port/proto" or ""). Other tools' titles are returned as they are."""
    m = _OPENVAS_SUFFIX.match((title or "").strip())
    if not m:
        return (title or "").strip(), ""
    where = m.group("where")
    place = m.group("host") if where.startswith("general/") else f"{m.group('host')}:{where}"
    return m.group("name").strip(), place


def merge(findings: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Collapse the same issue reported for several URLs or by several tools into one
    entry. Returns (open issues, set-aside issues: false positive / accepted / out of scope)."""
    groups: dict[tuple[str, int], dict[str, Any]] = {}
    # Fixed order, so the same findings always produce the same report text.
    for f in sorted(findings, key=lambda f: (f.get("id") or 0, f.get("title") or "")):
        sev = f.get("severity") if f.get("severity") in RANK else "Info"
        title, place = split_title(f.get("title", ""))
        key = (_norm_title(title), int(f.get("cwe") or 0))
        if f.get("false_p"):
            state = "False positive"
        elif f.get("risk_accepted"):
            state = "Risk accepted"
        elif f.get("out_of_scope"):
            state = "Out of scope"
        else:
            state = "Open"
        g = groups.setdefault((key[0] + "|" + state, key[1]), {
            "title": title or "Untitled finding", "severity": sev, "cwe": int(f.get("cwe") or 0),
            "cvss": None, "cves": set(), "urls": [], "tools": set(), "description": "", "mitigation": "",
            "impact": "", "references": "", "evidence": "", "state": state, "dojo_ids": [], "hashes": set(),
        })
        if RANK[sev] < RANK[g["severity"]]:
            g["severity"] = sev
        score = f.get("cvssv3_score")
        if score is not None and (g["cvss"] is None or float(score) > g["cvss"]):
            g["cvss"] = float(score)
        g["cves"].update(_cves(f))
        for u in [*(f.get("endpoint_urls") or []), place]:
            if u and u not in g["urls"]:
                g["urls"].append(u)
        if f.get("file_path") and f["file_path"] not in g["urls"]:
            g["urls"].append(f["file_path"])
        g["tools"].add(TOOL_NAMES.get(f.get("tool", ""), f.get("tool") or "Unknown"))
        for field, limit in (("description", 3000), ("mitigation", 2000), ("impact", 1500), ("references", 1500)):
            if not g[field] and f.get(field):
                g[field] = _trim(f[field], limit)
        if not g["evidence"]:
            g["evidence"] = _trim(f.get("steps_to_reproduce") or f.get("param") or "", 1500)
        g["dojo_ids"].append(f.get("id"))
        g["hashes"].add(f.get("hash_code") or hashlib.sha256(repr(key).encode()).hexdigest())

    issues, aside = [], []
    for g in groups.values():
        g["cves"], g["tools"] = sorted(g["cves"]), sorted(g["tools"])
        g["fingerprint"] = hashlib.sha256((_norm_title(g["title"]) + f"|{g['cwe']}").encode()).hexdigest()[:16]
        g["owasp"] = owasp.top10(g["cwe"], bool(g["cves"]) or "Trivy" in g["tools"])
        g["owasp_api"] = owasp.api_top10(g["cwe"])
        g["fix_within"] = FIX_WITHIN[g["severity"]]
        (issues if g["state"] == "Open" else aside).append(g)
    order = lambda g: (RANK[g["severity"]], -(g["cvss"] or 0), g["title"].lower())  # noqa: E731
    issues.sort(key=order)
    aside.sort(key=order)
    for i, g in enumerate(issues, 1):
        g["ref"] = f"F-{i:03d}"
    return issues, aside


def risk_rating(counts: dict[str, int]) -> str:
    for sev in SEVERITIES[:4]:
        if counts.get(sev):
            return sev
    return "Informational" if counts.get("Info") else "None found"


def changes(issues: list[dict[str, Any]], previous: dict[str, Any] | None) -> dict[str, Any]:
    """Compare with the previous completed scan of the same target (by issue fingerprint)."""
    if not previous:
        return {"has_previous": False, "new": [], "fixed": [], "open": []}
    before: dict[str, dict[str, str]] = previous.get("fingerprints") or {}
    now = {g["fingerprint"]: g for g in issues}
    return {
        "has_previous": True, "previous_code": previous.get("code", ""), "previous_date": previous.get("date", ""),
        "new": [g for fp, g in now.items() if fp not in before],
        "open": [g for fp, g in now.items() if fp in before],
        "fixed": [v for fp, v in before.items() if fp not in now],
    }


def build_context(*, scan: dict[str, Any], findings: list[dict[str, Any]],
                  previous: dict[str, Any] | None = None) -> dict[str, Any]:
    issues, aside = merge(findings)
    counts = {s: sum(1 for g in issues if g["severity"] == s) for s in SEVERITIES}
    top10 = [{"key": k, "name": name, "issues": [g for g in issues if g["owasp"] == k]}
             for k, (name, _) in owasp.TOP10_2021.items()]
    api10 = [{"key": k, "name": name, "issues": [g for g in issues if g["owasp_api"] == k]}
             for k, (name, _) in owasp.API_TOP10_2023.items()]
    failed = [s for s in scan.get("steps", []) if s.get("status") == "failed"]
    return {
        "scan": scan, "issues": issues, "aside": aside, "counts": counts, "total": len(issues),
        "rating": risk_rating(counts), "top5": issues[:5], "top10": top10, "api10": api10,
        "unmapped": [g for g in issues if not g["owasp"] and not g["owasp_api"]],
        "changes": changes(issues, previous), "severities": SEVERITIES, "fix_within": FIX_WITHIN,
        "failed_steps": failed, "complete": not failed,
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "fingerprints": {g["fingerprint"]: {"title": g["title"], "severity": g["severity"]} for g in issues},
    }


def render_html(context: dict[str, Any]) -> str:
    return _env.get_template("report/report.html").render(**context)


def write(context: dict[str, Any], out_dir: Path, basename: str) -> dict[str, str]:
    """Writes <basename>.html and <basename>.pdf; returns their paths. A PDF failure
    is returned as an error string instead of hiding the HTML report."""
    out_dir.mkdir(parents=True, exist_ok=True)
    html = render_html(context)
    html_path = out_dir / f"{basename}.html"
    html_path.write_text(html, encoding="utf-8")
    result = {"html": str(html_path), "pdf": "", "pdf_error": ""}
    try:
        from weasyprint import HTML

        pdf_path = out_dir / f"{basename}.pdf"
        HTML(string=html, base_url=str(out_dir)).write_pdf(str(pdf_path))
        result["pdf"] = str(pdf_path)
    except Exception as exc:  # noqa: BLE001
        result["pdf_error"] = f"{type(exc).__name__}: {exc}"
    return result
