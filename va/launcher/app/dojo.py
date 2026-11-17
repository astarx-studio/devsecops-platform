"""Thin DefectDojo API v2 client: products, engagements, imports, findings."""
from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any

import requests

from .config import settings

PRODUCT_TYPE = "Web applications and APIs"


class DojoError(RuntimeError):
    pass


class Dojo:
    def __init__(self, url: str | None = None, user: str | None = None, password: str | None = None):
        self.url = (url or settings.dojo_url).rstrip("/")
        self.user = user or settings.dojo_user
        self.password = password or settings.dojo_password
        self.http = requests.Session()
        self._token = ""

    # ---- plumbing

    def _auth(self) -> None:
        if self._token:
            return
        r = self.http.post(f"{self.url}/api/v2/api-token-auth/", timeout=30,
                           json={"username": self.user, "password": self.password})
        if r.status_code != 200:
            raise DojoError(f"DefectDojo login failed (HTTP {r.status_code}); check VA_DOJO_PASSWORD")
        self._token = r.json()["token"]
        self.http.headers["Authorization"] = f"Token {self._token}"

    def _call(self, method: str, path: str, **kw: Any) -> Any:
        self._auth()
        r = self.http.request(method, f"{self.url}/api/v2/{path.lstrip('/')}", timeout=kw.pop("timeout", 300), **kw)
        if r.status_code >= 400:
            raise DojoError(f"DefectDojo {method} {path} failed: HTTP {r.status_code} {r.text[:300]}")
        return r.json() if r.content else {}

    def _all(self, path: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        params = {**params, "limit": 200, "offset": 0}
        while True:
            page = self._call("GET", path, params=params)
            out += page.get("results", [])
            if not page.get("next"):
                return out
            params["offset"] += params["limit"]

    def ready(self) -> bool:
        try:
            self._auth()
            return True
        except (DojoError, requests.RequestException):
            self._token = ""
            return False

    # ---- setup

    def configure(self) -> None:
        """Deduplication on, and remember false positives across scans of the same app."""
        rows = self._call("GET", "system_settings/").get("results", [])
        if rows:
            self._call("PATCH", f"system_settings/{rows[0]['id']}/",
                       json={"enable_deduplication": True, "false_positive_history": True})

    def product_id(self, name: str, description: str) -> int:
        found = self._call("GET", "products/", params={"name_exact": name}).get("results", [])
        if found:
            return found[0]["id"]
        types = self._call("GET", "product_types/", params={"name": PRODUCT_TYPE}).get("results", [])
        type_id = types[0]["id"] if types else self._call("POST", "product_types/", json={"name": PRODUCT_TYPE})["id"]
        return self._call("POST", "products/", json={"name": name, "description": description or name,
                                                     "prod_type": type_id})["id"]

    # ---- one scan = one engagement

    def create_engagement(self, product_id: int, name: str, description: str) -> int:
        today = dt.date.today().isoformat()
        return self._call("POST", "engagements/", json={
            "name": name, "product": product_id, "description": description,
            "target_start": today, "target_end": today, "status": "In Progress",
            "engagement_type": "Interactive", "deduplication_on_engagement": False,
        })["id"]

    def import_scan(self, engagement_id: int, scan_type: str, file: Path) -> int:
        with file.open("rb") as fh:
            res = self._call("POST", "import-scan/", timeout=1800, files={"file": (file.name, fh)}, data={
                "engagement": engagement_id, "scan_type": scan_type, "active": "true", "verified": "false",
                "minimum_severity": "Info", "close_old_findings": "false",
                "scan_date": dt.date.today().isoformat(),
            })
        return int(res.get("test") or res.get("test_id") or 0)

    def close_engagement(self, engagement_id: int) -> None:
        self._call("POST", f"engagements/{engagement_id}/close/")

    def attach(self, engagement_id: int, title: str, file: Path) -> None:
        with file.open("rb") as fh:
            self._call("POST", f"engagements/{engagement_id}/files/", files={"file": (file.name, fh)},
                       data={"title": title})

    def findings(self, engagement_id: int) -> list[dict[str, Any]]:
        """Findings of one engagement with endpoint URLs and the tool that found each."""
        tests = {t["id"]: t.get("scan_type") or t.get("test_type_name") or ""
                 for t in self._all("tests/", {"engagement": engagement_id})}
        findings = self._all("findings/", {"test__engagement": engagement_id})
        urls = self._locations([f["id"] for f in findings])
        for f in findings:
            f["tool"] = tests.get(f.get("test"), "")
            f["endpoint_urls"] = urls.get(f["id"], [])
        return findings

    def _locations(self, finding_ids: list[int]) -> dict[int, list[str]]:
        """Affected URLs per finding. DefectDojo 3.x links findings to locations
        (/location_findings/); the ids in a finding's `endpoints` field no longer
        match the /endpoints/ API, so that API cannot be used to resolve them.
        The filter is `finding_includes`: unknown filter names are silently ignored
        and return every row, so the result is checked against the requested ids."""
        out: dict[int, list[str]] = {}
        wanted = set(finding_ids)
        for i in range(0, len(finding_ids), 50):
            chunk = finding_ids[i:i + 50]
            rows = self._all("location_findings/", {"finding_includes": ",".join(map(str, chunk))})
            for row in rows:
                if row["finding"] in wanted and row.get("location_value"):
                    urls = out.setdefault(row["finding"], [])
                    if row["location_value"] not in urls:
                        urls.append(row["location_value"])
        return out


