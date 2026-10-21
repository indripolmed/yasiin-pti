"""Modul rekomendasi konten dinamis.

- Program: gabungan minat pengunjung sendiri + "pengunjung lain yang melihat program ini
  juga melihat ..." (item co-occurrence), fallback ke program dengan batch terdekat.
- CTA: disesuaikan dengan segmen skor konversi pengunjung.
"""

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Event, Program

CTA_BY_SEGMENT = {
    "hot": {
        "type": "daftar",
        "title": "Kuota batch berikutnya terbatas",
        "text": "Amankan kursi Anda sekarang, atau konsultasi langsung dengan admin via WhatsApp.",
        "button": "Daftar sekarang",
    },
    "warm": {
        "type": "konsultasi",
        "title": "Masih ragu memilih program?",
        "text": "Lihat jadwal batch terdekat dan cerita alumni, atau tanya admin kami dulu.",
        "button": "Konsultasi gratis via WhatsApp",
    },
    "cold": {
        "type": "edukasi",
        "title": "Kenali program pelatihan kami",
        "text": "Unduh brosur untuk melihat materi, sertifikat, dan prospek kerja setiap program.",
        "button": "Lihat program",
    },
}


def _program_dict(p: Program) -> dict:
    return {
        "slug": p.slug,
        "name": p.name,
        "category": p.category,
        "url": p.url,
        "price": p.price,
        "next_batch": p.next_batch.isoformat() if p.next_batch else None,
    }


def recommend_programs(
    db: Session, visitor_id: str, current: str | None = None, limit: int = 3
) -> list[dict]:
    programs = {p.slug: p for p in db.scalars(select(Program).where(Program.active.is_(True)))}
    if not programs:
        return []

    since = datetime.now(timezone.utc) - timedelta(days=90)
    rows = db.execute(
        select(Event.visitor_id, Event.program_slug).where(
            Event.type == "page_view", Event.program_slug.is_not(None), Event.ts >= since
        )
    ).all()
    seen_by: dict[str, set[str]] = defaultdict(set)
    for vid, slug in rows:
        seen_by[vid].add(slug)

    mine = seen_by.get(visitor_id, set())
    if current:
        mine = mine | {current}

    scores: Counter = Counter()
    for vid, slugs in seen_by.items():
        if vid == visitor_id or not (slugs & mine):
            continue
        for s in slugs - mine:
            scores[s] += len(slugs & mine)

    ranked = [s for s, _ in scores.most_common() if s in programs]
    # Program yang pernah dilihat tapi bukan halaman yang sedang dibuka juga relevan
    ranked += [s for s in mine if s in programs and s != current and s not in ranked]
    today = date.today()
    upcoming = sorted(
        (p for p in programs.values() if p.slug not in ranked and p.slug != current),
        key=lambda p: (p.next_batch is None or p.next_batch < today, p.next_batch or date.max),
    )
    ranked += [p.slug for p in upcoming]
    return [_program_dict(programs[s]) for s in ranked[:limit]]
