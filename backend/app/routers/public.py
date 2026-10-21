"""Endpoint publik yang dipanggil dari website ysii.org (tracker.js & form)."""

import json
import logging
import re
import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal, get_db
from ..features import visitor_features
from ..models import Event, Lead, Prediction, Visitor, VisitSession, utcnow
from ..recommend import CTA_BY_SEGMENT, recommend_programs
from ..scoring import score_features
from ..traffic import classify_source, normalize_path, page_category, program_from_path

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1", tags=["publik"])

ALLOWED_EVENTS = {
    "page_view", "scroll", "heartbeat", "click_cta", "click_whatsapp", "view_price",
    "download_brochure", "form_start", "form_submit", "site_search",
}

# ---------- rate limit sederhana per IP (per proses) ----------
_hits: dict[str, deque] = defaultdict(deque)
_hits_lock = threading.Lock()


def _rate_limited(ip: str, limit: int, window: float = 60.0) -> bool:
    now = time.monotonic()
    with _hits_lock:
        q = _hits[ip]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            return True
        q.append(now)
        return False


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?")


def ref_code_for(visitor_id: str) -> str:
    return visitor_id.replace("-", "")[:6].upper()


# ---------- /collect ----------
class Ctx(BaseModel):
    visitor_id: uuid.UUID
    session_id: uuid.UUID
    page_url: str = Field(max_length=2000)
    page_title: str | None = Field(default=None, max_length=300)
    referrer: str | None = Field(default=None, max_length=2000)
    utm_source: str | None = Field(default=None, max_length=128)
    utm_medium: str | None = Field(default=None, max_length=64)
    utm_campaign: str | None = Field(default=None, max_length=128)
    utm_term: str | None = Field(default=None, max_length=256)
    program_slug: str | None = Field(default=None, max_length=128)
    device: str | None = Field(default=None, max_length=16)


class EventIn(BaseModel):
    type: str = Field(max_length=32)
    ts: int | None = None  # epoch ms dari browser (hanya untuk urutan; waktu server dipakai)
    value: float | None = None
    label: str | None = Field(default=None, max_length=256)


class CollectPayload(BaseModel):
    ctx: Ctx
    events: list[EventIn] = Field(max_length=50)


@router.post("/collect", status_code=204)
async def collect(request: Request, db: Session = Depends(get_db)):
    if _rate_limited(_client_ip(request), limit=600):  # longgar: satu IP bisa dipakai banyak orang (kampus/kantor)
        raise HTTPException(429, "Terlalu banyak permintaan")
    raw = await request.body()
    if len(raw) > 64_000:
        raise HTTPException(413, "Payload terlalu besar")
    try:
        payload = CollectPayload.model_validate_json(raw)
    except ValidationError:
        raise HTTPException(422, "Format data tidak valid")

    c = payload.ctx
    vid, sid = str(c.visitor_id), str(c.session_id)
    now = utcnow()
    path = normalize_path(c.page_url)
    slug = (c.program_slug or "").strip().lower()[:128] or program_from_path(path)
    own_host = urlparse(get_settings().public_api_url).hostname or ""
    own = tuple(h for h in ("ysii.org", own_host.split(".", 1)[-1]) if h)
    source, medium = classify_source(c.referrer, c.utm_source, c.utm_medium, own_hosts=own)

    visitor = db.get(Visitor, vid)
    if visitor is None:
        visitor = Visitor(
            visitor_id=vid, ref_code=ref_code_for(vid), first_seen_at=now, last_seen_at=now,
            first_source=source, first_medium=medium, first_campaign=c.utm_campaign,
            first_landing=path, device_type=c.device,
        )
        db.add(visitor)
    visitor.last_seen_at = now

    sess = db.get(VisitSession, sid)
    if sess is None:
        sess = VisitSession(
            session_id=sid, visitor_id=vid, started_at=now, ended_at=now, source=source,
            medium=medium, campaign=c.utm_campaign, utm_term=c.utm_term, landing_page=path,
            referrer=c.referrer, page_count=0, active_seconds=0, max_scroll_pct=0,
        )
        db.add(sess)
    elif sess.visitor_id != vid:
        raise HTTPException(422, "Sesi tidak cocok dengan pengunjung")
    sess.ended_at = now

    category = page_category(path, slug)
    for e in payload.events:
        if e.type not in ALLOWED_EVENTS:
            continue
        value = e.value
        if e.type == "page_view":
            sess.page_count += 1
        elif e.type == "heartbeat":
            value = max(0.0, min(float(value or 0), 1800.0))
            sess.active_seconds += int(value)
        elif e.type == "scroll":
            value = max(0.0, min(float(value or 0), 100.0))
            sess.max_scroll_pct = max(sess.max_scroll_pct, int(value))
        db.add(
            Event(
                session_id=sid, visitor_id=vid, ts=now, type=e.type, page_url=path,
                page_category=category, program_slug=slug, value=value, label=e.label,
            )
        )
    db.commit()
    return Response(status_code=204)


