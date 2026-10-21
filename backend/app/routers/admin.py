"""Endpoint dashboard manajemen lead (wajib login admin)."""

import csv
import io
import threading
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal, get_db
from ..features import visitor_features
from ..ml_engine import OPEN_STATUSES, TASKS, InsufficientDataError, train_all, train_models
from ..models import (
    CONVERTED_STATUSES,
    LEAD_STATUSES,
    AdminUser,
    Event,
    GscDaily,
    Lead,
    ModelRegistry,
    Program,
    Visitor,
    VisitSession,
    utcnow,
)
from ..scoring import RULE_VERSION, score_features
from ..security import create_token, current_admin, verify_password
from .public import _client_ip, _rate_limited, create_lead, score_lead

TZ = ZoneInfo("Asia/Jakarta")

auth_router = APIRouter(prefix="/v1/auth", tags=["auth"])
router = APIRouter(prefix="/v1/admin", tags=["admin"], dependencies=[Depends(current_admin)])


# ---------------- auth ----------------
class LoginIn(BaseModel):
    username: str
    password: str


@auth_router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    if _rate_limited(_client_ip(request) + ":login", limit=10):
        raise HTTPException(429, "Terlalu banyak percobaan login, coba lagi 1 menit lagi")
    user = db.scalar(select(AdminUser).where(AdminUser.username == body.username))
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Username atau password salah")
    return {"access_token": create_token(user.username), "token_type": "bearer"}


@router.get("/me")
def me(user: AdminUser = Depends(current_admin)):
    return {"username": user.username, "whatsapp_admin": get_settings().whatsapp_admin}


