"""Uploaded API definitions: OpenAPI/Swagger and Postman collections.

parse()    -> summary shown to the user before a scan can start
prepare()  -> the file actually handed to the scanners: base URL replaced by the
              target's, variables resolved, excluded operations removed
coverage() -> which endpoints of the definition were really reached
"""
from __future__ import annotations

import copy
import json
import re
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any
from urllib.parse import urlsplit

import yaml

from .allowlist import host_allowed

HTTP_METHODS = ("get", "put", "post", "delete", "patch", "head", "options")
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
LOOPBACK = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}
VAR_RE = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")


class ApiDefError(ValueError):
    """The upload cannot be used; the message says why."""


@dataclass
class Endpoint:
    method: str
    path: str  # path relative to the host; may contain {param} templates
    name: str = ""

    @property
    def key(self) -> str:
        return f"{self.method} {self.path}"


@dataclass
class Summary:
    kind: str  # openapi | postman
    version: str
    title: str
    endpoints: list[Endpoint] = field(default_factory=list)
    servers: list[str] = field(default_factory=list)
    variables: dict[str, str | None] = field(default_factory=dict)  # name -> default (None = no value)
    unresolved: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    has_auth: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def methods(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for e in self.endpoints:
            out[e.method] = out.get(e.method, 0) + 1
        return out


# --------------------------------------------------------------------------- loading


def load(data: bytes) -> dict[str, Any]:
    text = data.decode("utf-8-sig", errors="replace")
    try:
        doc = json.loads(text)
    except json.JSONDecodeError:
        try:
            doc = yaml.safe_load(text)
        except yaml.YAMLError as exc:
            raise ApiDefError(f"File is neither valid JSON nor valid YAML: {exc}") from exc
    if not isinstance(doc, dict):
        raise ApiDefError("File does not contain an API definition (expected an object at the top level)")
    return doc


def detect(doc: dict[str, Any]) -> str:
    if "openapi" in doc or "swagger" in doc:
        return "openapi"
    info = doc.get("info") if isinstance(doc.get("info"), dict) else {}
    if "item" in doc and ("_postman_id" in info or "getpostman.com" in str(info.get("schema", ""))):
        return "postman"
    if "values" in doc and "item" not in doc:
        raise ApiDefError("This looks like a Postman environment file. Upload it in the environment field, not as the collection.")
    raise ApiDefError("Unrecognised format. Supported: Swagger 2.0, OpenAPI 3.0/3.1, Postman collection v2.0/v2.1.")


def parse(data: bytes, allowed_domains: list[str], env_data: bytes | None = None,
          overrides: dict[str, str] | None = None) -> Summary:
    doc = load(data)
    kind = detect(doc)
    if kind == "openapi":
        return _openapi_summary(doc, allowed_domains, overrides or {})
    return _postman_summary(doc, allowed_domains, postman_env(env_data), overrides or {})


# --------------------------------------------------------------------------- OpenAPI


def _openapi_servers(doc: dict[str, Any]) -> list[str]:
    servers: list[str] = []
    if "swagger" in doc:
        host = doc.get("host")
        if host:
            scheme = (doc.get("schemes") or ["https"])[0]
            servers.append(f"{scheme}://{host}{doc.get('basePath', '')}")
        elif doc.get("basePath"):
            servers.append(doc["basePath"])
        return servers

    def collect(node: Any) -> None:
        for s in (node.get("servers") or []) if isinstance(node, dict) else []:
            if isinstance(s, dict) and s.get("url"):
                url = s["url"]
                for name, var in (s.get("variables") or {}).items():
                    url = url.replace("{" + name + "}", str((var or {}).get("default", "")))
                servers.append(url)

    collect(doc)
    for item in (doc.get("paths") or {}).values():
        collect(item)
        if isinstance(item, dict):
            for m in HTTP_METHODS:
                collect(item.get(m))
    return list(dict.fromkeys(servers))


def _check_servers(servers: list[str], allowed_domains: list[str]) -> list[str]:
    """Server URLs are replaced by the target's base URL, but a definition that
    names a foreign host is refused outright rather than silently rewritten."""
    notes = []
    for url in servers:
        host = urlsplit(url).hostname if "://" in url else None
        if host is None:
            continue  # relative server such as "/api/v1"
        if host.lower() in LOOPBACK:
            notes.append(f"Server {url} is a local address and will be replaced by the target's base URL.")
        elif not host_allowed(host, allowed_domains):
            raise ApiDefError(
                f"The definition points at {host}, which is not on the allowlist. "
                "Remove that server entry or upload the definition for an allowed host."
            )
    return notes


def _server_path(doc: dict[str, Any]) -> str:
    if "swagger" in doc:
        return (doc.get("basePath") or "").rstrip("/")
    for s in doc.get("servers") or []:
        url = s.get("url", "") if isinstance(s, dict) else ""
        return (urlsplit(url).path if "://" in url else url).rstrip("/")
    return ""


def _param_default(param: dict[str, Any]) -> str | None:
    schema = param.get("schema") if isinstance(param.get("schema"), dict) else param
    for holder in (param, schema):
        for k in ("example", "x-example", "default"):
            if holder.get(k) is not None:
                return str(holder[k])
    if schema.get("enum"):
        return str(schema["enum"][0])
    return None


def _type_default(param: dict[str, Any]) -> str:
    schema = param.get("schema") if isinstance(param.get("schema"), dict) else param
    t, fmt = schema.get("type"), schema.get("format")
    if t in ("integer", "number"):
        return "1"
    if t == "boolean":
        return "true"
    if fmt == "uuid":
        return "00000000-0000-4000-8000-000000000001"
    if fmt == "date":
        return "2026-01-01"
    if fmt == "date-time":
        return "2026-01-01T00:00:00Z"
    return "test"


def _resolve_ref(doc: dict[str, Any], node: Any) -> Any:
    if isinstance(node, dict) and isinstance(node.get("$ref"), str) and node["$ref"].startswith("#/"):
        cur: Any = doc
        for part in node["$ref"][2:].split("/"):
            cur = cur.get(part.replace("~1", "/").replace("~0", "~"), {}) if isinstance(cur, dict) else {}
        return cur if isinstance(cur, dict) else node
    return node


def _operations(doc: dict[str, Any]):
    for path, item in (doc.get("paths") or {}).items():
        if not isinstance(item, dict):
            continue
        shared = [_resolve_ref(doc, p) for p in item.get("parameters") or []]
        for method in HTTP_METHODS:
            op = item.get(method)
            if isinstance(op, dict):
                params = shared + [_resolve_ref(doc, p) for p in op.get("parameters") or []]
                yield path, method.upper(), op, [p for p in params if isinstance(p, dict)]


def _openapi_summary(doc: dict[str, Any], allowed_domains: list[str], overrides: dict[str, str]) -> Summary:
    version = str(doc.get("openapi") or doc.get("swagger"))
    if not (doc.get("paths") or {}):
        raise ApiDefError("The definition has no paths, so there is nothing to scan.")
    servers = _openapi_servers(doc)
    summary = Summary(
        kind="openapi", version=version,
        title=str((doc.get("info") or {}).get("title", "Untitled API")),
        servers=servers, notes=_check_servers(servers, allowed_domains),
    )
    prefix = _server_path(doc)
    for path, method, op, params in _operations(doc):
        summary.endpoints.append(Endpoint(method, prefix + path, str(op.get("operationId") or op.get("summary") or "")))
        for p in params:
            if p.get("in") in ("path", "query") and p.get("name"):
                name = p["name"]
                if name in overrides:
                    summary.variables[name] = overrides[name]
                elif name not in summary.variables or summary.variables[name] is None:
                    summary.variables[name] = _param_default(p)
    summary.has_auth = bool(doc.get("security") or doc.get("securityDefinitions")
                            or (doc.get("components") or {}).get("securitySchemes"))
    if summary.has_auth:
        summary.notes.append("The definition declares security schemes; set a login profile on the target so requests are authenticated.")
    return summary


def prepare_openapi(doc: dict[str, Any], base_url: str, overrides: dict[str, str],
                    excluded: set[str]) -> tuple[dict[str, Any], list[Endpoint], list[str]]:
    """Returns (rewritten definition, endpoints kept, concrete GET URLs for Nuclei)."""
    out = copy.deepcopy(doc)
    base = urlsplit(base_url)
    prefix = _server_path(out)
    origin = f"{base.scheme}://{base.netloc}"
    if "swagger" in out:
        out["host"], out["schemes"] = base.netloc, [base.scheme]
    else:
        out["servers"] = [{"url": origin + prefix}]

    kept: list[Endpoint] = []
    urls: list[str] = []
    for path, item in list((out.get("paths") or {}).items()):
        if not isinstance(item, dict):
            continue
        item.pop("servers", None)
        shared = [_resolve_ref(out, p) for p in item.get("parameters") or []]
        for method in HTTP_METHODS:
            op = item.get(method)
            if not isinstance(op, dict):
                continue
            ep = Endpoint(method.upper(), prefix + path, str(op.get("operationId") or op.get("summary") or ""))
            if ep.key in excluded:
                del item[method]
                continue
            op.pop("servers", None)
            params = [p for p in shared + [_resolve_ref(out, p) for p in op.get("parameters") or []] if isinstance(p, dict)]
            values: dict[str, str] = {}
            for p in params:
                name = p.get("name")
                if p.get("in") not in ("path", "query") or not name:
                    continue
                value = overrides.get(name) or _param_default(p) or _type_default(p)
                values[name] = value
                if name in overrides:  # make ZAP use the value the user chose
                    if "swagger" in out:
                        p["x-example"], p["default"] = value, value
                    else:
                        p["example"] = value
                        p.pop("examples", None)
            kept.append(ep)
            if method == "get":
                concrete = re.sub(r"\{([^}]+)\}", lambda m: values.get(m.group(1), "1"), prefix + path)
                query = "&".join(f"{p['name']}={values[p['name']]}" for p in params
                                 if p.get("in") == "query" and p.get("required") and p.get("name") in values)
                urls.append(origin + concrete + (f"?{query}" if query else ""))
        if not any(m in item for m in HTTP_METHODS):
            del out["paths"][path]
    return out, kept, list(dict.fromkeys(urls))


# --------------------------------------------------------------------------- Postman


def postman_env(env_data: bytes | None) -> dict[str, str]:
    if not env_data:
        return {}
    doc = load(env_data)
    values = doc.get("values")
    if values is None and isinstance(doc.get("environment"), dict):
        values = doc["environment"].get("values")
    if not isinstance(values, list):
        raise ApiDefError("The environment file has no 'values' list; export it from Postman as an environment.")
    return {str(v["key"]): str(v.get("value", "")) for v in values
            if isinstance(v, dict) and v.get("key") and v.get("enabled", True)}


_DYNAMIC = {
    "$guid": lambda: str(uuid.uuid4()), "$randomUUID": lambda: str(uuid.uuid4()),
    "$timestamp": lambda: "1767225600", "$isoTimestamp": lambda: "2026-01-01T00:00:00.000Z",
    "$randomInt": lambda: "1", "$randomEmail": lambda: "va-scan@example.invalid",
}


def _subst(text: Any, variables: dict[str, str], missing: set[str]) -> Any:
    if not isinstance(text, str):
        return text

    def repl(m: re.Match[str]) -> str:
        name = m.group(1)
        if name.startswith("$"):
            return _DYNAMIC.get(name, lambda: "1")()
        if name in variables and variables[name] != "":
            return variables[name]
        missing.add(name)
        return m.group(0)

    for _ in range(5):  # variables may reference other variables
        new = VAR_RE.sub(repl, text)
        if new == text:
            break
        text = new
    return text


def _collection_vars(doc: dict[str, Any]) -> dict[str, str]:
    return {str(v["key"]): str(v.get("value", "")) for v in doc.get("variable") or []
            if isinstance(v, dict) and v.get("key") and not v.get("disabled")}


def _walk_items(items: list[Any], folder: str = ""):
    for it in items or []:
        if not isinstance(it, dict):
            continue
        name = f"{folder}/{it.get('name', '')}".strip("/")
        if isinstance(it.get("item"), list):
            yield from _walk_items(it["item"], name)
        elif "request" in it:
            yield it, name


def _raw_url(request: Any) -> str:
    if isinstance(request, str):
        return request
    url = request.get("url")
    if isinstance(url, str):
        return url
    if isinstance(url, dict):
        if url.get("raw"):
            return str(url["raw"])
        host = ".".join(url.get("host") or []) if isinstance(url.get("host"), list) else str(url.get("host", ""))
        path = "/".join(str(p) for p in url.get("path") or [])
        proto = url.get("protocol", "https")
        return f"{proto}://{host}/{path}"
    return ""


def _path_vars(request: Any) -> dict[str, str]:
    url = request.get("url") if isinstance(request, dict) else None
    if isinstance(url, dict):
        return {str(v["key"]): str(v.get("value") or "") for v in url.get("variable") or []
                if isinstance(v, dict) and v.get("key")}
    return {}


def _auth_headers(auth: Any, variables: dict[str, str], missing: set[str]) -> dict[str, str]:
    if not isinstance(auth, dict):
        return {}

    def fields(kind: str) -> dict[str, str]:
        raw = auth.get(kind)
        if isinstance(raw, list):
            return {str(x.get("key")): _subst(str(x.get("value", "")), variables, missing) for x in raw if isinstance(x, dict)}
        if isinstance(raw, dict):
            return {k: _subst(str(v), variables, missing) for k, v in raw.items()}
        return {}

    kind = auth.get("type")
    if kind == "bearer":
        token = fields("bearer").get("token", "")
        return {"Authorization": f"Bearer {token}"} if token else {}
    if kind == "apikey":
        f = fields("apikey")
        if f.get("in", "header") == "header" and f.get("key"):
            return {f["key"]: f.get("value", "")}
    if kind == "basic":
        import base64
        f = fields("basic")
        if f.get("username"):
            raw = f"{f['username']}:{f.get('password', '')}".encode()
            return {"Authorization": "Basic " + base64.b64encode(raw).decode()}
    return {}


def _postman_version(doc: dict[str, Any]) -> str:
    schema = str((doc.get("info") or {}).get("schema", ""))
    m = re.search(r"v(\d+\.\d+)", schema)
    version = m.group(1) if m else ""
    if version not in ("2.0", "2.1"):
        raise ApiDefError("Only Postman collection v2.0 and v2.1 are supported. In Postman choose Export > Collection v2.1.")
    return version


def _concrete_path(raw: str, path_vars: dict[str, str], overrides: dict[str, str]) -> tuple[str, str]:
    """Split a resolved request URL into (host, path) with :params filled in."""
    if "://" not in raw:
        raw = "https://" + raw.lstrip("/")
    parts = urlsplit(raw)

    def fill(seg: str) -> str:
        if seg.startswith(":") and len(seg) > 1:
            return overrides.get(seg[1:]) or path_vars.get(seg[1:]) or "1"
        return seg

    path = "/".join(fill(s) for s in parts.path.split("/")) or "/"
    return (parts.hostname or "").lower(), path + (f"?{parts.query}" if parts.query else "")


def _postman_summary(doc: dict[str, Any], allowed_domains: list[str], env: dict[str, str],
                     overrides: dict[str, str]) -> Summary:
    version = _postman_version(doc)
    variables = {**_collection_vars(doc), **env, **overrides}
    missing: set[str] = set()
    summary = Summary(kind="postman", version=version, title=str((doc.get("info") or {}).get("name", "Untitled collection")))
    hosts: set[str] = set()
    for item, name in _walk_items(doc.get("item") or []):
        request = item["request"]
        method = "GET" if isinstance(request, str) else str(request.get("method", "GET")).upper()
        raw = _subst(_raw_url(request), variables, missing)
        if not raw:
            summary.notes.append(f"Request '{name}' has no URL and is ignored.")
            continue
        if VAR_RE.search(raw.split("/")[0] if "://" not in raw else raw.split("/")[2]):
            summary.endpoints.append(Endpoint(method, raw, name))
            continue  # host is an unresolved variable; reported through `unresolved`
        host, path = _concrete_path(raw, _path_vars(request), overrides)
        if host and host not in LOOPBACK and not host_allowed(host, allowed_domains):
            raise ApiDefError(
                f"Request '{name}' targets {host}, which is not on the allowlist. "
                "Remove it from the collection or point its host variable at an allowed host."
            )
        hosts.add(host)
        summary.endpoints.append(Endpoint(method, path.split("?")[0], name))
        if isinstance(request, dict):
            for h in request.get("header") or []:
                if isinstance(h, dict) and not h.get("disabled"):
                    _subst(str(h.get("value", "")), variables, missing)
            body = request.get("body") or {}
            if isinstance(body, dict) and body.get("mode") == "raw":
                _subst(body.get("raw", ""), variables, missing)
            if request.get("auth"):
                summary.has_auth = True
                _auth_headers(request["auth"], variables, missing)
    if doc.get("auth"):
        summary.has_auth = True
        _auth_headers(doc["auth"], variables, missing)
    if not summary.endpoints:
        raise ApiDefError("The collection contains no requests, so there is nothing to scan.")
    summary.servers = sorted(h for h in hosts if h)
    declared = {**_collection_vars(doc), **env}
    summary.variables = {k: (variables.get(k) or None) for k in sorted(set(declared) | missing)}
    summary.unresolved = sorted(missing)
    if summary.has_auth:
        summary.notes.append("The collection carries its own auth. A login profile on the target takes precedence over it.")
    return summary


def prepare_postman(doc: dict[str, Any], base_url: str, env: dict[str, str], overrides: dict[str, str],
                    excluded: set[str]) -> tuple[dict[str, Any], list[Endpoint], list[str], dict[str, str], list[str]]:
    """Returns (resolved collection, endpoints kept, GET URLs, collection auth headers, skipped notes)."""
    variables = {**_collection_vars(doc), **env, **overrides}
    base = urlsplit(base_url)
    target_host = (base.hostname or "").lower()
    origin = f"{base.scheme}://{base.netloc}"
    missing: set[str] = set()
    kept: list[Endpoint] = []
    urls: list[str] = []
    skipped: list[str] = []

    def resolve(node: Any) -> Any:
        if isinstance(node, str):
            return _subst(node, variables, missing)
        if isinstance(node, list):
            return [resolve(x) for x in node]
        if isinstance(node, dict):
            return {k: resolve(v) for k, v in node.items()}
        return node

    def rebuild(items: list[Any], folder: str = "") -> list[Any]:
        out = []
        for it in items or []:
            if not isinstance(it, dict):
                continue
            name = f"{folder}/{it.get('name', '')}".strip("/")
            if isinstance(it.get("item"), list):
                children = rebuild(it["item"], name)
                if children:
                    out.append({**{k: v for k, v in it.items() if k != "item"}, "item": children})
                continue
            if "request" not in it:
                continue
            request = it["request"]
            method = "GET" if isinstance(request, str) else str(request.get("method", "GET")).upper()
            raw = _subst(_raw_url(request), variables, missing)
            host, path = _concrete_path(raw, _path_vars(request), overrides)
            ep = Endpoint(method, path.split("?")[0], name)
            if ep.key in excluded:
                continue
            if host in LOOPBACK:
                host = target_host
            if host != target_host:
                skipped.append(f"{method} {raw} (different host than the target)")
                continue
            full = origin + path
            new_req = resolve(request) if isinstance(request, dict) else {"method": "GET"}
            new_req["url"] = full  # string form is valid in v2.0 and v2.1
            out.append({**{k: resolve(v) for k, v in it.items() if k not in ("request", "event")}, "request": new_req})
            kept.append(ep)
            if method == "GET":
                urls.append(full)
        return out

    resolved = {k: v for k, v in doc.items() if k not in ("item", "variable", "event")}
    resolved["item"] = rebuild(doc.get("item") or [])
    resolved["variable"] = []
    headers = _auth_headers(doc.get("auth"), variables, missing)
    if doc.get("auth"):
        resolved["auth"] = resolve(doc["auth"])
    if missing:
        raise ApiDefError("These variables have no value: " + ", ".join(sorted(missing))
                          + ". Set them in the variables form or upload the Postman environment file.")
    if not kept:
        raise ApiDefError("No request in the collection targets this target's host after exclusions.")
    return resolved, kept, list(dict.fromkeys(urls)), headers, skipped


# --------------------------------------------------------------------------- shared


@dataclass
class Prepared:
    kind: str
    filename: str
    content: str
    endpoints: list[Endpoint]
    urls: list[str]
    headers: dict[str, str] = field(default_factory=dict)
    skipped: list[str] = field(default_factory=list)


def prepare(data: bytes, base_url: str, allowed_domains: list[str], env_data: bytes | None = None,
            overrides: dict[str, str] | None = None, excluded: set[str] | None = None) -> Prepared:
    overrides, excluded = overrides or {}, excluded or set()
    summary = parse(data, allowed_domains, env_data, overrides)  # re-validates allowlist and variables
    doc = load(data)
    if summary.kind == "openapi":
        out, kept, urls = prepare_openapi(doc, base_url, overrides, excluded)
        if not kept:
            raise ApiDefError("Every operation in the definition is excluded; nothing left to scan.")
        return Prepared("openapi", "openapi.json", json.dumps(out, indent=1), kept, urls)
    if summary.unresolved:
        raise ApiDefError("These variables have no value: " + ", ".join(summary.unresolved)
                          + ". Set them in the variables form or upload the Postman environment file.")
    out, kept, urls, headers, skipped = prepare_postman(doc, base_url, postman_env(env_data), overrides, excluded)
    return Prepared("postman", "postman.json", json.dumps(out, indent=1), kept, urls, headers, skipped)


def default_exclusions(endpoints: list[Endpoint], environment: str) -> set[str]:
    """Production: no state-changing requests unless the user ticks them back in."""
    if environment == "prod":
        return {e.key for e in endpoints if e.method in WRITE_METHODS}
    return set()


def _path_regex(path: str) -> re.Pattern[str]:
    escaped = re.escape(path.split("?")[0].rstrip("/") or "/")
    escaped = re.sub(r"\\\{[^/]+?\\\}", r"[^/]+", escaped)
    return re.compile("^" + escaped + "/?$")


def classify(status: int | None) -> str:
    if status is None:
        return "not requested"
    if status in (401, 403):
        return "unauthorised"
    if status == 404:
        return "not found"
    if status >= 500:
        return "server error"
    if 200 <= status < 400:
        return "reached"
    return f"rejected ({status})"


def coverage(endpoints: list[Endpoint], requests_seen: list[tuple[str, str, int]],
             excluded: set[str] | None = None, all_endpoints: list[Endpoint] | None = None) -> list[dict[str, Any]]:
    """requests_seen: (method, url, status) taken from the scanner's request history
    before the attack phase. An endpoint counts by its best response."""
    rank = {"reached": 0, "unauthorised": 1, "server error": 2, "not found": 3}
    rows = []
    for ep in endpoints:
        rx = _path_regex(ep.path)
        best: int | None = None
        for method, url, status in requests_seen:
            if method.upper() != ep.method or not rx.match(urlsplit(url).path.rstrip("/") or "/"):
                continue
            if best is None or rank.get(classify(status), 4) < rank.get(classify(best), 4):
                best = status
        rows.append({"method": ep.method, "path": ep.path, "name": ep.name, "status": best, "result": classify(best)})
    kept = {e.key for e in endpoints}
    for ep in all_endpoints or []:
        if ep.key not in kept and ep.key in (excluded or set()):
            rows.append({"method": ep.method, "path": ep.path, "name": ep.name, "status": None, "result": "skipped (excluded)"})
    return rows
