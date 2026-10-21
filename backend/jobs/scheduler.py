"""Penjadwal tugas rutin:
- 06:00 WIB setiap hari : tarik data Google Search Console
- 02:00 WIB setiap Senin: latih ulang model (closed-loop learning)
"""

import logging

from apscheduler.schedulers.blocking import BlockingScheduler

from app.db import SessionLocal, init_db
from app.ml_engine import train_all
from jobs import gsc_etl

log = logging.getLogger("scheduler")


def weekly_retrain() -> None:
    with SessionLocal() as db:
        try:
            for task, result in train_all(db).items():
                log.info("Retrain %s: %s", task, result.get("version") or result.get("error"))
        except RuntimeError as exc:
            log.info("Retrain dilewati: %s", exc)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    init_db()
    sched = BlockingScheduler(timezone="Asia/Jakarta")
    sched.add_job(gsc_etl.run, "cron", hour=6, minute=0, id="gsc_etl")
    sched.add_job(weekly_retrain, "cron", day_of_week="mon", hour=2, minute=0, id="retrain")
    log.info("Scheduler berjalan")
    sched.start()


if __name__ == "__main__":
    main()
