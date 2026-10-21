import uuid
from datetime import date, timedelta

from app.db import SessionLocal
from app.models import Event, Lead, Visitor, VisitSession


def _collect(client, vid, sid, events, **ctx):
    payload = {
        "ctx": {"visitor_id": vid, "session_id": sid, "page_url": "https://ysii.org/program/barista",
                "referrer": "https://www.google.com/", "device": "mobile", **ctx},
        "events": events,
    }
    import json
    return client.post("/v1/collect", content=json.dumps(payload), headers={"Content-Type": "text/plain"})


def test_collect_creates_visitor_session_events(client):
    vid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    r = _collect(client, vid, sid, [
        {"type": "page_view"}, {"type": "scroll", "value": 75}, {"type": "heartbeat", "value": 42},
        {"type": "click_whatsapp", "label": "Chat"}, {"type": "hacker_event"},
    ])
    assert r.status_code == 204
    with SessionLocal() as db:
        v = db.get(Visitor, vid)
        assert v.first_source == "google" and v.first_medium == "organic"
        assert v.first_landing == "/program/barista"
        s = db.get(VisitSession, sid)
        assert (s.page_count, s.active_seconds, s.max_scroll_pct) == (1, 42, 75)
        types = {e.type for e in db.query(Event).filter(Event.visitor_id == vid)}
        assert types == {"page_view", "scroll", "heartbeat", "click_whatsapp"}
        assert {e.program_slug for e in db.query(Event).filter(Event.visitor_id == vid)} == {"barista"}


def test_collect_rejects_bad_payload(client):
    assert client.post("/v1/collect", content="bukan json").status_code == 422
    r = _collect(client, "bukan-uuid", str(uuid.uuid4()), [{"type": "page_view"}])
    assert r.status_code == 422


def test_session_hijack_rejected(client):
    sid = str(uuid.uuid4())
    assert _collect(client, str(uuid.uuid4()), sid, [{"type": "page_view"}]).status_code == 204
    assert _collect(client, str(uuid.uuid4()), sid, [{"type": "page_view"}]).status_code == 422


def test_lead_from_website_form_is_linked_and_scored(client):
    vid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    _collect(client, vid, sid, [{"type": "page_view"}, {"type": "view_price"}, {"type": "form_start"}])
    r = client.post("/v1/leads", data={
        "nama": "Budi", "no_hp": "0812 1111 2222", "program": "Barista", "visitor_id": vid,
        "_redirect": "https://ysii.org/terima-kasih", "kota": "Medan",
    }, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "https://ysii.org/terima-kasih"
    with SessionLocal() as db:
        lead = db.query(Lead).filter(Lead.visitor_id == vid).one()
        assert lead.name == "Budi" and lead.phone == "6281211112222" and lead.program_slug == "barista"
        assert lead.extra == {"kota": "Medan"}
        assert lead.score is not None and lead.segment in {"hot", "warm", "cold"}

    # kiriman ulang dalam 30 menit tidak membuat lead ganda
    client.post("/v1/leads", json={"name": "Budi S", "phone": "081211112222"})
    with SessionLocal() as db:
        assert db.query(Lead).filter(Lead.phone == "6281211112222").count() == 1


def test_lead_validation_honeypot_and_redirect(client):
    assert client.post("/v1/leads", json={"name": "Tanpa kontak"}).status_code == 422
    r = client.post("/v1/leads", json={"name": "Bot", "phone": "0811", "website": "spam.com"})
    assert r.status_code == 200
    with SessionLocal() as db:
        assert db.query(Lead).filter(Lead.name == "Bot").count() == 0
    r = client.post("/v1/leads", data={"phone": "0813999", "_redirect": "https://jahat.com/"}, follow_redirects=False)
    assert r.status_code == 200  # redirect ke domain asing diabaikan


def test_admin_requires_login(client):
    assert client.get("/v1/admin/leads").status_code == 401
    assert client.post("/v1/auth/login", json={"username": "admin", "password": "salah"}).status_code == 401


def test_admin_lead_flow(client, auth):
    vid = str(uuid.uuid4())
    _collect(client, vid, str(uuid.uuid4()), [{"type": "page_view"}, {"type": "click_whatsapp"}])
    with SessionLocal() as db:
        code = db.get(Visitor, vid).ref_code

    r = client.post("/v1/admin/leads", headers=auth, json={"name": "Sari", "phone": "0857 0000 1111", "ref_code": f"#{code.lower()}"})
    assert r.status_code == 201, r.text
    lead = r.json()
    assert lead["visitor_id"] == vid and lead["channel"] == "whatsapp" and lead["score"] is not None

    assert client.post("/v1/admin/leads", headers=auth, json={"phone": "1", "ref_code": "ZZZZZZ"}).status_code == 404

    r = client.patch(f"/v1/admin/leads/{lead['lead_id']}", headers=auth, json={"status": "bayar", "notes": "Lunas"})
    assert r.json()["converted"] is True
    r = client.patch(f"/v1/admin/leads/{lead['lead_id']}", headers=auth, json={"status": "batal"})
    assert r.json()["converted"] is False
    assert client.patch(f"/v1/admin/leads/{lead['lead_id']}", headers=auth, json={"status": "aneh"}).status_code == 422

    d = client.get(f"/v1/admin/leads/{lead['lead_id']}", headers=auth).json()
    assert d["visitor"]["ref_code"] == code
    assert any(t["type"] == "click_whatsapp" for t in d["timeline"])
    assert d["score"]["reasons"]

    listing = client.get("/v1/admin/leads?sort=score", headers=auth).json()
    assert listing["total"] >= 1
    open_only = client.get("/v1/admin/leads?status=berjalan", headers=auth).json()
    assert all(l["status"] in {"baru", "dihubungi", "tertarik"} for l in open_only["items"])
    assert lead["lead_id"] not in [l["lead_id"] for l in open_only["items"]]  # sudah "batal"
    assert client.get("/v1/admin/kpi?days=30", headers=auth).json()["leads"] >= 1
    csv = client.get("/v1/admin/export/leads.csv", headers=auth)
    assert csv.status_code == 200 and "lead_id" in csv.text


def test_programs_and_recommendation(client, auth):
    for slug, name in [("barista", "Barista"), ("desain-grafis", "Desain Grafis"), ("public-speaking", "Public Speaking")]:
        body = {"slug": slug, "name": name, "url": f"https://ysii.org/program/{slug}",
                "next_batch": (date.today() + timedelta(days=10)).isoformat()}
        assert client.put(f"/v1/admin/programs/{slug}", headers=auth, json=body).status_code == 200
    assert client.put("/v1/admin/programs/x", headers=auth, json={"slug": "y", "name": "n"}).status_code == 422

    # pengunjung lain melihat barista lalu desain-grafis
    other = str(uuid.uuid4())
    sid = str(uuid.uuid4())
    _collect(client, other, sid, [{"type": "page_view"}])
    _collect(client, other, sid, [{"type": "page_view"}], page_url="https://ysii.org/program/desain-grafis")

    me = str(uuid.uuid4())
    _collect(client, me, str(uuid.uuid4()), [{"type": "page_view"}])
    r = client.get(f"/v1/recommend/{me}?current=barista").json()
    assert r["programs"][0]["slug"] == "desain-grafis"
    assert all(p["slug"] != "barista" for p in r["programs"])
    assert r["cta"]["type"] in {"daftar", "konsultasi", "edukasi"}
    assert client.get("/v1/recommend/bukan-uuid").status_code == 200


def test_static_assets_served(client):
    assert "ysii" in client.get("/static/tracker.js").text
    assert client.get("/dashboard/").status_code == 200
