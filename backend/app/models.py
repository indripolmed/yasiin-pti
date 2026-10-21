"""Skema database (sesuai ERD di docs/LANGKAH-PEMBANGUNAN-SISTEM.md)."""

from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Visitor(Base):
    __tablename__ = "visitors"

    visitor_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # Kode pendek yang ikut di pesan WhatsApp, agar chat WA bisa dihubungkan ke pengunjung
    ref_code: Mapped[str] = mapped_column(String(8), index=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    first_source: Mapped[str | None] = mapped_column(String(64))
    first_medium: Mapped[str | None] = mapped_column(String(32))
    first_campaign: Mapped[str | None] = mapped_column(String(128))
    first_landing: Mapped[str | None] = mapped_column(Text)
    device_type: Mapped[str | None] = mapped_column(String(16))

    sessions: Mapped[list["VisitSession"]] = relationship(back_populates="visitor")


class VisitSession(Base):
    __tablename__ = "sessions"

    session_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    visitor_id: Mapped[str] = mapped_column(ForeignKey("visitors.visitor_id"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    source: Mapped[str | None] = mapped_column(String(64))
    medium: Mapped[str | None] = mapped_column(String(32))
    campaign: Mapped[str | None] = mapped_column(String(128))
    utm_term: Mapped[str | None] = mapped_column(String(256))
    landing_page: Mapped[str | None] = mapped_column(Text)
    referrer: Mapped[str | None] = mapped_column(Text)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    active_seconds: Mapped[int] = mapped_column(Integer, default=0)
    max_scroll_pct: Mapped[int] = mapped_column(Integer, default=0)

    visitor: Mapped[Visitor] = relationship(back_populates="sessions")


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (Index("ix_events_visitor_ts", "visitor_id", "ts"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.session_id"))
    visitor_id: Mapped[str] = mapped_column(ForeignKey("visitors.visitor_id"))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # page_view, scroll, heartbeat, click_cta, click_whatsapp, view_price,
    # download_brochure, form_start, form_submit, site_search
    type: Mapped[str] = mapped_column(String(32), index=True)
    page_url: Mapped[str | None] = mapped_column(Text)
    page_category: Mapped[str | None] = mapped_column(String(32))
    program_slug: Mapped[str | None] = mapped_column(String(128), index=True)
    value: Mapped[float | None] = mapped_column(Float)
    label: Mapped[str | None] = mapped_column(String(256))

    # Relasi dipakai agar SQLAlchemy menyimpan visitor & session sebelum event (urutan FK)
    session: Mapped["VisitSession"] = relationship()
    visitor: Mapped["Visitor"] = relationship()


class Program(Base):
    __tablename__ = "programs"

    slug: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(256))
    category: Mapped[str | None] = mapped_column(String(128))
    price: Mapped[float | None] = mapped_column(Float)
    url: Mapped[str | None] = mapped_column(Text)
    next_batch: Mapped[date | None] = mapped_column(Date)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


LEAD_STATUSES = ["baru", "dihubungi", "tertarik", "terdaftar", "bayar", "batal"]
CONVERTED_STATUSES = {"terdaftar", "bayar"}


class Lead(Base):
    __tablename__ = "leads"

    lead_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    visitor_id: Mapped[str | None] = mapped_column(ForeignKey("visitors.visitor_id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    channel: Mapped[str] = mapped_column(String(16), default="form")  # form / whatsapp
    name: Mapped[str | None] = mapped_column(String(256))
    phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(256))
    program_slug: Mapped[str | None] = mapped_column(String(128))
    message: Mapped[str | None] = mapped_column(Text)
    extra: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="baru")
    notes: Mapped[str | None] = mapped_column(Text)
    # Label ML: True = menjadi peserta (terdaftar/bayar), False = batal, None = belum diketahui
    converted: Mapped[bool | None] = mapped_column(Boolean)
    converted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    score: Mapped[float | None] = mapped_column(Float)
    segment: Mapped[str | None] = mapped_column(String(8))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    visitor: Mapped[Visitor | None] = relationship()


class Prediction(Base):
    __tablename__ = "predictions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    visitor_id: Mapped[str] = mapped_column(String(36), index=True)
    lead_id: Mapped[int | None] = mapped_column(Integer)
    model_version: Mapped[str] = mapped_column(String(80))
    score: Mapped[float] = mapped_column(Float)
    segment: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GscDaily(Base):
    __tablename__ = "gsc_daily"

    date: Mapped[date] = mapped_column(Date, primary_key=True)
    page: Mapped[str] = mapped_column(String(512), primary_key=True)
    query: Mapped[str] = mapped_column(String(512), primary_key=True)
    clicks: Mapped[int] = mapped_column(Integer)
    impressions: Mapped[int] = mapped_column(Integer)
    ctr: Mapped[float] = mapped_column(Float)
    position: Mapped[float] = mapped_column(Float)


class ModelRegistry(Base):
    __tablename__ = "model_registry"

    version: Mapped[str] = mapped_column(String(80), primary_key=True)
    # "lead" (lead -> peserta) atau "visitor" (pengunjung -> lead)
    task: Mapped[str] = mapped_column(String(16), default="lead", index=True)
    algorithm: Mapped[str] = mapped_column(String(64))
    trained_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    n_samples: Mapped[int] = mapped_column(Integer)
    n_positive: Mapped[int] = mapped_column(Integer)
    metrics: Mapped[dict] = mapped_column(JSON)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    artifact_path: Mapped[str] = mapped_column(Text)


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
