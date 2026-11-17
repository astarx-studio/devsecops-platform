"""VA launcher web app: targets, scans, reports, manual."""
from __future__ import annotations

import hmac
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import markdown
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select

from . import apidef, auth, cdn, dockerrun, gvm, pipeline
from .allowlist import NotAllowed, check_url
from .config import settings
from .crypto import decrypt_json, encrypt_json, read_secret_file, write_secret_file
from .db import Scan, SessionLocal, Target, init_db
from .dojo import Dojo

MAX_UPLOAD = 20 * 1024 * 1024
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
templates.env.globals.update(AUTH_TYPES=auth.AUTH_TYPES, AUTH_FIELDS=auth.FIELDS, TOOLS=pipeline.TOOLS,
                             PROFILES=pipeline.PROFILE_LABELS, ENVS=pipeline.ENV_LABELS,
                             STATUS=pipeline.STATUS_LABELS, fmt=pipeline.fmt, cfg=settings)
_stop = threading.Event()


def storage_problem() -> str:
    """The data dir must be the junction-backed mount; setup-storage.ps1 leaves a marker there."""
    if settings.require_storage_marker and not (settings.data_dir / ".va-storage").exists():
        return (f"{settings.data_dir} has no .va-storage marker. Run va/setup-storage.ps1 on the host so scan data "
                "is stored on the intended drive, then restart the launcher.")
    return ""


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    for sub in ("scans", "reports", "uploads", "cache"):
        (settings.data_dir / sub).mkdir(parents=True, exist_ok=True)
    if not storage_problem():
        threading.Thread(target=pipeline.worker_loop, args=(_stop,), daemon=True, name="va-worker").start()
    yield
    _stop.set()


