"""Launcher database: targets and scans. Tables are created on start (no migrations in v1)."""
from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from .config import settings


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class Base(DeclarativeBase):
    pass


class Target(Base):
    __tablename__ = "targets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    base_url: Mapped[str] = mapped_column(String(500))
    environment: Mapped[str] = mapped_column(String(10), default="dev")  # dev | stg | prod
    image_ref: Mapped[str] = mapped_column(String(500), default="")
    graphql_path: Mapped[str] = mapped_column(String(300), default="")
    gvm_host: Mapped[str] = mapped_column(String(100), default="")  # OpenVAS address override (public IP)

    auth_type: Mapped[str] = mapped_column(String(20), default="none")
    auth_config_enc: Mapped[str] = mapped_column(Text, default="")  # encrypted JSON

    apidef_kind: Mapped[str] = mapped_column(String(20), default="")  # openapi | postman | ""
    apidef_file: Mapped[str] = mapped_column(String(300), default="")  # relative to data dir
    apidef_env_file: Mapped[str] = mapped_column(String(300), default="")
    apidef_summary: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    apidef_vars_enc: Mapped[str] = mapped_column(Text, default="")  # encrypted JSON overrides
    apidef_excluded: Mapped[list[str]] = mapped_column(JSON, default=list)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)
    scans: Mapped[list["Scan"]] = relationship(back_populates="target", cascade="all, delete-orphan")


class Scan(Base):
    __tablename__ = "scans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    target_id: Mapped[int] = mapped_column(ForeignKey("targets.id"))
    target: Mapped[Target] = relationship(back_populates="scans")

    profile: Mapped[str] = mapped_column(String(20), default="passive")  # passive | standard | deep
    route: Mapped[str] = mapped_column(String(20), default="internal")  # internal | public
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | running | done | failed | cancelled
    requested_by: Mapped[str] = mapped_column(String(200), default="")
    # per tool: {"zap": {"status": "...", "message": "...", "started": "...", "finished": "..."}}
    steps: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    # scope, versions, login check, coverage rows, finding hash snapshot
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    dojo_engagement_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def code(self) -> str:
        return f"VA-{self.id:05d}"


def make_engine(url: str | None = None):
    url = url or settings.database_url
    kwargs: dict[str, Any] = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **kwargs)


engine = make_engine()
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


# Columns added after the first release. create_all() does not add columns to
# existing tables, so each one is added here if missing.
ADDED_COLUMNS = [("targets", "gvm_host", "VARCHAR(100) NOT NULL DEFAULT ''")]


def init_db() -> None:
    from sqlalchemy import inspect, text

    Base.metadata.create_all(engine)
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, column, ddl in ADDED_COLUMNS:
            if column not in {c["name"] for c in insp.get_columns(table)}:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
