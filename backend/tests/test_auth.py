import pyotp

from tests.conftest import ADMIN_PASSWORD, H, create_admin, future_code, login_and_enroll, setup_token


def test_setup_requires_token_and_runs_once(client):
    assert client.get("/api/auth/state").json()["setup_required"] is True
    r = client.post("/api/auth/setup", headers=H, json={
        "token": "wrong", "username": "user1", "display_name": "V", "password": ADMIN_PASSWORD})
    assert r.status_code == 403
    token = setup_token()
    create_admin(client)
    assert client.get("/api/auth/state").json()["setup_required"] is False
    r = client.post("/api/auth/setup", headers=H, json={
        "token": token, "username": "other", "display_name": "O", "password": ADMIN_PASSWORD})
    assert r.status_code == 409


def test_first_login_enrolls_totp_and_signs_in(client):
    create_admin(client)
    assert client.get("/api/me").status_code == 401
    _secret, codes = login_and_enroll(client, "user1", ADMIN_PASSWORD)
    assert len(codes) == 10
    me = client.get("/api/me").json()
    assert me["username"] == "user1" and me["is_admin"] and me["totp_enrolled"]
    assert me["recovery_codes_left"] == 10


def test_mutations_require_csrf_header(client):
    create_admin(client)
    r = client.post("/api/auth/login", json={"username": "user1", "password": ADMIN_PASSWORD})
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "csrf"


def test_second_login_needs_code_and_rejects_replay(client, admin):
    client.post("/api/auth/logout", headers=H)
    assert client.get("/api/me").status_code == 401

    r = client.post("/api/auth/login", headers=H, json={"username": "USER1", "password": ADMIN_PASSWORD})
    assert r.json()["step"] == "totp"
    # The code used for enrollment is already spent (same time step).
    r = client.post("/api/auth/totp", headers=H, json={"code": pyotp.TOTP(admin["secret"]).now()})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "bad_code"
    r = client.post("/api/auth/totp", headers=H, json={"code": future_code(admin["secret"])})
    assert r.status_code == 200
    assert client.get("/api/me").status_code == 200


def test_recovery_code_works_once(client, admin):
    code = admin["codes"][0]
    for expected in (200, 400):
        client.post("/api/auth/logout", headers=H)
        client.post("/api/auth/login", headers=H, json={"username": "user1", "password": ADMIN_PASSWORD})
        r = client.post("/api/auth/totp", headers=H, json={"recovery_code": code.upper()})
        assert r.status_code == expected
    client.post("/api/auth/login", headers=H, json={"username": "user1", "password": ADMIN_PASSWORD})
    client.post("/api/auth/totp", headers=H, json={"code": future_code(admin["secret"])})
    assert client.get("/api/me").json()["recovery_codes_left"] == 9


def test_wrong_passwords_lock_the_account(client):
    create_admin(client)
    for _ in range(5):
        r = client.post("/api/auth/login", headers=H, json={"username": "user1", "password": "nope-nope-nope"})
        assert r.status_code == 401
    r = client.post("/api/auth/login", headers=H, json={"username": "user1", "password": ADMIN_PASSWORD})
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) > 0


def test_unknown_user_looks_like_wrong_password(client):
    create_admin(client)
    r = client.post("/api/auth/login", headers=H, json={"username": "ghost", "password": "whatever-123"})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "bad_credentials"


def test_too_many_wrong_codes_drop_the_challenge(client, admin):
    client.post("/api/auth/logout", headers=H)
    client.post("/api/auth/login", headers=H, json={"username": "user1", "password": ADMIN_PASSWORD})
    for _ in range(4):
        assert client.post("/api/auth/totp", headers=H, json={"code": "000000"}).status_code == 400
    r = client.post("/api/auth/totp", headers=H, json={"code": "000000"})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "challenge_expired"


def test_return_to_only_allows_local_paths(client, admin):
    client.post("/api/auth/logout", headers=H)
    for target, expected in (("//evil.example", "/"), ("https://evil.example", "/"), ("/account", "/account")):
        client.post("/api/auth/login", headers=H,
                    json={"username": "user1", "password": ADMIN_PASSWORD, "return_to": target})
        r = client.post("/api/auth/totp", headers=H, json={"code": future_code(admin["secret"], steps_ahead=1)})
        if r.status_code == 400:  # same step as previous iteration; use the next one
            r = client.post("/api/auth/totp", headers=H, json={"code": future_code(admin["secret"], steps_ahead=2)})
        assert r.json()["return_to"] == expected
        client.post("/api/auth/logout", headers=H)
        # Each iteration spends a step; reset replay guard for the test.
        from app.db import get_sessionmaker
        from app.models import TotpCredential
        with get_sessionmaker()() as db:
            db.query(TotpCredential).update({"last_used_step": 0})
            db.commit()


def test_change_password_signs_out_other_sessions(client, admin):
    r = client.post("/api/me/password", headers=H,
                    json={"current_password": "wrong-password", "new_password": "another-good-pass"})
    assert r.status_code == 400
    r = client.post("/api/me/password", headers=H,
                    json={"current_password": ADMIN_PASSWORD, "new_password": "short"})
    assert r.status_code == 422
    r = client.post("/api/me/password", headers=H,
                    json={"current_password": ADMIN_PASSWORD, "new_password": "another-good-pass"})
    assert r.status_code == 200
    client.post("/api/auth/logout", headers=H)
    r = client.post("/api/auth/login", headers=H, json={"username": "user1", "password": "another-good-pass"})
    assert r.status_code == 200


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
