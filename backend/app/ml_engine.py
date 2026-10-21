"""ML Predictive Engine — pelatihan (CRISP-DM) dan perbandingan tiga algoritma.

Ada dua tugas prediksi dengan model terpisah:

- task="lead"    : lead -> menjadi peserta (terdaftar/bayar).
                   Dilatih HANYA dari lead yang hasilnya sudah diketahui, sehingga skor
                   benar-benar membedakan lead serius dari yang tidak. Dipakai untuk
                   memprioritaskan lead di dashboard.
- task="visitor" : pengunjung -> menjadi lead (isi form / chat WhatsApp).
                   Dilatih dari semua pengunjung. Dipakai untuk rekomendasi konten & CTA.

Logistic Regression (baseline), Random Forest, dan Gradient Boosting dibandingkan
dengan stratified k-fold cross-validation. Model terbaik (berdasar F1) disimpan
dan diaktifkan.
"""

from __future__ import annotations

import logging
import threading
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_validate, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .config import get_settings
from .features import compute_features, landing_intents, task_features
from .models import Event, Lead, ModelRegistry, Visitor

log = logging.getLogger(__name__)
_train_lock = threading.Lock()

TASKS = {
    "lead": "Lead → menjadi peserta (prioritas lead)",
    "visitor": "Pengunjung → menjadi lead (rekomendasi & CTA)",
}

ALGORITHMS = {
    "logistic_regression": lambda: LogisticRegression(max_iter=2000, class_weight="balanced"),
    "random_forest": lambda: RandomForestClassifier(
        n_estimators=300, min_samples_leaf=2, class_weight="balanced", random_state=42, n_jobs=-1
    ),
    "gradient_boosting": lambda: HistGradientBoostingClassifier(
        max_iter=300, learning_rate=0.05, class_weight="balanced", random_state=42
    ),
}

OPEN_STATUSES = ("baru", "dihubungi", "tertarik")


class InsufficientDataError(Exception):
    pass


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def build_dataset(
    db: Session, task: str = "lead", negative_min_idle_days: float = 1.0
) -> pd.DataFrame:
    """Satu baris per pengunjung + kolom `y`.

    Fitur selalu dihitung sampai saat pengunjung pertama kali menjadi lead (as_of),
    supaya model hanya belajar dari perilaku SEBELUM mendaftar.
    """
    if task not in TASKS:
        raise ValueError(f"task harus salah satu dari {list(TASKS)}")
    now = datetime.now(timezone.utc)
    leads_by_v: dict[str, list[Lead]] = defaultdict(list)
    for lead in db.scalars(select(Lead).where(Lead.visitor_id.is_not(None))):
        leads_by_v[lead.visitor_id].append(lead)

    vq = select(Visitor)
    eq = select(Event)
    if task == "lead":
        vq = vq.where(Visitor.visitor_id.in_(list(leads_by_v)))
        eq = eq.where(Event.visitor_id.in_(list(leads_by_v)))
    visitors = db.scalars(vq).all()
    events_by_v: dict[str, list[Event]] = defaultdict(list)
    for e in db.scalars(eq):
        events_by_v[e.visitor_id].append(e)
    intents = landing_intents(db)

    rows = []
    for v in visitors:
        leads = leads_by_v.get(v.visitor_id, [])
        if leads:
            as_of = min(_aware(l.created_at) for l in leads)
            if task == "visitor":
                y = 1
            elif any(l.converted for l in leads):
                y = 1
            elif all(l.converted is False for l in leads):
                y = 0
            else:
                continue  # hasil follow-up belum diketahui
        else:
            if (now - _aware(v.last_seen_at)) < timedelta(days=negative_min_idle_days):
                continue  # masih mungkin mendaftar
            as_of, y = None, 0
        feats = compute_features(v, events_by_v.get(v.visitor_id, []), intents, as_of=as_of)
        if feats["n_sessions"] == 0:
            continue
        feats["visitor_id"] = v.visitor_id
        feats["y"] = y
        rows.append(feats)
    return pd.DataFrame(rows)


def _pipeline(algorithm: str, task: str) -> Pipeline:
    numeric, categorical = task_features(task)
    prep = ColumnTransformer(
        [
            ("num", StandardScaler(), numeric),
            (
                "cat",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False, min_frequency=3),
                categorical,
            ),
        ]
    )
    return Pipeline([("prep", prep), ("clf", ALGORITHMS[algorithm]())])


def _metrics(y_true, proba, threshold: float = 0.5) -> dict:
    pred = (proba >= threshold).astype(int)
    out = {
        "accuracy": accuracy_score(y_true, pred),
        "precision": precision_score(y_true, pred, zero_division=0),
        "recall": recall_score(y_true, pred, zero_division=0),
        "f1": f1_score(y_true, pred, zero_division=0),
    }
    if len(set(y_true)) > 1:
        out["roc_auc"] = roc_auc_score(y_true, proba)
    out = {k: round(float(v), 4) for k, v in out.items()}
    out["confusion_matrix"] = confusion_matrix(y_true, pred, labels=[0, 1]).tolist()
    return out