# ---------- /leads (form website) ----------
_PHONE_RE = re.compile(r"[^\d+]")
_PHONE_VALUE = re.compile(r"^\+?[\d\s().-]{8,20}$")
_EMAIL_VALUE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# Potongan nama kolom yang dikenali (Contact Form 7, Elementor, WPForms, form HTML biasa)
_KNOWN_FIELDS = {
    "name": ("nama", "name", "fullname"),
    "phone": ("phone", "telepon", "telp", "no_hp", "nohp", "handphone", "whatsapp", "no_wa", "hp", "wa", "tel"),
    "email": ("email", "e-mail", "surel"),
    "program_slug": ("program", "pelatihan", "kursus", "skema", "kelas", "training"),
    "message": ("message", "pesan", "catatan", "keterangan", "pertanyaan"),
}
_SKIP_EXTRA = {"visitor_id", "website", "_redirect", "_wpcf7", "_wpnonce", "page_url"}
_INTERNAL_PREFIX = ("_wpcf7", "_wpnonce", "action", "post_id", "form_id", "queried_id", "referer_title")


def normalize_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    p = _PHONE_RE.sub("", phone)
    if p.startswith("+"):
        p = p[1:]
    if p.startswith("0"):
        p = "62" + p[1:]
    return p[:20] or None


def _field_key(key: str) -> str:
    """'form_fields[phone]' -> 'phone', 'your-name' -> 'your-name'."""
    inner = re.findall(r"\[([^\]]+)\]", key)
    return (inner[-1] if inner else key).strip().lower()


def _matches(key: str, names: tuple[str, ...]) -> bool:
    k = _field_key(key)
    tokens = set(re.split(r"[^a-z0-9]+", k))
    return any(n == k or n in tokens or (len(n) > 3 and n in k) for n in names)


# "nama" paling umum dipakai sebagai awalan (mis. "nama_program"), jadi dicek paling akhir
_FIELD_ORDER = ("email", "phone", "program_slug", "message", "name")


def _field_of(key: str) -> str | None:
    for field in _FIELD_ORDER:
        names = _KNOWN_FIELDS[field]
        if _matches(key, names):
            return field
    return None


def parse_lead_fields(data: dict) -> dict:
    """Petakan data form apa pun ke field lead; sisanya masuk 'extra'."""
    out: dict = {"extra": {}}
    for k, v in data.items():
        if v in (None, "") or k in _SKIP_EXTRA or k.startswith(_INTERNAL_PREFIX):
            continue
        field = _field_of(k)
        if field and field not in out:
            out[field] = str(v).strip()[:2000]
        else:
            out["extra"][k[:100]] = str(v)[:500]
    # Cadangan: kenali dari isi (mis. WPForms memakai nama kolom berupa angka)
    for k, v in list(out["extra"].items()):
        if "phone" not in out and _PHONE_VALUE.match(v) and sum(c.isdigit() for c in v) >= 8:
            out["phone"] = out["extra"].pop(k)
        elif "email" not in out and _EMAIL_VALUE.match(v):
            out["email"] = out["extra"].pop(k)
    return out


def _valid_uuid(value: str | None) -> str | None:
    try:
        return str(uuid.UUID(str(value))) if value else None
    except ValueError:
        return None


def notify_hot_lead(lead_id: int) -> None:
    url = get_settings().hot_lead_webhook_url
    if not url:
        return
    with SessionLocal() as db:
        lead = db.get(Lead, lead_id)
        if lead is None:
            return
        body = {
            "lead_id": lead.lead_id, "name": lead.name, "phone": lead.phone,
            "program": lead.program_slug, "score": lead.score, "segment": lead.segment,
            "text": f"Lead HOT baru: {lead.name or '-'} ({lead.phone or '-'}) "
                    f"program {lead.program_slug or '-'}, skor {round((lead.score or 0) * 100)}%",
        }
    try:
        httpx.post(url, json=body, timeout=10)
    except httpx.HTTPError as exc:
        log.warning("Gagal mengirim notifikasi lead hot: %s", exc)


