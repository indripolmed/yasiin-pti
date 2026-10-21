"""Klasifikasi sumber traffic, kategori halaman, dan intent kata kunci."""

import re
from urllib.parse import urlparse

SEARCH_ENGINES = ("google.", "bing.", "yahoo.", "duckduckgo.", "yandex.", "ecosia.")
SOCIAL = {
    "facebook": ("facebook.", "fb.", "m.facebook"),
    "instagram": ("instagram.",),
    "tiktok": ("tiktok.",),
    "youtube": ("youtube.", "youtu.be"),
    "linkedin": ("linkedin.", "lnkd.in"),
    "twitter": ("twitter.", "t.co", "x.com"),
    "whatsapp": ("whatsapp.", "wa.me"),
    "telegram": ("t.me", "telegram."),
}
PAID_MEDIUMS = {"cpc", "ppc", "paid", "paidsearch", "paid_social", "ads"}


def classify_source(
    referrer: str | None,
    utm_source: str | None,
    utm_medium: str | None,
    own_hosts: tuple[str, ...] = ("ysii.org",),
) -> tuple[str, str]:
    """Kembalikan (source, medium), misal ('google', 'organic')."""
    if utm_source:
        medium = (utm_medium or "referral").lower()
        if medium in PAID_MEDIUMS:
            medium = "cpc"
        return utm_source.lower()[:64], medium[:32]

    host = (urlparse(referrer).hostname or "").lower() if referrer else ""
    if not host or any(host.endswith(h) for h in own_hosts):
        return "direct", "none"
    for engine in SEARCH_ENGINES:
        if engine in host:
            return engine.rstrip("."), "organic"
    for name, patterns in SOCIAL.items():
        if any(p in host for p in patterns):
            return name, "social"
    return host[:64], "referral"


def page_category(path: str | None, program_slug: str | None = None) -> str:
    if program_slug:
        return "program"
    p = (path or "/").lower()
    if p in ("", "/", "/index.html", "/home"):
        return "beranda"
    if re.search(r"/(program|pelatihan|kursus|training|sertifikasi|skema|kelas)", p):
        return "program"
    if re.search(r"/(daftar|pendaftaran|register|registrasi)", p):
        return "pendaftaran"
    if re.search(r"/(kontak|contact|hubungi)", p):
        return "kontak"
    if re.search(r"/(tentang|about|profil|visi)", p):
        return "tentang"
    if re.search(r"/(blog|artikel|berita|news|\d{4}/\d{2})", p):
        return "artikel"
    return "lainnya"


_INTENT_RULES = [
    ("brand", r"\b(ysii|sinergi inspirasi)\b"),
    ("transaksional", r"\b(daftar|pendaftaran|biaya|harga|jadwal|registrasi|promo|diskon)\b"),
    ("lokal", r"\b(medan|sumut|sumatera utara|terdekat|dekat)\b"),
    ("komersial", r"\b(pelatihan|kursus|sertifikasi|training|bnsp|kelas|bersertifikat|lsp)\b"),
    ("informasional", r"\b(apa|cara|adalah|bagaimana|manfaat|contoh|pengertian|tips|prospek)\b"),
]


def query_intent(query: str | None) -> str:
    """Kategori intent kata kunci pencarian (aturan sederhana, bisa diperluas)."""
    if not query:
        return "tidak_diketahui"
    q = query.lower()
    for intent, pattern in _INTENT_RULES:
        if re.search(pattern, q):
            return intent
    return "lainnya"


def normalize_path(url: str | None) -> str:
    if not url:
        return "/"
    parsed = urlparse(url)
    return (parsed.path or "/").rstrip("/") or "/"


_PROGRAM_PATH = re.compile(r"/(?:program|pelatihan|kursus|sertifikasi|training|kelas)/([a-z0-9-]+)", re.I)


def program_from_path(path: str | None) -> str | None:
    m = _PROGRAM_PATH.search(path or "")
    return m.group(1).lower() if m else None
