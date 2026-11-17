import re

import pytest
import yaml

from app import owasp, report, zapplan

TARGET = "https://app.dev.apps.example.org/"


def jobs(plan):
    return [j["type"] for j in plan["jobs"]]


# ---------------------------------------------------------------- ZAP plan


def test_passive_profile_never_attacks_or_submits_forms():
    plan = zapplan.build_plan(target_url=TARGET, profile="passive")
    assert "activeScan" not in jobs(plan)
    spider = next(j for j in plan["jobs"] if j["type"] == "spider")
    assert spider["parameters"]["postForm"] is False
    assert jobs(plan)[-1] == "report" and "export" in jobs(plan)


@pytest.mark.parametrize("profile", ["standard", "deep"])
def test_active_profiles_attack_after_history_export(profile):
    plan = zapplan.build_plan(target_url=TARGET, profile=profile)
    order = jobs(plan)
    assert order.index("export") < order.index("activeScan") < order.index("report")


def test_scope_is_limited_to_the_target_host():
    ctx = zapplan.build_plan(target_url=TARGET, profile="standard")["env"]["contexts"][0]
    rx = re.compile(ctx["includePaths"][0])
    assert rx.fullmatch("https://app.dev.apps.example.org/a/b?c=1")
    assert not rx.fullmatch("https://app.dev.apps.example.org.evil.com/")
    assert not rx.fullmatch("https://evil.com/?https://app.dev.apps.example.org/")
    assert any(re.fullmatch(p, "https://app.dev.apps.example.org/logout") for p in ctx["excludePaths"])


def test_unknown_profile_is_an_error():
    with pytest.raises(ValueError):
        zapplan.build_plan(target_url=TARGET, profile="turbo")


def test_header_login_becomes_replacer_rules_scoped_to_the_target():
    plan = zapplan.build_plan(target_url=TARGET, profile="passive",
                              headers={"Authorization": "Bearer t", "X-Api-Key": "k"})
    rep = next(j for j in plan["jobs"] if j["type"] == "replacer")
    assert [(r["matchString"], r["replacementString"]) for r in rep["rules"]] == [("Authorization", "Bearer t"), ("X-Api-Key", "k")]
    assert all(re.compile(r["url"]).fullmatch("https://app.dev.apps.example.org/x") for r in rep["rules"])
    for other in ("https://evil.com/x", "https://app.dev.apps.example.org.evil.com/x"):
        assert not re.compile(rep["rules"][0]["url"]).fullmatch(other)  # token never sent elsewhere
    assert "users" not in plan["env"]["contexts"][0]


def test_form_login():
    cfg = {"login_url": TARGET + "login", "username_field": "email", "password_field": "pass", "username": "u",
           "password": "p", "extra": "remember=1", "logged_in_regex": "Logout"}
    plan = zapplan.build_plan(target_url=TARGET, profile="standard", auth_type="form", auth_cfg=cfg)
    ctx = plan["env"]["contexts"][0]
    assert ctx["authentication"]["method"] == "form"
    assert ctx["authentication"]["parameters"]["loginRequestBody"] == "email={%username%}&pass={%password%}&remember=1"
    assert ctx["authentication"]["verification"] == {"method": "response", "loggedInRegex": "Logout"}
    assert ctx["users"][0]["credentials"] == {"username": "u", "password": "p"}
    for kind in ("spider", "spiderAjax", "activeScan"):
        assert next(j for j in plan["jobs"] if j["type"] == kind)["parameters"]["user"] == zapplan.USER


def test_browser_login_for_sso():
    cfg = {"login_url": TARGET, "username": "u", "password": "p"}
    ctx = zapplan.build_plan(target_url=TARGET, profile="passive", auth_type="browser", auth_cfg=cfg)["env"]["contexts"][0]
    assert ctx["authentication"]["method"] == "browser"
    assert ctx["authentication"]["parameters"]["loginPageUrl"] == TARGET
    assert ctx["sessionManagement"]["method"] == "autodetect"


@pytest.mark.parametrize("kind,job", [("openapi", "openapi"), ("postman", "postman")])
def test_api_definition_import_jobs(kind, job):
    plan = zapplan.build_plan(target_url=TARGET, profile="passive", apidef_kind=kind, apidef_file=f"{kind}.json")
    imp = next(j for j in plan["jobs"] if j["type"] == job)
    assert f"/zap/wrk/{kind}.json" in imp["parameters"].values()
    assert jobs(plan).index(job) < jobs(plan).index("spider")


