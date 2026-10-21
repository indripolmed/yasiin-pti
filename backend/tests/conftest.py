import os
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="ysii-test-"))
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_tmp / 'test.db'}")
os.environ["MODEL_DIR"] = str(_tmp / "models")
os.environ["SECRET_KEY"] = "test-secret-key-yang-cukup-panjang-untuk-hs256"
os.environ["ALLOWED_ORIGINS"] = "https://ysii.org"
os.environ["MIN_POSITIVE_SAMPLES"] = "10"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import SessionLocal, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import AdminUser  # noqa: E402
from app.security import hash_password  # noqa: E402


@pytest.fixture(scope="session")
def client():
    init_db()
    with SessionLocal() as db:
        db.add(AdminUser(username="admin", password_hash=hash_password("rahasia-sekali-123")))
        db.commit()
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def auth(client):
    r = client.post("/v1/auth/login", json={"username": "admin", "password": "rahasia-sekali-123"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}
