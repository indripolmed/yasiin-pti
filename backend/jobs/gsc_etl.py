"""Tarik data Google Search Console (klik, impresi, CTR, posisi per halaman & kata kunci).

Persiapan:
1. Buat service account di Google Cloud, aktifkan "Google Search Console API", unduh kunci JSON.
2. Di Search Console > Setelan > Pengguna, tambahkan email service account (izin: Terbatas).
3. Set GSC_CREDENTIALS_FILE=/path/kunci.json dan GSC_SITE_URL=sc-domain:ysii.org

    python -m jobs.gsc_etl --days 90     # isi data awal (baseline)
    python -m jobs.gsc_etl               # harian (3 hari terakhir)
"""

import argparse
import logging
from datetime import date, timedelta

from sqlalchemy import delete

from app.config import get_settings
from app.db import SessionLocal, init_db
from app.models import GscDaily

log = logging.getLogger(__name__)


def fetch_day(service, site: str, day: date) -> list[dict]:
    rows, start = [], 0
    while True:
        resp = service.searchanalytics().query(
            siteUrl=site,
            body={
                "startDate": day.isoformat(), "endDate": day.isoformat(),
                "dimensions": ["page", "query"], "rowLimit": 25000, "startRow": start,
            },
        ).execute()
        batch = resp.get("rows", [])
        rows += batch
        if len(batch) < 25000:
            return rows
        start += 25000


def run(days: int = 3) -> int:
    s = get_settings()
    if not s.gsc_credentials_file:
        log.warning("GSC_CREDENTIALS_FILE belum diatur, ETL GSC dilewati")
        return 0
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds = service_account.Credentials.from_service_account_file(
        s.gsc_credentials_file, scopes=["https://www.googleapis.com/auth/webmasters.readonly"]
    )
    service = build("searchconsole", "v1", credentials=creds, cache_discovery=False)
    init_db()
    total = 0
    # data GSC baru final sekitar 2-3 hari kemudian
    for offset in range(days + 2, 2, -1):
        day = date.today() - timedelta(days=offset)
        rows = fetch_day(service, s.gsc_site_url, day)
        with SessionLocal() as db:
            db.execute(delete(GscDaily).where(GscDaily.date == day))
            for r in rows:
                page, query = r["keys"]
                db.add(GscDaily(
                    date=day, page=page[:512], query=query[:512], clicks=int(r["clicks"]),
                    impressions=int(r["impressions"]), ctr=float(r["ctr"]), position=float(r["position"]),
                ))
            db.commit()
        log.info("GSC %s: %d baris", day, len(rows))
        total += len(rows)
    return total


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=3)
    print(f"{run(ap.parse_args().days)} baris disimpan")
