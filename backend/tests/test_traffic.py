from app.routers.public import normalize_phone, ref_code_for
from app.traffic import classify_source, page_category, query_intent


def test_classify_source():
    assert classify_source("https://www.google.co.id/", None, None) == ("google", "organic")
    assert classify_source("https://l.facebook.com/x", None, None) == ("facebook", "social")
    assert classify_source(None, None, None) == ("direct", "none")
    assert classify_source("https://ysii.org/a", None, None) == ("direct", "none")
    assert classify_source("https://blog.contoh.id/", None, None) == ("blog.contoh.id", "referral")
    assert classify_source("https://google.com", "Instagram", "paid_social") == ("instagram", "cpc")
    assert classify_source(None, "google", "CPC") == ("google", "cpc")


def test_page_category():
    assert page_category("/") == "beranda"
    assert page_category("/program/barista") == "program"
    assert page_category("/tentang-kami") == "tentang"
    assert page_category("/2026/05/judul-artikel") == "artikel"
    assert page_category("/apa-saja", program_slug="barista") == "program"


def test_query_intent():
    assert query_intent("ysii medan") == "brand"
    assert query_intent("biaya kursus barista") == "transaksional"
    assert query_intent("pelatihan barista medan") == "lokal"
    assert query_intent("kursus desain grafis online") == "komersial"
    assert query_intent("apa itu digital marketing") == "informasional"
    assert query_intent(None) == "tidak_diketahui"


def test_phone_and_ref():
    assert normalize_phone("0812-3456-7890") == "6281234567890"
    assert normalize_phone("+62 812 3456") == "628123456"
    assert ref_code_for("ab12cd34-0000-4000-8000-000000000000") == "AB12CD"


def test_parse_form_fields_from_various_plugins():
    from app.routers.public import parse_lead_fields

    cf7 = parse_lead_fields({"your-name": "Ani", "your-phone": "0812 3456 7890", "your-email": "a@b.id",
                             "menu-pelatihan": "Barista", "_wpcf7": "12", "your-message": "Halo"})
    assert (cf7["name"], cf7["phone"], cf7["email"], cf7["program_slug"], cf7["message"]) == (
        "Ani", "0812 3456 7890", "a@b.id", "Barista", "Halo")
    assert cf7["extra"] == {}

    elementor = parse_lead_fields({"form_fields[name]": "Budi", "form_fields[field_wa]": "081299998888",
                                   "post_id": "5", "form_fields[kota]": "Medan"})
    assert elementor["name"] == "Budi" and elementor["phone"] == "081299998888"
    assert elementor["extra"] == {"form_fields[kota]": "Medan"}

    wpforms = parse_lead_fields({"wpforms[fields][0]": "Citra", "wpforms[fields][1]": "+62 813-1111-2222",
                                 "wpforms[fields][2]": "citra@mail.com"})
    assert wpforms["phone"] == "+62 813-1111-2222" and wpforms["email"] == "citra@mail.com"

    mixed = parse_lead_fields({"nama_program": "Barista", "nama_lengkap": "Dewi", "no_hp": "0812"})
    assert (mixed["program_slug"], mixed["name"], mixed["phone"]) == ("Barista", "Dewi", "0812")