def test_plan_is_valid_yaml():
    plan = zapplan.build_plan(target_url=TARGET, profile="deep", headers={"A": "b: c"}, graphql_endpoint=TARGET + "graphql")
    assert yaml.safe_load(zapplan.dump(plan)) == plan


# ---------------------------------------------------------------- report


def finding(i, title, severity, cwe=0, tool="ZAP Scan", **kw):
    return {"id": i, "title": title, "severity": severity, "cwe": cwe, "tool": tool, "hash_code": f"h{i}",
            "endpoint_urls": kw.pop("urls", [f"https://app.dev.apps.example.org/p{i}"]), "description": f"desc {i}",
            "mitigation": f"fix {i}", **kw}


FINDINGS = [
    finding(1, "SQL Injection", "High", 89, cvssv3_score=8.6),
    finding(2, "SQL Injection", "Critical", 89, urls=["https://app.dev.apps.example.org/other"], cvssv3_score=9.8),
    finding(3, "sql  injection", "High", 89, tool="Nuclei Scan"),
    finding(4, "Missing Content-Security-Policy", "Medium", 693),
    finding(5, "TLS 1.0 offered", "Low", 326, tool="Testssl Scan"),
    finding(6, "OpenSSH outdated", "High", 0, tool="OpenVAS Parser", vulnerability_ids=[{"vulnerability_id": "CVE-2024-6387"}]),
    finding(7, "Server banner", "Info", 200),
    finding(8, "Looks scary but is not", "High", 79, false_p=True),
    finding(9, "Known and accepted", "Medium", 16, risk_accepted=True),
    finding(10, "Weird severity", "Bogus", 0),
]
SCAN = {
    "code": "VA-00007", "target_name": "Portal <dev>", "target_url": "https://app.dev.apps.example.org/",
    "environment_label": "Development", "profile_label": "Standard", "profile_description": "crawl then attack",
    "route_label": "Internal", "requested_by": "ops@example.test", "organisation": "Example Org",
    "started": "2026-11-15 10:00 UTC", "finished": "2026-11-15 11:00 UTC", "duration": "1:00:00",
    "auth_label": "Bearer token", "login_check": {"state": "passed", "label": "Passed", "detail": "ok"},
    "steps": [{"name": n, "purpose": "p", "version": "v", "status": "done", "status_label": "Completed", "message": "ok"}
              for n in ("OWASP ZAP", "Nuclei", "testssl.sh", "OpenVAS", "Trivy")],
    "feeds": [{"type": "NVT", "version": "202611150600"}],
    "apidef": {"kind_label": "OpenAPI/Swagger definition", "title": "Orders", "version": "3.0.3", "total": 4,
               "scanned": 3, "excluded": 1},
    "coverage": {"urls": 42, "api": [{"method": "GET", "path": "/v1/orders", "name": "listOrders", "status": 200,
                                      "result": "reached"}], "api_counts": {"reached": 1}},
    "dojo_url": "https://va-dojo.devops.example.test/engagement/3", "settings": {"Profile": "Standard"},
}
SECTIONS = ['id="cover"', 'id="summary"', 'id="scope"', 'id="coverage"', 'id="findings-summary"', 'id="owasp"',
            'id="details"', 'id="changes"', 'id="appendix"']


def test_merge_collapses_same_issue_across_urls_and_tools():
    issues, aside = report.merge(FINDINGS)
    sqli = issues[0]
    assert sqli["title"] == "SQL Injection" and sqli["severity"] == "Critical" and sqli["cvss"] == 9.8
    assert sqli["tools"] == ["Nuclei", "OWASP ZAP"] and len(sqli["urls"]) == 3 and sqli["ref"] == "F-001"
    assert [g["severity"] for g in issues] == ["Critical", "High", "Medium", "Low", "Info", "Info"]
    assert sorted(g["state"] for g in aside) == ["False positive", "Risk accepted"]
    assert all(g["title"] != "Looks scary but is not" for g in issues)


def test_owasp_mapping():
    issues, _ = report.merge(FINDINGS)
    by_title = {g["title"]: g for g in issues}
    assert by_title["SQL Injection"]["owasp"] == "A03"
    assert by_title["OpenSSH outdated"]["owasp"] == "A06"  # known CVE in a component
    assert by_title["Missing Content-Security-Policy"]["owasp"] == "A05"
    assert by_title["Missing Content-Security-Policy"]["owasp_api"] == "API8"
    assert owasp.top10(918) == "A10" and owasp.api_top10(918) == "API7" and owasp.top10(None) is None


