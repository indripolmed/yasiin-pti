"""Scoring probabilitas + segmentasi (Hot / Warm / Cold).

task="lead"    : peluang lead menjadi peserta (prioritas follow-up di dashboard)
task="visitor" : peluang pengunjung menjadi lead (rekomendasi & CTA di website)

Sebelum data cukup untuk model ML, dipakai skor berbasis aturan.
"""

from __future__ import annotations

import math
import threading

import joblib
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .features import task_features
from .models import ModelRegistry

RULE_VERSION = "rules-v1"

# (fitur, bobot, batas nilai, alasan) — bobot dalam skala logit
_RULES_VISITOR = [
    ("n_click_whatsapp", 1.2, 1, "Klik tombol WhatsApp"),
    ("n_form_start", 1.0, 1, "Mulai mengisi form pendaftaran"),
    ("n_view_price", 0.7, 2, "Melihat biaya/jadwal"),
    ("n_download_brochure", 0.6, 1, "Mengunduh brosur"),
    ("n_click_cta", 0.5, 2, "Klik tombol ajakan (CTA)"),
    ("n_deep_program_reads", 0.4, 3, "Membaca halaman program sampai bawah"),
    ("n_distinct_programs", 0.3, 3, "Melihat beberapa program"),
    ("is_returning", 0.8, 1, "Pengunjung kembali"),
    ("n_active_days", 0.3, 3, "Aktif di beberapa hari berbeda"),
]
# Untuk lead, mengisi form / chat WA sudah pasti terjadi, jadi tidak dihitung.
# Yang membedakan lead serius adalah kedalaman riset sebelum mendaftar.
_RULES_LEAD = [
    ("n_view_price", 0.6, 2, "Melihat biaya/jadwal"),
    ("n_download_brochure", 0.5, 1, "Mengunduh brosur"),
    ("n_deep_program_reads", 0.4, 3, "Membaca halaman program sampai bawah"),
    ("n_program_views", 0.15, 5, "Sering membuka halaman program"),
    ("is_returning", 0.6, 1, "Pengunjung kembali"),
    ("n_active_days", 0.25, 3, "Aktif di beberapa hari berbeda"),
    ("n_click_cta", 0.3, 2, "Klik tombol ajakan (CTA)"),
]
_RULES = {"visitor": (_RULES_VISITOR, -3.0), "lead": (_RULES_LEAD, -1.6)}

_cache_lock = threading.Lock()
_cache: dict[str, dict] = {}


def segment_for(score: float) -> str:
    s = get_settings()
    if score >= s.hot_threshold:
        return "hot"
    if score >= s.warm_threshold:
        return "warm"
    return "cold"


def rule_score(f: dict, task: str = "lead") -> tuple[float, list[str]]:
    rules, z = _RULES[task]
    reasons: list[tuple[float, str]] = []
    for key, weight, cap, text in rules:
        v = min(float(f.get(key, 0) or 0), cap)
        if v > 0:
            z += weight * v
            reasons.append((weight * v, text))
    if f.get("total_active_sec", 0) >= 120:
        z += 0.5
        reasons.append((0.5, "Waktu baca lebih dari 2 menit"))
    if f.get("first_medium") == "organic":
        z += 0.2
        reasons.append((0.2, "Datang dari pencarian Google"))
    if f.get("bounce_rate", 0) >= 1:
        z -= 0.5
    reasons.sort(reverse=True)
    return 1 / (1 + math.exp(-z)), [r for _, r in reasons[:4]]


def _active_model(db: Session, task: str):
    reg = db.scalar(
        select(ModelRegistry).where(ModelRegistry.is_active.is_(True), ModelRegistry.task == task)
    )
    if reg is None:
        return None, None, []
    with _cache_lock:
        cached = _cache.get(task)
        if cached is None or cached["version"] != reg.version:
            try:
                artifact = joblib.load(reg.artifact_path)
            except (OSError, EOFError):
                return None, None, []
            cached = {
                "version": reg.version,
                "pipeline": artifact["pipeline"],
                "importance": reg.metrics.get("feature_importance", []),
            }
            _cache[task] = cached
        return cached["version"], cached["pipeline"], cached["importance"]


_FEATURE_TEXT = {key: text for key, _, _, text in _RULES_VISITOR + _RULES_LEAD} | {
    "total_active_sec": "Waktu baca lama",
    "avg_active_per_session": "Waktu baca lama",
    "n_pageviews": "Banyak halaman dibuka",
    "avg_pages_per_session": "Banyak halaman dibuka",
    "max_scroll_pct": "Membaca halaman sampai bawah",
    "n_sessions": "Beberapa kali berkunjung",
}
# Nilai minimal agar sebuah fitur layak disebut sebagai alasan
_REASON_MIN = {
    "n_distinct_programs": 2, "n_sessions": 2, "n_active_days": 2, "max_scroll_pct": 75,
    "total_active_sec": 120, "avg_active_per_session": 90, "n_pageviews": 3,
    "avg_pages_per_session": 3, "n_program_views": 2,
}


def _ml_reasons(f: dict, importance: list[dict]) -> list[str]:
    out: list[str] = []
    for item in importance:
        key = item["feature"]
        text = _FEATURE_TEXT.get(key)
        if item["importance"] > 0 and text and text not in out and (f.get(key) or 0) >= _REASON_MIN.get(key, 1):
            out.append(text)
        if len(out) == 4:
            break
    return out


def score_features(db: Session, f: dict, task: str = "lead") -> dict:
    version, pipeline, importance = _active_model(db, task)
    if pipeline is not None:
        numeric, categorical = task_features(task)
        X = pd.DataFrame([{k: f[k] for k in numeric + categorical}])
        p = float(pipeline.predict_proba(X)[:, 1][0])
        reasons = _ml_reasons(f, importance)
    else:
        version = RULE_VERSION
        p, reasons = rule_score(f, task)
    return {
        "score": round(p, 4),
        "segment": segment_for(p),
        "model_version": version,
        "task": task,
        "reasons": reasons,
    }
