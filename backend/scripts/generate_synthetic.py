"""Isi database dengan data SIMULASI untuk uji coba & demo dashboard.

JANGAN dijalankan di database produksi. Data ini bukan data nyata dan tidak boleh
dipakai sebagai hasil penelitian; gunakan hanya untuk menguji alur sistem.

    python -m scripts.generate_synthetic --visitors 3000
"""

import argparse
import math
import random
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select

from app.db import SessionLocal, init_db
from app.models import Event, GscDaily, Lead, Program, Visitor, VisitSession
from app.routers.public import ref_code_for

PROGRAMS = [
    ("digital-marketing", "Pelatihan Digital Marketing", "Pemasaran", 1_500_000),
    ("barista", "Pelatihan Barista Profesional", "Kuliner", 2_000_000),
    ("operator-komputer", "Sertifikasi Operator Komputer", "TIK", 1_250_000),
    ("public-speaking", "Pelatihan Public Speaking", "Soft skill", 900_000),
    ("desain-grafis", "Pelatihan Desain Grafis", "Kreatif", 1_750_000),
]
SOURCES = [
    ("https://www.google.com/", None, 0.45),
    ("", None, 0.2),
    ("https://l.facebook.com/", None, 0.12),
    ("https://www.instagram.com/", None, 0.13),
    ("", "utm", 0.1),
]
QUERIES = {
    "digital-marketing": ["pelatihan digital marketing medan", "kursus digital marketing bersertifikat", "apa itu digital marketing"],
    "barista": ["kursus barista medan", "biaya pelatihan barista", "cara menjadi barista"],
    "operator-komputer": ["sertifikasi bnsp operator komputer", "pelatihan operator komputer medan"],
    "public-speaking": ["pelatihan public speaking", "tips public speaking"],
    "desain-grafis": ["kursus desain grafis medan", "jadwal pelatihan desain grafis"],
}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--visitors", type=int, default=3000)
    ap.add_argument("--days", type=int, default=90)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--force", action="store_true", help="Izinkan walau database sudah berisi data")
    args = ap.parse_args()
    rnd = random.Random(args.seed)

    init_db()
    db = SessionLocal()
    if db.scalar(select(func.count()).select_from(Visitor)) and not args.force:
        raise SystemExit("Database sudah berisi data. Gunakan --force hanya untuk database uji coba.")

    for slug, name, cat, price in PROGRAMS:
        if db.get(Program, slug) is None:
            db.add(Program(slug=slug, name=name, category=cat, price=price,
                           url=f"https://ysii.org/program/{slug}",
                           next_batch=date.today() + timedelta(days=rnd.randint(7, 60))))

    now = datetime.now(timezone.utc)
    n_leads = n_conv = 0
    for _ in range(args.visitors):
        vid = str(uuid.uuid4())
        intent = rnd.betavariate(1.2, 4)  # minat tersembunyi 0..1 (sebagian besar rendah)
        ref, utm, _w = rnd.choices(SOURCES, weights=[s[2] for s in SOURCES])[0]
        organic = "google" in ref
        if organic:
            intent = min(1, intent * 1.25)
        program = rnd.choice(PROGRAMS)[0]
        first = now - timedelta(days=rnd.uniform(1.5, args.days), hours=rnd.uniform(0, 24))
        landing = f"/program/{program}" if (organic or rnd.random() < 0.4) else rnd.choice(["/", "/artikel/tips-karier"])
        device = "mobile" if rnd.random() < 0.7 else "desktop"
        v = Visitor(visitor_id=vid, ref_code=ref_code_for(vid), first_seen_at=first, last_seen_at=first,
                    first_source="google" if organic else ("direct" if not ref and not utm else ("ig" if utm else ref.split(".")[1])),
                    first_medium="organic" if organic else ("cpc" if utm else ("none" if not ref else "social")),
                    first_landing=landing, device_type=device)
        if v.first_source == "ig":
            v.first_source = "instagram"
        db.add(v)

        n_sessions = 1 + (rnd.random() < intent * 1.2) + (rnd.random() < intent * 0.6) + (rnd.random() < intent * 0.3)
        t = first
        made_lead = False
        for si in range(n_sessions):
            sid = str(uuid.uuid4())
            pages = max(1, int(rnd.expovariate(1 / (1 + 5 * intent))))
            sess = VisitSession(session_id=sid, visitor_id=vid, started_at=t, ended_at=t,
                                source=v.first_source if si == 0 else "direct",
                                medium=v.first_medium if si == 0 else "none",
                                landing_page=landing, page_count=0, active_seconds=0, max_scroll_pct=0)
            db.add(sess)
            for pi in range(pages):
                is_prog = pi == 0 and landing.startswith("/program") or rnd.random() < 0.3 + 0.5 * intent
                slug = (program if rnd.random() < 0.75 else rnd.choice(PROGRAMS)[0]) if is_prog else None
                path = f"/program/{slug}" if slug else rnd.choice(["/", "/tentang", "/artikel/prospek-kerja", "/kontak"])
                cat = "program" if slug else ("beranda" if path == "/" else "artikel" if "artikel" in path else "lainnya")

                def ev(kind, value=None, label=None):
                    db.add(Event(session_id=sid, visitor_id=vid, ts=t, type=kind, page_url=path,
                                 page_category=cat, program_slug=slug, value=value, label=label))

                ev("page_view")
                sess.page_count += 1
                active = rnd.uniform(5, 40) + rnd.uniform(0, 240) * intent
                ev("heartbeat", round(active))
                sess.active_seconds += int(active)
                scroll = min(100, int(rnd.uniform(10, 60) + 60 * intent * rnd.random()))
                for m in (25, 50, 75, 100):
                    if scroll >= m:
                        ev("scroll", m)
                sess.max_scroll_pct = max(sess.max_scroll_pct, scroll)
                if slug and rnd.random() < 0.15 + 0.6 * intent:
                    ev("view_price", label="harga")
                if slug and rnd.random() < 0.05 + 0.3 * intent:
                    ev("download_brochure", label="brosur.pdf")
                if rnd.random() < 0.05 + 0.25 * intent:
                    ev("click_cta", label="Daftar sekarang")
                t += timedelta(seconds=active + 5)

            # sebagian pengunjung klik WhatsApp / mulai isi form tetapi tidak jadi menghubungi
            if rnd.random() < 0.08 * intent:
                ev("click_whatsapp", label="Chat admin")
            if rnd.random() < 0.06 * intent:
                ev("form_start")

            # keputusan menjadi lead di akhir sesi
            p_lead = 0.01 + 0.55 * intent ** 1.5
            if not made_lead and rnd.random() < p_lead:
                made_lead = True
                via_wa = rnd.random() < 0.5
                ev("click_whatsapp" if via_wa else "form_start", label="Chat admin" if via_wa else None)
                if not via_wa:
                    ev("form_submit")
                lead_time = t + timedelta(minutes=rnd.uniform(1, 30) if via_wa else 0.5)
                converted = rnd.random() < 1 / (1 + math.exp(-12 * (intent - 0.35)))
                status = rnd.choice(["terdaftar", "bayar"]) if converted else rnd.choice(["batal", "batal", "dihubungi", "tertarik"])
                db.add(Lead(visitor_id=vid, created_at=lead_time, updated_at=lead_time,
                            channel="whatsapp" if via_wa else "form",
                            name=f"Calon Peserta {n_leads + 1}", phone=f"62812{rnd.randint(10_000_000, 99_999_999)}",
                            program_slug=program, status=status,
                            converted=True if status in ("terdaftar", "bayar") else (False if status == "batal" else None)))
                n_leads += 1
                n_conv += status in ("terdaftar", "bayar")
            sess.ended_at = t
            v.last_seen_at = t
            t += timedelta(days=rnd.uniform(0.2, 6))
            if t > now - timedelta(hours=1):
                break

    # data GSC simulasi
    for d in range(args.days):
        day = date.today() - timedelta(days=d + 3)
        for slug, queries in QUERIES.items():
            for q in queries:
                imp = rnd.randint(5, 120)
                clicks = int(imp * rnd.uniform(0.01, 0.12))
                db.merge(GscDaily(date=day, page=f"https://ysii.org/program/{slug}", query=q, clicks=clicks,
                                  impressions=imp, ctr=clicks / imp, position=round(rnd.uniform(3, 25), 1)))
    db.commit()
    # skor semua lead simulasi dengan model/aturan yang sedang aktif
    from app.routers.public import score_lead
    for lead in db.scalars(select(Lead).where(Lead.score.is_(None), Lead.visitor_id.is_not(None))):
        score_lead(db, lead)
    db.commit()
    db.close()
    print(f"Data simulasi: {args.visitors} pengunjung, {n_leads} lead, {n_conv} menjadi peserta.")


if __name__ == "__main__":
    main()
