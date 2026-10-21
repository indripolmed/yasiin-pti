"""Feature engineering perilaku pengunjung (dipakai bersama oleh training & scoring).

Satu baris fitur = satu pengunjung, dihitung dari event-nya sampai waktu `as_of`.
Untuk data latih, `as_of` = saat pengunjung menjadi lead, supaya model hanya belajar
dari perilaku SEBELUM mendaftar (mencegah kebocoran label).
"""

from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Event, GscDaily, Visitor
from .traffic import normalize_path, page_category, query_intent

NUMERIC_FEATURES = [
    "n_sessions",
    "n_pageviews",
    "total_active_sec",
    "avg_active_per_session",
    "avg_pages_per_session",
    "max_scroll_pct",
    "avg_session_scroll_pct",
    "bounce_rate",
    "n_program_views",
    "n_distinct_programs",
    "n_article_views",
    "n_deep_program_reads",
    "n_click_cta",
    "n_click_whatsapp",
    "n_view_price",
    "n_download_brochure",
    "n_form_start",
    "n_site_search",
    "is_returning",
    "n_active_days",
    "engagement_span_days",
    "first_visit_hour",
    "first_visit_weekend",
]
CATEGORICAL_FEATURES = [
    "first_medium",
    "first_source",
    "device_type",
    "landing_category",
    "landing_query_intent",
]
ALL_FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES

# Fitur yang dikeluarkan per tugas. Untuk "pengunjung -> lead", klik WhatsApp dan mulai
# mengisi form adalah aksi menjadi lead itu sendiri, jadi memakainya = membocorkan label.
_EXCLUDED = {"visitor": {"n_click_whatsapp", "n_form_start"}, "lead": set()}


def task_features(task: str) -> tuple[list[str], list[str]]:
    excluded = _EXCLUDED[task]
    return (
        [f for f in NUMERIC_FEATURES if f not in excluded],
        [f for f in CATEGORICAL_FEATURES if f not in excluded],
    )

_COUNTED_EVENTS = {
    "click_cta": "n_click_cta",
    "click_whatsapp": "n_click_whatsapp",
    "view_price": "n_view_price",
    "download_brochure": "n_download_brochure",
    "form_start": "n_form_start",
    "site_search": "n_site_search",
}
_TOP_SOURCES = {"google", "direct", "facebook", "instagram", "tiktok", "youtube", "whatsapp"}


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def compute_features(
    visitor: Visitor,
    events: Iterable[Event],
    landing_intents: dict[str, str],
    as_of: datetime | None = None,
) -> dict:
    cutoff = _aware(as_of) if as_of else None
    evs = sorted(
        (e for e in events if cutoff is None or _aware(e.ts) <= cutoff),
        key=lambda e: _aware(e.ts),
    )

    f: dict = {k: 0 for k in NUMERIC_FEATURES}
    per_session_pages: dict[str, int] = defaultdict(int)
    per_session_active: dict[str, float] = defaultdict(float)
    per_session_scroll: dict[str, float] = defaultdict(float)
    programs: set[str] = set()
    days: set = set()

    for e in evs:
        sid = e.session_id
        per_session_pages.setdefault(sid, 0)
        days.add(_aware(e.ts).date())
        if e.type == "page_view":
            per_session_pages[sid] += 1
            f["n_pageviews"] += 1
            if e.page_category == "program":
                f["n_program_views"] += 1
                if e.program_slug:
                    programs.add(e.program_slug)
            elif e.page_category == "artikel":
                f["n_article_views"] += 1
        elif e.type == "heartbeat":
            per_session_active[sid] += max(0.0, min(float(e.value or 0), 1800.0))
        elif e.type == "scroll":
            v = float(e.value or 0)
            per_session_scroll[sid] = max(per_session_scroll[sid], v)
            if v >= 75 and e.page_category == "program":
                f["n_deep_program_reads"] += 1
        elif e.type in _COUNTED_EVENTS:
            f[_COUNTED_EVENTS[e.type]] += 1

    sessions = list(per_session_pages)
    n_sessions = len(sessions)
    f["n_sessions"] = n_sessions
    f["n_distinct_programs"] = len(programs)
    f["total_active_sec"] = round(sum(per_session_active.values()), 1)
    if n_sessions:
        f["avg_active_per_session"] = round(f["total_active_sec"] / n_sessions, 1)
        f["avg_pages_per_session"] = round(f["n_pageviews"] / n_sessions, 2)
        f["max_scroll_pct"] = max((per_session_scroll.get(s, 0) for s in sessions), default=0)
        f["avg_session_scroll_pct"] = round(
            sum(per_session_scroll.get(s, 0) for s in sessions) / n_sessions, 1
        )
        bounces = sum(
            1
            for s in sessions
            if per_session_pages[s] <= 1 and per_session_active.get(s, 0) < 10
        )
        f["bounce_rate"] = round(bounces / n_sessions, 3)
    f["is_returning"] = int(n_sessions > 1)
    f["n_active_days"] = len(days)

    # Rentang hari dari kunjungan pertama sampai aktivitas terakhir (sebelum cutoff).
    # Sengaja TIDAK memakai "hari sejak kunjungan terakhir sampai sekarang": nilai itu
    # berbeda cara hitungnya antara lead (dipotong saat mendaftar) dan non-lead,
    # sehingga membocorkan label ke model.
    first = _aware(visitor.first_seen_at)
    last_ts = _aware(evs[-1].ts) if evs else first
    f["engagement_span_days"] = round(max(0.0, (last_ts - first).total_seconds() / 86400), 2)
    f["first_visit_hour"] = first.hour
    f["first_visit_weekend"] = int(first.weekday() >= 5)

    source = (visitor.first_source or "direct").lower()
    landing_path = normalize_path(visitor.first_landing)
    f["first_medium"] = visitor.first_medium or "none"
    f["first_source"] = source if source in _TOP_SOURCES else "lainnya"
    f["device_type"] = visitor.device_type or "unknown"
    f["landing_category"] = page_category(landing_path)
    f["landing_query_intent"] = landing_intents.get(landing_path, "tidak_diketahui")
    return f


def landing_intents(db: Session, paths: Iterable[str] | None = None) -> dict[str, str]:
    """Intent kata kunci dominan (berdasar klik GSC) untuk setiap landing page.

    Google tidak memberikan keyword per pengunjung, jadi keyword dominan dari
    halaman pendaratan dipakai sebagai proksi intent pencarian.
    """
    stmt = select(GscDaily.page, GscDaily.query, func.sum(GscDaily.clicks)).group_by(
        GscDaily.page, GscDaily.query
    )
    best: dict[str, tuple[str, int]] = {}
    wanted = set(paths) if paths is not None else None
    for page, query, clicks in db.execute(stmt):
        path = normalize_path(page)
        if wanted is not None and path not in wanted:
            continue
        if path not in best or (clicks or 0) > best[path][1]:
            best[path] = (query, clicks or 0)
    return {p: query_intent(q) for p, (q, _) in best.items()}


def visitor_features(
    db: Session, visitor_id: str, as_of: datetime | None = None
) -> dict | None:
    visitor = db.get(Visitor, visitor_id)
    if visitor is None:
        return None
    events = db.scalars(select(Event).where(Event.visitor_id == visitor_id)).all()
    intents = landing_intents(db, [normalize_path(visitor.first_landing)])
    return compute_features(visitor, events, intents, as_of=as_of)