def train_models(
    db: Session, task: str = "lead", force: bool = False, activate: bool = True
) -> dict:
    """Latih & bandingkan 3 algoritma untuk satu tugas, simpan model terbaik."""
    if not _train_lock.acquire(blocking=False):
        raise RuntimeError("Pelatihan model sedang berjalan")
    try:
        return _train(db, task, force, activate)
    finally:
        _train_lock.release()


def train_all(db: Session, force: bool = False) -> dict[str, dict]:
    """Latih semua tugas yang datanya cukup. Kembalikan {task: laporan | {"error": ...}}."""
    results: dict[str, dict] = {}
    for task in TASKS:
        try:
            results[task] = train_models(db, task=task, force=force)
        except InsufficientDataError as exc:
            results[task] = {"error": str(exc)}
    return results


def _train(db: Session, task: str, force: bool, activate: bool) -> dict:
    s = get_settings()
    df = build_dataset(db, task)
    n_pos = int(df["y"].sum()) if len(df) else 0
    n_neg = len(df) - n_pos
    label = TASKS[task]
    if n_pos < 5 or n_neg < 5:
        raise InsufficientDataError(
            f"[{label}] data belum cukup: {n_pos} positif, {n_neg} negatif (minimal 5 dan 5)"
        )
    if min(n_pos, n_neg) < s.min_positive_samples and not force:
        raise InsufficientDataError(
            f"[{label}] baru {n_pos} positif & {n_neg} negatif; butuh minimal "
            f"{s.min_positive_samples} untuk masing-masing. Sistem tetap memakai skor berbasis aturan."
        )

    numeric, categorical = task_features(task)
    X = df[numeric + categorical]
    y = df["y"].to_numpy()
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)
    n_splits = int(max(2, min(5, y_tr.sum(), len(y_tr) - y_tr.sum())))
    cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)

    comparison: dict[str, dict] = {}
    for name in ALGORITHMS:
        scores = cross_validate(
            _pipeline(name, task), X_tr, y_tr, cv=cv,
            scoring=["accuracy", "precision", "recall", "f1", "roc_auc"],
        )
        cv_res = {}
        for k, v in scores.items():
            if k.startswith("test_"):
                cv_res[k[5:]] = round(float(np.mean(v)), 4)
                cv_res[k[5:] + "_std"] = round(float(np.std(v)), 4)
        fitted = _pipeline(name, task).fit(X_tr, y_tr)
        comparison[name] = {"cv": cv_res, "holdout": _metrics(y_te, fitted.predict_proba(X_te)[:, 1])}

    best = max(
        comparison,
        key=lambda n: (comparison[n]["cv"]["f1"], comparison[n]["cv"].get("roc_auc", 0)),
    )

    # Kepentingan fitur (permutation importance) pada data uji, untuk interpretasi
    best_holdout = _pipeline(best, task).fit(X_tr, y_tr)
    imp = permutation_importance(
        best_holdout, X_te, y_te, scoring="roc_auc", n_repeats=5, random_state=42
    )
    importance = sorted(
        (
            {"feature": f, "importance": round(float(m), 4)}
            for f, m in zip(X.columns, imp.importances_mean)
        ),
        key=lambda d: d["importance"],
        reverse=True,
    )

    final = _pipeline(best, task).fit(X, y)  # model produksi dilatih dengan seluruh data
    version = f"{task}-{best}-{datetime.now(timezone.utc):%Y%m%d%H%M%S}"
    s.model_dir.mkdir(parents=True, exist_ok=True)
    path = s.model_dir / f"{version}.joblib"
    joblib.dump(
        {"pipeline": final, "version": version, "task": task, "features": list(X.columns)}, path
    )

    report = {
        "version": version,
        "task": task,
        "task_label": label,
        "best_algorithm": best,
        "n_samples": int(len(df)),
        "n_positive": n_pos,
        "cv_folds": n_splits,
        "comparison": comparison,
        "feature_importance": importance,
    }
    if activate:
        db.execute(update(ModelRegistry).where(ModelRegistry.task == task).values(is_active=False))
    db.add(
        ModelRegistry(
            version=version, task=task, algorithm=best, n_samples=len(df), n_positive=n_pos,
            metrics=report, is_active=activate, artifact_path=str(path),
        )
    )
    db.commit()
    if activate and task == "lead":
        report["rescored_leads"] = rescore_open_leads(db)
    log.info("Model %s dilatih (F1 CV=%.3f)", version, comparison[best]["cv"]["f1"])
    return report


def rescore_open_leads(db: Session) -> int:
    """Hitung ulang skor lead yang masih dalam proses follow-up dengan model aktif.

    Lead yang sudah selesai (terdaftar/bayar/batal) tidak diubah, agar skor aslinya
    tetap bisa dipakai untuk mengevaluasi ketepatan prediksi.
    """
    from .routers.public import score_lead  # impor lokal: hindari impor melingkar

    leads = db.scalars(
        select(Lead).where(Lead.status.in_(OPEN_STATUSES), Lead.visitor_id.is_not(None))
    ).all()
    for lead in leads:
        score_lead(db, lead)
    db.commit()
    return len(leads)