# ---------------- helpers ----------------
def _since(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


def _local_day(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(TZ).date().isoformat()


def _lead_dict(lead: Lead, programs: dict[str, str] | None = None) -> dict:
    return {
        "lead_id": lead.lead_id,
        "created_at": lead.created_at.isoformat() if lead.created_at else None,
        "channel": lead.channel,
        "name": lead.name,
        "phone": lead.phone,
        "email": lead.email,
        "program_slug": lead.program_slug,
        "program_name": (programs or {}).get(lead.program_slug or "", None),
        "message": lead.message,
        "extra": lead.extra,
        "status": lead.status,
        "notes": lead.notes,
        "converted": lead.converted,
        "score": lead.score,
        "segment": lead.segment,
        "visitor_id": lead.visitor_id,
    }


def _program_names(db: Session) -> dict[str, str]:
    return {p.slug: p.name for p in db.scalars(select(Program))}


# ---------------- KPI ----------------
@router.get("/kpi")
def kpi(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)):
    since = _since(days)
    visitors = db.scalars(select(Visitor).where(Visitor.last_seen_at >= since)).all()
    sessions = db.scalars(select(VisitSession).where(VisitSession.started_at >= since)).all()
    leads = db.scalars(select(Lead).where(Lead.created_at >= since)).all()

    n_visitors = len(visitors)
    n_leads = len(leads)
    n_converted = sum(1 for l in leads if l.converted)
    by_source = Counter(f"{s.source} / {s.medium}" for s in sessions)
    organic_sessions = sum(1 for s in sessions if s.medium == "organic")

    daily: dict[str, dict] = defaultdict(lambda: {"sessions": 0, "organic": 0, "leads": 0, "converted": 0})
    for s in sessions:
        d = daily[_local_day(s.started_at)]
        d["sessions"] += 1
        d["organic"] += s.medium == "organic"
    for l in leads:
        d = daily[_local_day(l.created_at)]
        d["leads"] += 1
        d["converted"] += bool(l.converted)
    start = datetime.now(TZ).date() - timedelta(days=days - 1)
    series = []
    for i in range(days):
        key = (start + timedelta(days=i)).isoformat()
        series.append({"date": key, **daily.get(key, {"sessions": 0, "organic": 0, "leads": 0, "converted": 0})})

    active = db.scalar(
        select(ModelRegistry).where(ModelRegistry.is_active.is_(True), ModelRegistry.task == "lead")
    )
    model_info = {"version": RULE_VERSION, "algorithm": "aturan (rule-based)", "metrics": None}
    if active:
        best = active.metrics["comparison"][active.algorithm]
        model_info = {
            "version": active.version, "algorithm": active.algorithm, "task_label": TASKS["lead"],
            "metrics": best["cv"], "trained_at": active.trained_at.isoformat(),
        }

    return {
        "days": days,
        "visitors": n_visitors,
        "sessions": len(sessions),
        "organic_sessions": organic_sessions,
        "leads": n_leads,
        "converted": n_converted,
        "visitor_to_lead_rate": round(n_leads / n_visitors, 4) if n_visitors else 0,
        "lead_to_participant_rate": round(n_converted / n_leads, 4) if n_leads else 0,
        "segments": Counter(l.segment or "tanpa_skor" for l in leads),
        "statuses": Counter(l.status for l in leads),
        "channels": Counter(l.channel for l in leads),
        "sources": by_source.most_common(8),
        "series": series,
        "model": model_info,
    }


# ---------------- leads ----------------
@router.get("/leads")
def list_leads(
    segment: str | None = None,
    status: str | None = None,
    program: str | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    sort: str = Query("score", pattern="^(score|newest)$"),
    db: Session = Depends(get_db),
):
    stmt = select(Lead)
    if segment:
        stmt = stmt.where(Lead.segment == segment)
    if status == "berjalan":
        stmt = stmt.where(Lead.status.in_(OPEN_STATUSES))
    elif status:
        stmt = stmt.where(Lead.status == status)
    if program:
        stmt = stmt.where(Lead.program_slug == program)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Lead.name.ilike(like), Lead.phone.ilike(like), Lead.email.ilike(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    if sort == "score":
        stmt = stmt.order_by(Lead.score.desc().nulls_last(), Lead.created_at.desc())
    else:
        stmt = stmt.order_by(Lead.created_at.desc())
    rows = db.scalars(stmt.offset((page - 1) * limit).limit(limit)).all()
    names = _program_names(db)
    return {"total": total, "page": page, "limit": limit, "items": [_lead_dict(l, names) for l in rows]}


@router.get("/leads/{lead_id}")
def lead_detail(lead_id: int, db: Session = Depends(get_db)):
    lead = db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(404, "Lead tidak ditemukan")
    out = {"lead": _lead_dict(lead, _program_names(db)), "visitor": None, "sessions": [], "timeline": [], "score": None}
    if lead.visitor_id:
        v = db.get(Visitor, lead.visitor_id)
        out["visitor"] = {
            "ref_code": v.ref_code, "first_seen_at": v.first_seen_at.isoformat(),
            "first_source": v.first_source, "first_medium": v.first_medium,
            "first_landing": v.first_landing, "device_type": v.device_type,
        }
        sess = db.scalars(
            select(VisitSession).where(VisitSession.visitor_id == v.visitor_id).order_by(VisitSession.started_at)
        ).all()
        out["sessions"] = [
            {
                "started_at": s.started_at.isoformat(), "source": s.source, "medium": s.medium,
                "landing_page": s.landing_page, "utm_term": s.utm_term, "page_count": s.page_count,
                "active_seconds": s.active_seconds, "max_scroll_pct": s.max_scroll_pct,
            }
            for s in sess
        ]
        evs = db.scalars(
            select(Event)
            .where(Event.visitor_id == v.visitor_id, Event.type.not_in(["heartbeat", "scroll"]))
            .order_by(Event.ts)
            .limit(300)
        ).all()
        out["timeline"] = [
            {"ts": e.ts.isoformat(), "type": e.type, "page": e.page_url, "program": e.program_slug, "label": e.label}
            for e in evs
        ]
        feats = visitor_features(db, v.visitor_id, as_of=lead.created_at)
        if feats:
            out["score"] = score_features(db, feats, task="lead") | {"features": {k: feats[k] for k in sorted(feats)}}
    return out


class LeadUpdate(BaseModel):
    status: str | None = None
    notes: str | None = Field(default=None, max_length=5000)
    program_slug: str | None = None


@router.patch("/leads/{lead_id}")
def update_lead(lead_id: int, body: LeadUpdate, db: Session = Depends(get_db)):
    lead = db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(404, "Lead tidak ditemukan")
    if body.status is not None:
        if body.status not in LEAD_STATUSES:
            raise HTTPException(422, f"Status harus salah satu dari {LEAD_STATUSES}")
        lead.status = body.status
        # Label untuk retraining (closed-loop learning)
        if body.status in CONVERTED_STATUSES:
            if not lead.converted:
                lead.converted_at = utcnow()
            lead.converted = True
        elif body.status == "batal":
            lead.converted, lead.converted_at = False, None
        else:
            lead.converted, lead.converted_at = None, None
    if body.notes is not None:
        lead.notes = body.notes
    if body.program_slug is not None:
        lead.program_slug = body.program_slug or None
    lead.updated_at = utcnow()
    db.commit()
    return _lead_dict(lead, _program_names(db))


class ManualLeadIn(BaseModel):
    name: str | None = None
    phone: str
    email: str | None = None
    program_slug: str | None = None
    message: str | None = None
    ref_code: str | None = Field(default=None, description="Kode referensi dari pesan WhatsApp")


@router.post("/leads", status_code=201)
def create_manual_lead(body: ManualLeadIn, db: Session = Depends(get_db)):
    """Catat lead yang masuk lewat chat WhatsApp.

    Pesan WhatsApp dari website otomatis berisi 'Kode: XXXXXX'. Masukkan kode itu
    supaya lead terhubung dengan riwayat perilaku pengunjung di website.
    """
    visitor_id = None
    if body.ref_code:
        code = body.ref_code.strip().upper().lstrip("#")
        visitor_id = db.scalar(
            select(Visitor.visitor_id).where(Visitor.ref_code == code).order_by(Visitor.last_seen_at.desc())
        )
        if visitor_id is None:
            raise HTTPException(404, f"Kode referensi {code} tidak ditemukan")
    lead = create_lead(db, body.model_dump(exclude={"ref_code"}), "whatsapp", visitor_id)
    return _lead_dict(lead, _program_names(db))


@router.post("/leads/{lead_id}/rescore")
def rescore(lead_id: int, db: Session = Depends(get_db)):
    lead = db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(404, "Lead tidak ditemukan")
    result = score_lead(db, lead)
    db.commit()
    return result or {"detail": "Lead tidak terhubung dengan data pengunjung"}


@router.get("/export/leads.csv")
def export_leads(db: Session = Depends(get_db)):
    names = _program_names(db)
    buf = io.StringIO()
    w = csv.writer(buf)
    cols = ["lead_id", "created_at", "channel", "name", "phone", "email", "program_slug",
            "program_name", "status", "converted", "score", "segment", "message", "notes"]
    w.writerow(cols)
    for lead in db.scalars(select(Lead).order_by(Lead.created_at.desc())):
        d = _lead_dict(lead, names)
        w.writerow([d[c] for c in cols])
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=leads.csv"},
    )


# ---------------- programs ----------------
class ProgramIn(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9-]{2,128}$")
    name: str
    category: str | None = None
    price: float | None = None
    url: str | None = None
    next_batch: date | None = None
    active: bool = True


@router.get("/programs")
def list_programs(db: Session = Depends(get_db)):
    return [ProgramIn.model_validate(p, from_attributes=True).model_dump(mode="json")
            for p in db.scalars(select(Program).order_by(Program.name))]


@router.put("/programs/{slug}")
def upsert_program(slug: str, body: ProgramIn, db: Session = Depends(get_db)):
    if slug != body.slug:
        raise HTTPException(422, "Slug di URL dan body berbeda")
    p = db.get(Program, slug) or Program(slug=slug)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.add(p)
    db.commit()
    return body.model_dump(mode="json")


@router.delete("/programs/{slug}", status_code=204)
def delete_program(slug: str, db: Session = Depends(get_db)):
    p = db.get(Program, slug)
    if p:
        db.delete(p)
        db.commit()


# ---------------- SEO ----------------
@router.get("/seo")
def seo(days: int = Query(28, ge=7, le=480), db: Session = Depends(get_db)):
    since = date.today() - timedelta(days=days)
    rows = db.scalars(select(GscDaily).where(GscDaily.date >= since)).all()
    if not rows:
        return {"days": days, "available": False}
    clicks = sum(r.clicks for r in rows)
    impressions = sum(r.impressions for r in rows)
    pos_weighted = sum(r.position * r.impressions for r in rows)

    def top(key):
        agg: dict[str, dict] = defaultdict(lambda: {"clicks": 0, "impressions": 0, "pos": 0.0})
        for r in rows:
            a = agg[getattr(r, key)]
            a["clicks"] += r.clicks
            a["impressions"] += r.impressions
            a["pos"] += r.position * r.impressions
        out = [
            {key: k, "clicks": a["clicks"], "impressions": a["impressions"],
             "ctr": round(a["clicks"] / a["impressions"], 4) if a["impressions"] else 0,
             "position": round(a["pos"] / a["impressions"], 1) if a["impressions"] else None}
            for k, a in agg.items()
        ]
        return sorted(out, key=lambda d: (d["clicks"], d["impressions"]), reverse=True)[:20]

    daily: dict[str, dict] = defaultdict(lambda: {"clicks": 0, "impressions": 0})
    for r in rows:
        daily[r.date.isoformat()]["clicks"] += r.clicks
        daily[r.date.isoformat()]["impressions"] += r.impressions
    pages = top("page")
    return {
        "days": days,
        "available": True,
        "clicks": clicks,
        "impressions": impressions,
        "ctr": round(clicks / impressions, 4) if impressions else 0,
        "avg_position": round(pos_weighted / impressions, 1) if impressions else None,
        "top_queries": top("query"),
        "top_pages": pages,
        "low_ctr_pages": [p for p in pages if p["impressions"] >= 100 and p["ctr"] < 0.02],
        "series": [{"date": d, **v} for d, v in sorted(daily.items())],
    }


# ---------------- model ----------------
_train_state: dict = {"running": False, "last_error": None, "last_result": None}


def _run_training(task: str, force: bool) -> None:
    _train_state.update(running=True, last_error=None, last_result=None)
    try:
        with SessionLocal() as db:
            if task == "all":
                results = train_all(db, force=force)
            else:
                try:
                    results = {task: train_models(db, task=task, force=force)}
                except InsufficientDataError as exc:
                    results = {task: {"error": str(exc)}}
        _train_state["last_result"] = {
            t: r.get("version") or r.get("error") for t, r in results.items()
        }
    except RuntimeError as exc:
        _train_state["last_error"] = str(exc)
    except Exception as exc:  # noqa: BLE001 — tampilkan ke admin, jangan matikan server
        _train_state["last_error"] = f"Gagal melatih model: {exc}"
    finally:
        _train_state["running"] = False


def _count(db: Session, *where) -> int:
    return db.scalar(select(func.count()).select_from(Lead).where(*where)) or 0


@router.get("/model")
def model_info(db: Session = Depends(get_db)):
    history = db.scalars(select(ModelRegistry).order_by(ModelRegistry.trained_at.desc()).limit(30)).all()
    return {
        "training": _train_state,
        "tasks": TASKS,
        "rule_version": RULE_VERSION,
        "min_samples": get_settings().min_positive_samples,
        "labeled": {
            "leads": _count(db),
            "linked": _count(db, Lead.visitor_id.is_not(None)),
            "converted": _count(db, Lead.converted.is_(True)),
            "batal": _count(db, Lead.converted.is_(False)),
        },
        "active": {
            t: next((m.version for m in history if m.task == t and m.is_active), None) for t in TASKS
        },
        "models": [
            {"version": m.version, "task": m.task, "algorithm": m.algorithm,
             "trained_at": m.trained_at.isoformat(), "n_samples": m.n_samples,
             "n_positive": m.n_positive, "is_active": m.is_active, "report": m.metrics}
            for m in history
        ],
    }


class RetrainIn(BaseModel):
    task: str = Field("all", pattern="^(all|lead|visitor)$")
    force: bool = False


@router.post("/model/retrain", status_code=202)
def retrain(body: RetrainIn):
    if _train_state["running"]:
        raise HTTPException(409, "Pelatihan sedang berjalan")
    _train_state["running"] = True
    threading.Thread(target=_run_training, args=(body.task, body.force), daemon=True).start()
    return {"started": True}


@router.post("/model/{version}/activate")
def activate_model(version: str, db: Session = Depends(get_db)):
    target = db.get(ModelRegistry, version)
    if target is None:
        raise HTTPException(404, "Versi model tidak ditemukan")
    for m in db.scalars(select(ModelRegistry).where(ModelRegistry.task == target.task)):
        m.is_active = m.version == version
    db.commit()
    return {"task": target.task, "active": version}


@router.post("/model/deactivate")
def deactivate_models(task: str = Query(..., pattern="^(lead|visitor)$"), db: Session = Depends(get_db)):
    """Kembali ke skor berbasis aturan untuk satu tugas."""
    for m in db.scalars(select(ModelRegistry).where(ModelRegistry.task == task)):
        m.is_active = False
    db.commit()
    return {"task": task, "active": RULE_VERSION}
