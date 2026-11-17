import json

import pytest
import yaml

from app import apidef
from app.apidef import ApiDefError, Endpoint

from .conftest import ALLOWED

BASE = "https://api.dev.apps.example.org"

OPENAPI3 = {
    "openapi": "3.0.3", "info": {"title": "Orders", "version": "1"},
    "servers": [{"url": "https://api.dev.apps.example.org/v1"}],
    "paths": {
        "/orders": {
            "get": {"operationId": "listOrders", "parameters": [
                {"name": "status", "in": "query", "required": True, "schema": {"type": "string", "enum": ["open", "closed"]}}]},
            "post": {"operationId": "createOrder"},
        },
        "/orders/{orderId}": {
            "parameters": [{"name": "orderId", "in": "path", "required": True, "schema": {"type": "integer"}}],
            "get": {"operationId": "getOrder"},
            "delete": {"operationId": "deleteOrder"},
        },
    },
    "components": {"securitySchemes": {"bearer": {"type": "http", "scheme": "bearer"}}},
}
SWAGGER2 = {
    "swagger": "2.0", "info": {"title": "Legacy", "version": "1"}, "host": "localhost:8080", "basePath": "/api",
    "schemes": ["http"],
    "paths": {"/ping": {"get": {"summary": "ping"}},
              "/users/{id}": {"get": {"parameters": [{"name": "id", "in": "path", "required": True, "type": "string"}]}}},
}
POSTMAN21 = {
    "info": {"_postman_id": "x", "name": "Shop", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
    "variable": [{"key": "baseUrl", "value": "https://api.dev.apps.example.org"}],
    "auth": {"type": "bearer", "bearer": [{"key": "token", "value": "{{token}}", "type": "string"}]},
    "item": [
        {"name": "Catalog", "item": [
            {"name": "List products", "request": {"method": "GET", "url": {
                "raw": "{{baseUrl}}/products?page=1", "host": ["{{baseUrl}}"], "path": ["products"]}}},
            {"name": "Get product", "request": {"method": "GET", "url": {
                "raw": "{{baseUrl}}/products/:id", "variable": [{"key": "id", "value": "42"}]}}},
        ]},
        {"name": "Create product", "request": {"method": "POST", "header": [{"key": "X-Trace", "value": "{{$guid}}"}],
                                               "body": {"mode": "raw", "raw": "{\"name\": \"{{productName}}\"}"},
                                               "url": "{{baseUrl}}/products"}},
        {"name": "Delete product", "request": {"method": "DELETE", "url": "{{baseUrl}}/products/:id"}},
    ],
}
POSTMAN_ENV = {"name": "dev", "values": [{"key": "token", "value": "tok-123", "enabled": True},
                                         {"key": "productName", "value": "Widget", "enabled": True},
                                         {"key": "unused", "value": "x", "enabled": False}]}


def j(doc):
    return json.dumps(doc).encode()


# ---------------------------------------------------------------- parsing


def test_openapi3_json_and_yaml_give_the_same_summary():
    a = apidef.parse(j(OPENAPI3), ALLOWED)
    b = apidef.parse(yaml.safe_dump(OPENAPI3).encode(), ALLOWED)
    assert a.to_dict() == b.to_dict()
    assert a.kind == "openapi" and a.version == "3.0.3" and a.title == "Orders"
    assert [e.key for e in a.endpoints] == ["GET /v1/orders", "POST /v1/orders", "GET /v1/orders/{orderId}",
                                           "DELETE /v1/orders/{orderId}"]
    assert a.methods == {"GET": 2, "POST": 1, "DELETE": 1}
    assert a.variables == {"status": "open", "orderId": None}
    assert a.has_auth


def test_openapi31_is_accepted():
    doc = {**OPENAPI3, "openapi": "3.1.0"}
    assert apidef.parse(j(doc), ALLOWED).version == "3.1.0"


def test_swagger2_with_local_server_is_accepted_and_noted():
    s = apidef.parse(j(SWAGGER2), ALLOWED)
    assert s.version == "2.0" and [e.key for e in s.endpoints] == ["GET /api/ping", "GET /api/users/{id}"]
    assert any("replaced" in n for n in s.notes)


def test_foreign_server_is_refused():
    doc = {**OPENAPI3, "servers": [{"url": "https://api.thirdparty.com/v1"}]}
    with pytest.raises(ApiDefError, match="thirdparty.com"):
        apidef.parse(j(doc), ALLOWED)
    doc = json.loads(json.dumps(OPENAPI3))
    doc["paths"]["/orders"]["get"]["servers"] = [{"url": "https://evil.com"}]  # operation-level override
    with pytest.raises(ApiDefError, match="evil.com"):
        apidef.parse(j(doc), ALLOWED)


@pytest.mark.parametrize("data,msg", [
    (b"{not json: [", "neither valid JSON nor valid YAML"), (b"[1, 2]", "expected an object"),
    (j({"hello": "world"}), "Unrecognised format"), (j({"openapi": "3.0.0", "paths": {}}), "no paths"),
    (j(POSTMAN_ENV), "environment file"),
])
def test_bad_uploads_are_rejected_with_a_reason(data, msg):
    with pytest.raises(ApiDefError, match=msg):
        apidef.parse(data, ALLOWED)


def test_postman_v21_with_environment():
    s = apidef.parse(j(POSTMAN21), ALLOWED, j(POSTMAN_ENV))
    assert s.kind == "postman" and s.version == "2.1" and s.title == "Shop"
    assert [e.key for e in s.endpoints] == ["GET /products", "GET /products/42", "POST /products", "DELETE /products/1"]
    assert [e.name for e in s.endpoints][:2] == ["Catalog/List products", "Catalog/Get product"]
    assert s.unresolved == [] and s.has_auth
    assert "unused" not in s.variables  # disabled in the environment


def test_postman_unresolved_variables_are_reported_and_block_prepare():
    s = apidef.parse(j(POSTMAN21), ALLOWED)  # no environment file
    assert s.unresolved == ["productName", "token"]
    with pytest.raises(ApiDefError, match="productName, token"):
        apidef.prepare(j(POSTMAN21), BASE, ALLOWED)
    ok = apidef.prepare(j(POSTMAN21), BASE, ALLOWED, overrides={"token": "t", "productName": "p"})
    assert len(ok.endpoints) == 4


def test_postman_v20_string_urls():
    doc = {"info": {"name": "Old", "schema": "https://schema.getpostman.com/json/collection/v2.0.0/collection.json"},
           "item": [{"name": "Ping", "request": {"method": "GET", "url": "https://api.dev.apps.example.org/ping"}},
                    {"name": "Bare", "request": "https://api.dev.apps.example.org/bare"}]}
    s = apidef.parse(j(doc), ALLOWED)
    assert s.version == "2.0" and [e.key for e in s.endpoints] == ["GET /ping", "GET /bare"]


def test_postman_v1_is_refused():
    doc = {"info": {"name": "Old", "schema": "https://schema.getpostman.com/json/collection/v1.0.0/collection.json"},
           "item": [{"name": "x", "request": "https://example.test/"}]}
    with pytest.raises(ApiDefError, match="v2.0 and v2.1"):
        apidef.parse(j(doc), ALLOWED)


def test_postman_request_to_foreign_host_is_refused():
    doc = json.loads(json.dumps(POSTMAN21))
    doc["item"].append({"name": "Leak", "request": {"method": "POST", "url": "https://collector.evil.com/in"}})
    with pytest.raises(ApiDefError, match="collector.evil.com"):
        apidef.parse(j(doc), ALLOWED, j(POSTMAN_ENV))
    doc = json.loads(json.dumps(POSTMAN21))
    doc["variable"] = [{"key": "baseUrl", "value": "https://evil.com"}]  # foreign host hidden in a variable
    with pytest.raises(ApiDefError, match="evil.com"):
        apidef.parse(j(doc), ALLOWED, j(POSTMAN_ENV))


# ---------------------------------------------------------------- prepare


def test_prepare_openapi_rewrites_server_applies_overrides_and_exclusions():
    doc = {**OPENAPI3, "servers": [{"url": "http://localhost:3000/v1"}]}
    p = apidef.prepare(j(doc), BASE, ALLOWED, overrides={"orderId": "77"},
                       excluded={"DELETE /v1/orders/{orderId}", "POST /v1/orders"})
    out = json.loads(p.content)
    assert out["servers"] == [{"url": "https://api.dev.apps.example.org/v1"}]
    assert "delete" not in out["paths"]["/orders/{orderId}"] and "post" not in out["paths"]["/orders"]
    assert [e.key for e in p.endpoints] == ["GET /v1/orders", "GET /v1/orders/{orderId}"]
    assert p.urls == [BASE + "/v1/orders?status=open", BASE + "/v1/orders/77"]
    assert out["paths"]["/orders/{orderId}"]["parameters"][0]["example"] == "77"
    assert "localhost" not in p.content


def test_prepare_swagger2_sets_host_and_scheme():
    p = apidef.prepare(j(SWAGGER2), BASE, ALLOWED)
    out = json.loads(p.content)
    assert out["host"] == "api.dev.apps.example.org" and out["schemes"] == ["https"] and out["basePath"] == "/api"
    assert p.urls == [BASE + "/api/ping", BASE + "/api/users/test"]


def test_prepare_refuses_when_everything_is_excluded():
    with pytest.raises(ApiDefError, match="nothing left"):
        apidef.prepare(j(SWAGGER2), BASE, ALLOWED, excluded={"GET /api/ping", "GET /api/users/{id}"})


def test_prepare_postman_resolves_everything_and_drops_exclusions():
    p = apidef.prepare(j(POSTMAN21), BASE, ALLOWED, j(POSTMAN_ENV), excluded={"DELETE /products/1"})
    assert "{{" not in p.content
    assert [e.key for e in p.endpoints] == ["GET /products", "GET /products/42", "POST /products"]
    assert p.urls == [BASE + "/products?page=1", BASE + "/products/42"]
    assert p.headers == {"Authorization": "Bearer tok-123"}
    out = json.loads(p.content)
    assert out["item"][0]["item"][0]["request"]["url"] == BASE + "/products?page=1"
    assert "Widget" in out["item"][1]["request"]["body"]["raw"]


def test_prepare_postman_skips_other_allowed_hosts_and_moves_local_ones():
    doc = {"info": {"name": "Mixed", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
           "item": [{"name": "Mine", "request": {"method": "GET", "url": "http://localhost:3000/a"}},
                    {"name": "Sibling", "request": {"method": "GET", "url": "https://other.apps.example.org/b"}}]}
    p = apidef.prepare(j(doc), BASE, ALLOWED)
    assert [e.key for e in p.endpoints] == ["GET /a"] and p.urls == [BASE + "/a"]
    assert len(p.skipped) == 1 and "other.apps.example.org" in p.skipped[0]


# ---------------------------------------------------------------- exclusions and coverage


def test_production_excludes_state_changing_requests_by_default():
    eps = apidef.parse(j(OPENAPI3), ALLOWED).endpoints
    assert apidef.default_exclusions(eps, "prod") == {"POST /v1/orders", "DELETE /v1/orders/{orderId}"}
    assert apidef.default_exclusions(eps, "dev") == set()


def test_coverage_matches_templates_and_reports_untested_endpoints():
    all_eps = apidef.parse(j(OPENAPI3), ALLOWED).endpoints
    excluded = {"DELETE /v1/orders/{orderId}"}
    kept = [e for e in all_eps if e.key not in excluded]
    seen = [("GET", BASE + "/v1/orders?status=open", 200), ("GET", BASE + "/v1/orders/77", 401),
            ("GET", BASE + "/v1/orders/78", 404), ("GET", BASE + "/v1/other", 200)]
    rows = {f"{r['method']} {r['path']}": r["result"] for r in apidef.coverage(kept, seen, excluded, all_eps)}
    assert rows == {
        "GET /v1/orders": "reached",
        "POST /v1/orders": "not requested",
        "GET /v1/orders/{orderId}": "unauthorised",  # best response of the two wins
        "DELETE /v1/orders/{orderId}": "skipped (excluded)",
    }


def test_coverage_does_not_confuse_prefixes_or_methods():
    rows = apidef.coverage([Endpoint("GET", "/users"), Endpoint("POST", "/users")],
                           [("GET", "https://x.example.test/users/5", 200), ("GET", "https://x.example.test/users/", 500)])
    assert [r["result"] for r in rows] == ["server error", "not requested"]
