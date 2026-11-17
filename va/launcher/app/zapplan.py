"""Builds the ZAP Automation Framework plan for one scan."""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit

import yaml

WORK = "/zap/wrk"
CONTEXT = "target"
USER = "va-user"

PROFILES: dict[str, dict[str, Any]] = {
    # No attack payloads. The crawler still follows links and clicks buttons like a visitor,
    # but it does not submit forms.
    "passive": {"spider_min": 10, "ajax_min": 5, "post_forms": False, "active": False},
    "standard": {"spider_min": 15, "ajax_min": 10, "post_forms": True, "active": True,
                 "active_min": 60, "strength": "medium", "threshold": "medium"},
    "deep": {"spider_min": 30, "ajax_min": 30, "post_forms": True, "active": True,
             "active_min": 240, "strength": "high", "threshold": "low"},
}

LOGOUT_PATTERNS = [r".*[Ll]ogout.*", r".*[Ss]ign[-_]?[Oo]ut.*", r".*/oauth2/sign_out.*"]


def origin_of(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


def scope_regex(origin: str) -> str:
    """Matches URLs on exactly this origin. The separator is required so that
    https://app.example.org.evil.com does not count as https://app.example.org."""
    return re.escape(origin) + "([/?#].*)?"


def _authentication(auth_type: str, cfg: dict[str, Any]) -> dict[str, Any] | None:
    verification: dict[str, Any] = {"method": "autodetect"}
    if cfg.get("logged_in_regex"):
        verification = {"method": "response", "loggedInRegex": cfg["logged_in_regex"]}
    if auth_type == "form":
        body = f"{cfg['username_field']}={{%username%}}&{cfg['password_field']}={{%password%}}"
        if cfg.get("extra"):
            body += "&" + cfg["extra"].lstrip("&")
        return {"method": "form",
                "parameters": {"loginPageUrl": cfg["login_url"], "loginRequestUrl": cfg["login_url"],
                               "loginRequestBody": body},
                "verification": verification}
    if auth_type == "browser":
        return {"method": "browser",
                "parameters": {"loginPageUrl": cfg["login_url"], "loginPageWait": 10, "browserId": "firefox-headless"},
                "verification": verification}
    if auth_type == "script":
        return {"method": "script",
                "parameters": {"script": f"{WORK}/auth-script", "scriptEngine": cfg.get("script_engine") or "Graal.js"},
                "verification": verification}
    return None


def build_plan(*, target_url: str, profile: str, auth_type: str = "none", auth_cfg: dict[str, Any] | None = None,
               headers: dict[str, str] | None = None, apidef_kind: str = "", apidef_file: str = "",
               graphql_endpoint: str = "", graphql_schema_url: str = "") -> dict[str, Any]:
    if profile not in PROFILES:
        raise ValueError(f"Unknown profile {profile!r}")
    p = PROFILES[profile]
    auth_cfg, headers = auth_cfg or {}, headers or {}
    origin = origin_of(target_url)

    context: dict[str, Any] = {
        "name": CONTEXT,
        "urls": [target_url],
        # Only the target host is in scope, so redirects to other hosts are never crawled or attacked.
        "includePaths": [scope_regex(origin)],
        "excludePaths": LOGOUT_PATTERNS,
    }
    authentication = _authentication(auth_type, auth_cfg)
    user = None
    if authentication:
        user = USER
        context["authentication"] = authentication
        context["sessionManagement"] = {"method": "autodetect" if auth_type == "browser" else "cookie"}
        context["users"] = [{"name": USER, "credentials": {"username": auth_cfg["username"],
                                                             "password": auth_cfg["password"]}}]

    def scoped(params: dict[str, Any]) -> dict[str, Any]:
        params = {"context": CONTEXT, **params}
        if user:
            params["user"] = user
        return params

    jobs: list[dict[str, Any]] = [
        {"type": "passiveScan-config", "parameters": {"maxAlertsPerRule": 10, "scanOnlyInScope": True}},
    ]
    if headers:
        jobs.append({
            "type": "replacer", "parameters": {"deleteAllRules": True},
            "rules": [{"description": f"va-header-{i}", "url": scope_regex(origin), "matchType": "req_header",
                       "matchString": name, "matchRegex": False, "replacementString": value}
                      for i, (name, value) in enumerate(headers.items())],
        })
    if apidef_kind == "openapi":
        jobs.append({"type": "openapi", "parameters": scoped({"apiFile": f"{WORK}/{apidef_file}", "targetUrl": origin})})
    elif apidef_kind == "postman":
        jobs.append({"type": "postman", "parameters": {"collectionFile": f"{WORK}/{apidef_file}"}})
    if graphql_endpoint:
        params = {"endpoint": graphql_endpoint}
        if graphql_schema_url:
            params["schemaUrl"] = graphql_schema_url
        jobs.append({"type": "graphql", "parameters": params})

    spider: dict[str, Any] = {"type": "spider", "parameters": scoped(
        {"url": target_url, "maxDuration": p["spider_min"], "postForm": p["post_forms"],
         "processForm": p["post_forms"]})}
    if user:
        # Surfaced in the ZAP log; the launcher reads it for the report's login check.
        spider["tests"] = [{"name": "login-check", "type": "stats", "statistic": "stats.auth.success",
                            "operator": ">=", "value": 1, "onFail": "warn"}]
    jobs.append(spider)
    jobs.append({"type": "spiderAjax", "parameters": scoped(
        {"url": target_url, "maxDuration": p["ajax_min"], "browserId": "firefox-headless"})})
    jobs.append({"type": "passiveScan-wait", "parameters": {"maxDuration": 15}})
    # Request history before the attack phase = what was really reached (report coverage section).
    # source "all": "history" leaves out the crawlers' own requests.
    jobs.append({"type": "export", "parameters": {"context": CONTEXT, "type": "har", "source": "all",
                                                   "fileName": f"{WORK}/history.har"}})
    if p["active"]:
        jobs.append({
            "type": "activeScan",
            "parameters": scoped({"maxScanDurationInMins": p["active_min"], "maxRuleDurationInMins": 10}),
            "policyDefinition": {"defaultStrength": p["strength"], "defaultThreshold": p["threshold"]},
        })
        jobs.append({"type": "passiveScan-wait", "parameters": {"maxDuration": 10}})
    jobs.append({"type": "report", "parameters": {"template": "traditional-xml", "reportDir": WORK,
                                                   "reportFile": "zap-report"}})
    return {"env": {"contexts": [context],
                    "parameters": {"failOnError": False, "failOnWarning": False, "progressToStdout": True}},
            "jobs": jobs}


def dump(plan: dict[str, Any]) -> str:
    return yaml.safe_dump(plan, sort_keys=False, allow_unicode=True)
