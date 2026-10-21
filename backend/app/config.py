from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = f"sqlite:///{BASE_DIR / 'ysii.db'}"
    secret_key: str = "ganti-dengan-string-acak-panjang"
    token_expire_hours: int = 12

    # Domain website mitra yang boleh mengirim data tracking (dipisah koma)
    allowed_origins: str = "https://ysii.org,https://www.ysii.org"
    # URL publik API ini (dipakai tracker untuk memanggil balik)
    public_api_url: str = "https://api.ysii.org"
    # Nomor WhatsApp admin (format 62xxxx) untuk tombol "Hubungi" di dashboard
    whatsapp_admin: str = ""

    # Batas segmen skor konversi
    hot_threshold: float = 0.7
    warm_threshold: float = 0.4

    # Model ML
    model_dir: Path = BASE_DIR / "models"
    # Jumlah minimal contoh positif sebelum model ML menggantikan skor berbasis aturan
    min_positive_samples: int = 30

    # Google Search Console (opsional)
    gsc_site_url: str = "sc-domain:ysii.org"
    gsc_credentials_file: str = ""

    # Notifikasi lead "hot" (opsional, via webhook mis. n8n / Fonnte / Slack)
    hot_lead_webhook_url: str = ""

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