app = FastAPI(title="VA launcher", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def only_through_traefik(request: Request, call_next):
    """The launcher holds the Docker socket and has no login of its own: Traefik's SSO
    check is the only gate. Any container on devops-network could otherwise call it
    directly, so require the secret header Traefik adds after the SSO check."""
    if settings.proxy_secret and request.url.path != "/healthz":
        given = request.headers.get(settings.proxy_secret_header, "")
        if not hmac.compare_digest(given.encode(), settings.proxy_secret.encode()):
            return HTMLResponse("Use https://" + (settings.public_url.split("://")[-1] or "the VA address") + ".",
                                status_code=403)
    return await call_next(request)


@app.middleware("http")
async def same_origin_posts(request: Request, call_next):
    """The app sits behind SSO; refuse form posts that come from another site."""
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin") or request.headers.get("referer") or ""
        host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
        if not origin or (urlsplit(origin).netloc or "").lower() != host.lower():
            return HTMLResponse("Cross-site request refused.", status_code=403)
    return await call_next(request)


def user_of(request: Request) -> str:
    return request.headers.get(settings.user_header, "")


def page(request: Request, name: str, **ctx: Any) -> HTMLResponse:
    return templates.TemplateResponse(request, name, {"user": user_of(request), "storage_problem": storage_problem(), **ctx})


def get_target(s, target_id: int) -> Target:
    target = s.get(Target, target_id)
    if not target:
        raise HTTPException(404, "Target not found")
    return target


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


# ------------------------------------------------------------------ dashboard


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    with SessionLocal() as s:
        scans = s.scalars(select(Scan).order_by(Scan.id.desc()).limit(50)).all()
        for sc in scans:
            _ = sc.target.name
        targets = s.scalars(select(Target).order_by(Target.name)).all()
        return page(request, "home.html", scans=scans, targets=targets, feeds=gvm.feed_status(),
                    dojo_ready=Dojo().ready())


@app.get("/help", response_class=HTMLResponse)
def help_page(request: Request):
    manual = settings.manual_dir / "index.md"
    text = manual.read_text(encoding="utf-8") if manual.exists() else "The user manual is not mounted in this container."
    html = markdown.markdown(text, extensions=["tables", "fenced_code", "toc"])
    return page(request, "help.html", manual=html)


# ------------------------------------------------------------------ targets


@app.get("/targets", response_class=HTMLResponse)
def targets_list(request: Request):
    with SessionLocal() as s:
        return page(request, "targets.html", targets=s.scalars(select(Target).order_by(Target.name)).all())


@app.get("/targets/new", response_class=HTMLResponse)
def target_new(request: Request):
    return page(request, "target_form.html", target=None, error="")


@app.post("/targets/new")
def target_create(request: Request, name: str = Form(...), base_url: str = Form(...), environment: str = Form("dev"),
                  image_ref: str = Form(""), graphql_path: str = Form("")):
    try:
        base_url = check_url(base_url, settings.allowed_domains)
        if environment not in pipeline.ENV_LABELS:
            raise NotAllowed("Unknown environment")
    except NotAllowed as exc:
        return page(request, "target_form.html", target=None, error=str(exc))
    with SessionLocal() as s:
        if s.scalars(select(Target).where(Target.name == name.strip())).first():
            return page(request, "target_form.html", target=None, error="A target with this name already exists.")
        target = Target(name=name.strip(), base_url=base_url, environment=environment, image_ref=image_ref.strip(),
                        graphql_path=graphql_path.strip())
        s.add(target)
        s.commit()
        return RedirectResponse(f"/targets/{target.id}", 303)


def target_view(request: Request, s, target: Target, error: str = "", notice: str = "") -> HTMLResponse:
    auth_cfg = decrypt_json(target.auth_config_enc) if target.auth_config_enc else {}
    shown = {k: ("" if auth.FIELDS.get(target.auth_type, {}).get(k, ("", False))[1] else v) for k, v in auth_cfg.items()}
    overrides = decrypt_json(target.apidef_vars_enc) if target.apidef_vars_enc else {}
    return page(request, "target.html", target=target, auth_cfg=shown, auth_set=bool(auth_cfg), overrides=overrides,
                summary=target.apidef_summary or {}, excluded=set(target.apidef_excluded or []), error=error,
                notice=notice, write_methods=apidef.WRITE_METHODS)


@app.get("/targets/{target_id}", response_class=HTMLResponse)
def target_show(request: Request, target_id: int):
    with SessionLocal() as s:
        return target_view(request, s, get_target(s, target_id))


@app.post("/targets/{target_id}")
def target_update(request: Request, target_id: int, base_url: str = Form(...), environment: str = Form("dev"),
                  image_ref: str = Form(""), graphql_path: str = Form(""), gvm_host: str = Form("")):
    with SessionLocal() as s:
        target = get_target(s, target_id)
        try:
            target.base_url = check_url(base_url, settings.allowed_domains)
            target.gvm_host = cdn.check_override(gvm_host)
        except (NotAllowed, cdn.HostNotScannable) as exc:
            s.rollback()
            return target_view(request, s, s.get(Target, target_id), error=str(exc))
        target.environment = environment if environment in pipeline.ENV_LABELS else target.environment
        target.image_ref, target.graphql_path = image_ref.strip(), graphql_path.strip()
        s.commit()
        return target_view(request, s, target, notice="Target saved.")


@app.post("/targets/{target_id}/delete")
def target_delete(target_id: int):
    with SessionLocal() as s:
        s.delete(get_target(s, target_id))
        s.commit()
    return RedirectResponse("/targets", 303)


@app.post("/targets/{target_id}/auth")
async def target_auth(request: Request, target_id: int, script: UploadFile | None = File(None)):
    form = await request.form()
    auth_type = str(form.get("auth_type", "none"))
    with SessionLocal() as s:
        target = get_target(s, target_id)
        old = decrypt_json(target.auth_config_enc) if target.auth_config_enc and target.auth_type == auth_type else {}
        cfg: dict[str, Any] = {}
        for field, (_, secret) in auth.FIELDS.get(auth_type, {}).items():
            value = str(form.get(f"{auth_type}__{field}", "")).strip()
            cfg[field] = value or (old.get(field, "") if secret else "")  # blank secret = keep the stored one
        if auth_type == "script":
            cfg["script_file"] = old.get("script_file", "")
            if script is not None and script.filename:
                data = await script.read()
                if len(data) > 1024 * 1024:
                    return target_view(request, s, target, error="The script is larger than 1 MB.")
                rel = f"uploads/target-{target.id}-auth-script"
                write_secret_file(settings.data_dir / rel, data)
                cfg["script_file"] = rel
        try:
            auth.validate(auth_type, cfg)
        except (auth.AuthError, NotAllowed) as exc:
            return target_view(request, s, target, error=str(exc))
        target.auth_type = auth_type
        target.auth_config_enc = encrypt_json(cfg) if auth_type != "none" else ""
        s.commit()
        return target_view(request, s, target, notice="Login profile saved.")


def stored_summary(summary: apidef.Summary) -> dict[str, Any]:
    """Variable values can be tokens; keep only whether each one has a value."""
    data = summary.to_dict()
    data["variables"] = {name: value not in (None, "") for name, value in summary.variables.items()}
    return data


def _reparse(target: Target, overrides: dict[str, str]) -> apidef.Summary:
    raw = read_secret_file(settings.data_dir / target.apidef_file)
    env_raw = read_secret_file(settings.data_dir / target.apidef_env_file) if target.apidef_env_file else None
    return apidef.parse(raw, settings.allowed_domains, env_raw, overrides)


@app.post("/targets/{target_id}/apidef")
async def target_apidef(request: Request, target_id: int, definition: UploadFile = File(...),
                        environment_file: UploadFile | None = File(None)):
    with SessionLocal() as s:
        target = get_target(s, target_id)
        data = await definition.read()
        env_data = await environment_file.read() if environment_file is not None and environment_file.filename else None
        if len(data) > MAX_UPLOAD or (env_data and len(env_data) > MAX_UPLOAD):
            return target_view(request, s, target, error="The file is larger than 20 MB.")
        try:
            summary = apidef.parse(data, settings.allowed_domains, env_data, {})
        except apidef.ApiDefError as exc:
            return target_view(request, s, target, error=f"The file was not accepted: {exc}")
        rel = f"uploads/target-{target.id}-apidef"
        write_secret_file(settings.data_dir / rel, data)
        target.apidef_file, target.apidef_kind = rel, summary.kind
        target.apidef_env_file = ""
        if env_data:
            target.apidef_env_file = rel + "-env"
            write_secret_file(settings.data_dir / target.apidef_env_file, env_data)
        target.apidef_summary = stored_summary(summary)
        target.apidef_vars_enc = ""
        target.apidef_excluded = sorted(apidef.default_exclusions(summary.endpoints, target.environment))
        s.commit()
        return target_view(request, s, target, notice=f"Definition accepted: {len(summary.endpoints)} endpoints found.")


@app.post("/targets/{target_id}/apidef/settings")
async def target_apidef_settings(request: Request, target_id: int):
    form = await request.form()
    with SessionLocal() as s:
        target = get_target(s, target_id)
        if not target.apidef_file:
            raise HTTPException(400, "No API definition uploaded")
        old = decrypt_json(target.apidef_vars_enc) if target.apidef_vars_enc else {}
        overrides = dict(old)
        for key, value in form.multi_items():
            if key.startswith("var__"):
                name, value = key[5:], str(value).strip()
                if value:
                    overrides[name] = value
                elif form.get(f"clear__{name}"):
                    overrides.pop(name, None)
        included = {str(v) for k, v in form.multi_items() if k == "include"}
        try:
            summary = _reparse(target, overrides)
        except apidef.ApiDefError as exc:
            return target_view(request, s, target, error=str(exc))
        target.apidef_vars_enc = encrypt_json(overrides) if overrides else ""
        target.apidef_summary = stored_summary(summary)
        target.apidef_excluded = sorted(e.key for e in summary.endpoints if e.key not in included)
        s.commit()
        return target_view(request, s, target, notice="Variables and endpoint selection saved.")


@app.post("/targets/{target_id}/apidef/delete")
def target_apidef_delete(request: Request, target_id: int):
    with SessionLocal() as s:
        target = get_target(s, target_id)
        for rel in (target.apidef_file, target.apidef_env_file):
            if rel:
                (settings.data_dir / rel).unlink(missing_ok=True)
        target.apidef_file = target.apidef_env_file = target.apidef_kind = target.apidef_vars_enc = ""
        target.apidef_summary, target.apidef_excluded = {}, []
        s.commit()
        return target_view(request, s, target, notice="API definition removed.")


# ------------------------------------------------------------------ scans


def scan_blockers(target: Target) -> list[str]:
    """Reasons a scan cannot start yet. Shown on the New scan page."""
    out = []
    if storage_problem():
        out.append(storage_problem())
    feeds = gvm.feed_status()
    if not feeds["ready"]:
        out.append("OpenVAS is not ready: " + feeds["detail"])
    if not Dojo().ready():
        out.append("DefectDojo is not reachable yet.")
    unresolved = (target.apidef_summary or {}).get("unresolved") or []
    if unresolved:
        out.append("The API definition has variables without a value: " + ", ".join(unresolved)
                   + ". Set them on the target page.")
    return out


@app.get("/scans/new", response_class=HTMLResponse)
def scan_new(request: Request, target_id: int | None = None):
    with SessionLocal() as s:
        targets = s.scalars(select(Target).order_by(Target.name)).all()
        target = s.get(Target, target_id) if target_id else None
        return page(request, "scan_new.html", targets=targets, target=target,
                    blockers=scan_blockers(target) if target else [], error="")


@app.post("/scans/new")
def scan_create(request: Request, target_id: int = Form(...), profile: str = Form("passive"),
                route: str = Form("internal"), confirm_prod: str = Form(""), confirm_authorised: str = Form("")):
    with SessionLocal() as s:
        target = get_target(s, target_id)
        targets = s.scalars(select(Target).order_by(Target.name)).all()
        error = ""
        blockers = scan_blockers(target)
        if profile not in pipeline.PROFILE_LABELS or route not in ("internal", "public"):
            error = "Unknown profile or route."
        elif blockers:
            error = "The scan cannot start yet."
        elif not confirm_authorised:
            error = "Confirm that you are authorised to test this target."
        elif target.environment == "prod" and profile != "passive" and not confirm_prod:
            error = ("This is a production target. An active scan submits forms and can create or change data. "
                     "Tick the production confirmation to continue, or choose the Passive profile.")
        if error:
            return page(request, "scan_new.html", targets=targets, target=target, blockers=blockers, error=error)
        scan = Scan(target_id=target.id, profile=profile, route=route, requested_by=user_of(request))
        s.add(scan)
        s.commit()
        return RedirectResponse(f"/scans/{scan.id}", 303)


def get_scan(s, scan_id: int) -> Scan:
    scan = s.get(Scan, scan_id)
    if not scan:
        raise HTTPException(404, "Scan not found")
    _ = scan.target.name
    return scan


@app.get("/scans/{scan_id}", response_class=HTMLResponse)
def scan_show(request: Request, scan_id: int):
    with SessionLocal() as s:
        scan = get_scan(s, scan_id)
        logs = []
        root = settings.data_dir / "scans" / scan.code
        if root.exists():
            logs = sorted(str(p.relative_to(root).as_posix()) for p in root.rglob("*.log"))
        return page(request, "scan.html", scan=scan, logs=logs, details=scan.details or {},
                    active=scan.status in ("queued", "running"))


@app.post("/scans/{scan_id}/cancel")
def scan_cancel(scan_id: int):
    with SessionLocal() as s:
        scan = get_scan(s, scan_id)
        if scan.status in ("queued", "running"):
            was_running = scan.status == "running"
            scan.status, scan.error = "cancelled", "Cancelled by the user."
            s.commit()
            if was_running:
                dockerrun.kill_scan_containers()
    return RedirectResponse(f"/scans/{scan_id}", 303)


@app.post("/scans/{scan_id}/report")
def scan_regenerate(scan_id: int):
    """Rebuild the report after findings were triaged in DefectDojo."""
    with SessionLocal() as s:
        scan = get_scan(s, scan_id)
        if scan.status != "done":
            raise HTTPException(400, "Only finished scans have a report")
    pipeline.Runner(scan_id).build_report()
    return RedirectResponse(f"/scans/{scan_id}", 303)


@app.get("/scans/{scan_id}/report.{kind}")
def scan_report(scan_id: int, kind: str):
    if kind not in ("html", "pdf"):
        raise HTTPException(404)
    with SessionLocal() as s:
        scan = get_scan(s, scan_id)
        path = ((scan.details or {}).get("report") or {}).get(kind)
    if not path or not Path(path).exists():
        raise HTTPException(404, "This report file does not exist")
    media = "application/pdf" if kind == "pdf" else "text/html"
    disposition = "attachment" if kind == "pdf" else "inline"
    return FileResponse(path, media_type=media, filename=Path(path).name, content_disposition_type=disposition)


@app.get("/scans/{scan_id}/log/{name:path}")
def scan_log(scan_id: int, name: str):
    with SessionLocal() as s:
        scan = get_scan(s, scan_id)
    root = (settings.data_dir / "scans" / scan.code).resolve()
    path = (root / name).resolve()
    if not path.is_relative_to(root) or path.suffix != ".log" or not path.exists():
        raise HTTPException(404)
    return FileResponse(path, media_type="text/plain; charset=utf-8")