def score_lead(db: Session, lead: Lead) -> dict | None:
    """Hitung skor lead dari perilaku pengunjung SEBELUM mendaftar."""
    if not lead.visitor_id:
        return None
    feats = visitor_features(db, lead.visitor_id, as_of=lead.created_at)
    if feats is None:
        return None
    result = score_features(db, feats, task="lead")
    lead.score, lead.segment = result["score"], result["segment"]
    db.add(
        Prediction(
            visitor_id=lead.visitor_id, lead_id=lead.lead_id, model_version=result["model_version"],
            score=result["score"], segment=result["segment"],
        )
    )
    return result


def create_lead(db: Session, data: dict, channel: str, visitor_id: str | None) -> Lead:
    if visitor_id and db.get(Visitor, visitor_id) is None:
        visitor_id = None
    f = parse_lead_fields(data)
    program = f.get("program_slug")
    program = re.sub(r"[^a-z0-9]+", "-", program.lower()).strip("-")[:128] if program else None
    phone = normalize_phone(f.get("phone"))
    email = f.get("email")

    # Form yang terkirim ulang dalam 30 menit dianggap lead yang sama
    dup_filter = [Lead.phone == phone] if phone else [Lead.email == email]
    recent = db.scalar(
        select(Lead)
        .where(*dup_filter, Lead.created_at >= utcnow() - timedelta(minutes=30))
        .order_by(Lead.created_at.desc())
    )
    if recent is not None:
        recent.name = f.get("name") or recent.name
        recent.email = email or recent.email
        recent.program_slug = program or recent.program_slug
        recent.message = f.get("message") or recent.message
        recent.visitor_id = recent.visitor_id or visitor_id
        recent.updated_at = utcnow()
        if recent.score is None:
            score_lead(db, recent)
        db.commit()
        return recent

    lead = Lead(
        visitor_id=visitor_id,
        channel=channel,
        name=f.get("name"),
        phone=phone,
        email=email,
        program_slug=program,
        message=f.get("message"),
        extra=f["extra"] or None,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(lead)
    db.flush()
    score_lead(db, lead)
    db.commit()
    return lead


def _safe_redirect(url: str | None) -> str | None:
    if not url:
        return None
    host = urlparse(url).hostname or ""
    allowed = {urlparse(o).hostname for o in get_settings().origins}
    return url if host in allowed else None


@router.post("/leads")
async def submit_lead(
    request: Request, background: BackgroundTasks, db: Session = Depends(get_db)
):
    """Terima data form pendaftaran dari website (JSON atau form-urlencoded/multipart)."""
    if _rate_limited(_client_ip(request) + ":lead", limit=10):
        raise HTTPException(429, "Terlalu banyak permintaan")
    ctype = request.headers.get("content-type", "")
    if "application/json" in ctype or "text/plain" in ctype:
        try:
            data = json.loads(await request.body() or b"{}")
        except json.JSONDecodeError:
            raise HTTPException(422, "JSON tidak valid")
        if not isinstance(data, dict):
            raise HTTPException(422, "JSON harus berupa objek")
    else:
        form = await request.form()
        data = {k: v for k, v in form.items() if isinstance(v, str)}

    redirect = _safe_redirect(data.get("_redirect"))
    if data.get("website"):  # honeypot: diisi bot, bukan manusia
        return RedirectResponse(redirect, 303) if redirect else {"ok": True}
    fields = parse_lead_fields(data)
    if not (fields.get("phone") or fields.get("email")):
        raise HTTPException(422, "Nomor WhatsApp/telepon atau email wajib diisi")

    lead = create_lead(db, data, "form", _valid_uuid(data.get("visitor_id")))
    if lead.segment == "hot":
        background.add_task(notify_hot_lead, lead.lead_id)
    if redirect:
        return RedirectResponse(redirect, status_code=303)
    return {"ok": True, "lead_id": lead.lead_id}


# ---------- /recommend ----------
@router.get("/recommend/{visitor_id}")
def recommend(visitor_id: str, current: str | None = None, db: Session = Depends(get_db)):
    vid = _valid_uuid(visitor_id)
    segment = "cold"
    if vid:
        feats = visitor_features(db, vid)
        if feats is not None:
            segment = score_features(db, feats, task="visitor")["segment"]
    programs = recommend_programs(db, vid or "", current=(current or "").lower() or None)
    return {"segment": segment, "cta": CTA_BY_SEGMENT[segment], "programs": programs}


@router.get("/health", tags=["sistem"])
def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}
