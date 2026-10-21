import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.db import SessionLocal
from app.features import compute_features
from app.features import visitor_features
from app.ml_engine import InsufficientDataError, train_all, train_models
from app.models import Event, Lead, Visitor
from app.scoring import RULE_VERSION, rule_score, score_features


def _visitor(first):
    return Visitor(visitor_id=str(uuid.uuid4()), ref_code="X", first_seen_at=first, last_seen_at=first,
                   first_source="google", first_medium="organic", first_landing="/program/barista", device_type="mobile")


def test_features_respect_cutoff():
    t0 = datetime(2026, 9, 1, tzinfo=timezone.utc)
    v = _visitor(t0)
    evs = [
        Event(session_id="s1", visitor_id=v.visitor_id, ts=t0, type="page_view", page_category="program", program_slug="barista"),
        Event(session_id="s1", visitor_id=v.visitor_id, ts=t0 + timedelta(minutes=1), type="click_whatsapp"),
        Event(session_id="s2", visitor_id=v.visitor_id, ts=t0 + timedelta(days=2), type="view_price"),
    ]
    f = compute_features(v, evs, {}, as_of=t0 + timedelta(minutes=5))
    assert f["n_click_whatsapp"] == 1 and f["n_view_price"] == 0 and f["n_sessions"] == 1
    assert f["engagement_span_days"] < 0.01
    full = compute_features(v, evs, {})
    assert full["n_view_price"] == 1 and full["n_sessions"] == 2 and full["is_returning"] == 1


def test_rule_score_orders_engaged_higher():
    low, _ = rule_score({"bounce_rate": 1}, task="visitor")
    high, reasons = rule_score(
        {"n_click_whatsapp": 1, "n_view_price": 2, "is_returning": 1, "total_active_sec": 300}, task="visitor"
    )
    assert 0 < low < 0.1 < 0.7 < high < 1
    assert "Klik tombol WhatsApp" in reasons
    # untuk lead, isi form / klik WA tidak menaikkan skor (semua lead melakukannya)
    lead_only_form, _ = rule_score({"n_form_start": 1, "n_click_whatsapp": 1}, task="lead")
    lead_researched, _ = rule_score({"n_form_start": 1, "n_view_price": 2, "is_returning": 1, "n_deep_program_reads": 2}, task="lead")
    assert lead_only_form < 0.4 < lead_researched


def test_training_on_simulated_data(client, monkeypatch):
    from scripts import generate_synthetic

    with SessionLocal() as db:
        with pytest.raises(InsufficientDataError):
            train_models(db, task="lead")

    monkeypatch.setattr(sys, "argv", ["gen", "--visitors", "1200", "--days", "30", "--force"])
    generate_synthetic.main()

    with SessionLocal() as db:
        results = train_all(db, force=True)
        for task in ("lead", "visitor"):
            report = results[task]
            assert "error" not in report, report
            assert set(report["comparison"]) == {"logistic_regression", "random_forest", "gradient_boosting"}
            # data simulasi kecil: cukup pastikan model lebih baik dari tebakan acak
            assert report["comparison"][report["best_algorithm"]]["cv"]["roc_auc"] > 0.6
            assert report["feature_importance"][0]["feature"] != "engagement_span_days"
        # model lead hanya dilatih dari lead dengan hasil yang sudah diketahui
        n_known = db.query(Lead).filter(Lead.converted.is_not(None), Lead.visitor_id.is_not(None)).count()
        assert results["lead"]["n_samples"] <= n_known
        assert results["visitor"]["n_samples"] > results["lead"]["n_samples"]

        v = db.query(Visitor).first()
        feats = visitor_features(db, v.visitor_id)
        for task in ("lead", "visitor"):
            r = score_features(db, feats, task=task)
            assert r["model_version"] == results[task]["version"] != RULE_VERSION
            assert 0 <= r["score"] <= 1

        # skor lead yang masih berjalan diperbarui & bervariasi (tidak semuanya hot)
        open_leads = db.query(Lead).filter(Lead.status.in_(["baru", "dihubungi", "tertarik"])).all()
        segments = {l.segment for l in open_leads}
        assert len(segments) >= 2, segments
