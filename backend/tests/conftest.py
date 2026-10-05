import time

import pyotp
import pytest
from fastapi.testclient import TestClient

H = {"X-Bastion": "1"}
ADMIN_PASSWORD = "correct-horse-battery"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("BASTION_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("BASTION_PUBLIC_URL", "http://testserver")
    monkeypatch.delenv("BASTION_DATABASE_URL", raising=False)

    from app import config, db, security

    config.get_settings.cache_clear()
    db.get_engine.cache_clear()
    db.get_sessionmaker.cache_clear()
    security.reset_key_caches()

    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c
    db.get_engine().dispose()


def setup_token() -> str:
    from app.api.auth import SetupState

    assert SetupState.token
    return SetupState.token


def future_code(secret: str, steps_ahead: int = 1) -> str:
    """A valid code for a later time step, so it is never rejected as a replay."""
    return pyotp.TOTP(secret).at(time.time() + 30 * steps_ahead)


def create_admin(client: TestClient) -> None:
    r = client.post("/api/auth/setup", headers=H, json={
        "token": setup_token(), "username": "user1", "display_name": "User 1", "password": ADMIN_PASSWORD,
    })
    assert r.status_code == 200, r.text


def login_and_enroll(client: TestClient, username: str, password: str) -> tuple[str, list[str]]:
    r = client.post("/api/auth/login", headers=H, json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    assert r.json()["step"] == "enroll"
    secret = client.get("/api/auth/enroll").json()["secret"]
    r = client.post("/api/auth/enroll", headers=H, json={"code": pyotp.TOTP(secret).now()})
    assert r.status_code == 200, r.text
    return secret, r.json()["recovery_codes"]


@pytest.fixture()
def admin(client):
    create_admin(client)
    secret, codes = login_and_enroll(client, "user1", ADMIN_PASSWORD)
    return {"secret": secret, "codes": codes}