def test_risk_rating():
    assert report.risk_rating({"Critical": 0, "High": 2, "Medium": 5}) == "High"
    assert report.risk_rating({"Info": 3}) == "Informational"
    assert report.risk_rating({}) == "None found"


def test_report_has_every_section_in_order_even_when_empty():
    for findings in (FINDINGS, []):
        html = report.render_html(report.build_context(scan=SCAN, findings=findings))
        positions = [html.index(s) for s in SECTIONS]
        assert positions == sorted(positions)
    assert "No open issues were found" in html and "first completed scan" in html


def test_report_escapes_content_and_never_hides_failures():
    scan = {**SCAN, "steps": [dict(SCAN["steps"][0], status="failed", status_label="Failed", message="ZAP exited with code 1"),
                              *SCAN["steps"][1:]],
            "login_check": {"state": "failed", "label": "Failed", "detail": "401 with the supplied credentials"}}
    evil = [finding(1, "<script>alert(1)</script>", "High", 79, description="<img src=x onerror=alert(1)>")]
    html = report.render_html(report.build_context(scan=scan, findings=evil))
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;" in html and "<img src=x" not in html
    assert "Portal &lt;dev&gt;" in html
    assert "This scan is incomplete" in html and "Incomplete scan" in html and "ZAP exited with code 1" in html
    assert "The login did not work" in html


def test_change_since_previous_scan():
    first = report.build_context(scan=SCAN, findings=FINDINGS)
    previous = {"code": "VA-00006", "date": "2026-11-01 10:00 UTC", "fingerprints": first["fingerprints"]}
    later = [f for f in FINDINGS if f["id"] not in (4,)] + [finding(20, "Open redirect", "Medium", 601)]
    ctx = report.build_context(scan=SCAN, findings=later, previous=previous)
    ch = ctx["changes"]
    assert [g["title"] for g in ch["new"]] == ["Open redirect"]
    assert [g["title"] for g in ch["fixed"]] == ["Missing Content-Security-Policy"]
    assert len(ch["open"]) == len(first["issues"]) - 1
    html = report.render_html(ctx)
    assert "VA-00006" in html and "No longer found" in html


def test_same_findings_give_identical_layout():
    a = report.render_html(report.build_context(scan=SCAN, findings=FINDINGS))
    b = report.render_html(report.build_context(scan=SCAN, findings=list(reversed(FINDINGS))))
    strip = lambda h: re.sub(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC", "", h)  # noqa: E731
    assert strip(a) == strip(b)


def test_pdf_is_written(tmp_path):
    paths = report.write(report.build_context(scan=SCAN, findings=FINDINGS), tmp_path, "VA-00007-portal")
    assert paths["pdf_error"] == "", paths["pdf_error"]
    assert (tmp_path / "VA-00007-portal.pdf").read_bytes().startswith(b"%PDF")
    assert (tmp_path / "VA-00007-portal.html").stat().st_size > 5000


def test_openvas_titles_are_cleaned_and_merged_across_ports():
    f = [finding(1, "SSL/TLS: HSTS Missing_34.101.130.148_443/tcp", "Info", 0, tool="OpenVAS Parser", urls=[]),
         finding(2, "SSL/TLS: HSTS Missing_34.101.130.148_80/tcp", "Info", 0, tool="OpenVAS Parser", urls=[]),
         finding(3, "Traceroute_34.101.130.148_general/tcp", "Info", 0, tool="OpenVAS Parser", urls=[]),
         finding(4, "Cipherlist_OBSOLETED", "Low", 310, tool="Testssl Scan", urls=[])]
    issues, _ = report.merge(f)
    by = {g["title"]: g for g in issues}
    assert set(by) == {"SSL/TLS: HSTS Missing", "Traceroute", "Cipherlist_OBSOLETED"}
    assert by["SSL/TLS: HSTS Missing"]["urls"] == ["34.101.130.148:443/tcp", "34.101.130.148:80/tcp"]
    assert by["Traceroute"]["urls"] == ["34.101.130.148"]


def test_info_issues_are_a_compact_table_not_detail_blocks():
    f = [finding(1, "SQL Injection", "High", 89), finding(2, "Services_1.2.3.4_22/tcp", "Info", 0, tool="OpenVAS Parser", urls=[])]
    html = report.render_html(report.build_context(scan=SCAN, findings=f))
    assert 'class="finding" id="F-001"' in html and 'class="finding" id="F-002"' not in html
    assert "Informational observations (1)" in html and "1.2.3.4:22/tcp" in html
