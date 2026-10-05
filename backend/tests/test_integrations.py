import base64
import hashlib
from urllib.parse import parse_qs, urlsplit

import jwt
import pyotp
from fastapi.testclient import TestClient
from jwt import PyJWK

from tests.conftest import H, future_code

REDIRECT = "http://app.citadel.lan/auth/callback"


def make_project(client, **extra):
    group = client.post("/api/admin/groups", headers=H, json={"name": "family"}).json()
    body = {"name": "Finance", "redirect_uris": [REDIRECT], "group_ids": [group["id"]], **extra}
    r = client.post("/api/admin/projects", headers=H, json=body).json()
    return r["project"], r["client_secret"], group


# ---------- service API ----------


def test_service_api_authenticates_with_totp(client, admin):
    project, secret, group = make_project(client)
    auth = (project["client_id"], secret)

    assert client.post("/api/v1/authenticate", json={"username": "vadim", "password": "x"}).status_code == 401
    # admin is not in "family" yet: refused right after the password, the code is not spent
    r = client.post("/api/v1/authenticate", auth=auth, json={
        "username": "vadim", "password": "correct-horse-battery", "totp_code": future_code(admin["secret"])})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "access_denied"

    me = client.get("/api/me").json()
    client.patch(f"/api/admin/users/{me['id']}", headers=H,
                 json={"group_ids": [g["id"] for g in me["groups"]] + [group["id"]]})
    r = client.post("/api/v1/authenticate", auth=auth, json={"username": "vadim", "password": "correct-horse-battery"})
    assert r.json()["detail"]["code"] == "totp_required"
    r = client.post("/api/v1/authenticate", auth=auth, json={
        "username": "vadim", "password": "correct-horse-battery", "totp_code": future_code(admin["secret"])})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["groups"] == ["admins", "family"]

    users = client.get("/api/v1/users", auth=auth).json()
    assert [u["username"] for u in users] == ["vadim"]


def test_service_api_rejects_wrong_secret(client, admin):
    project, _secret, _ = make_project(client)
    r = client.get("/api/v1/users", auth=(project["client_id"], "wrong"))
    assert r.status_code == 401


# ---------- OIDC ----------


def pkce():
    verifier = "v" * 64
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def test_discovery_and_jwks(client):
    conf = client.get("/.well-known/openid-configuration").json()
    assert conf["issuer"] == "http://testserver"
    assert conf["code_challenge_methods_supported"] == ["S256"]
    key = client.get("/oidc/jwks").json()["keys"][0]
    assert key["kty"] == "RSA" and key["alg"] == "RS256" and key["kid"]


def test_oidc_code_flow_with_pkce(client, admin):
    project, secret, group = make_project(client, allow_all_users=True)
    verifier, challenge = pkce()
    params = {"response_type": "code", "client_id": project["client_id"], "redirect_uri": REDIRECT,
              "scope": "openid profile email groups", "state": "st4te", "nonce": "n0nce",
              "code_challenge": challenge, "code_challenge_method": "S256"}

    anon = TestClient(client.app, follow_redirects=False)
    r = anon.get("/oidc/authorize", params=params)
    assert r.status_code == 302 and r.headers["location"].startswith("/login?return_to=%2Foidc%2Fauthorize")

    r = TestClient(client.app, follow_redirects=False, cookies=client.cookies).get("/oidc/authorize", params=params)
    assert r.status_code == 302
    location = urlsplit(r.headers["location"])
    assert f"{location.scheme}://{location.netloc}{location.path}" == REDIRECT
    q = parse_qs(location.query)
    assert q["state"] == ["st4te"] and q["iss"] == ["http://testserver"]
    code = q["code"][0]

    bad = client.post("/oidc/token", auth=(project["client_id"], secret), data={
        "grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT, "code_verifier": "x" * 64})
    assert bad.json()["error"] == "invalid_grant"

    # The failed attempt burned the code; get a fresh one.
    r = TestClient(client.app, follow_redirects=False, cookies=client.cookies).get("/oidc/authorize", params=params)
    code = parse_qs(urlsplit(r.headers["location"]).query)["code"][0]
    r = client.post("/oidc/token", data={
        "grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT, "code_verifier": verifier,
        "client_id": project["client_id"], "client_secret": secret})
    assert r.status_code == 200, r.text
    tokens = r.json()
    assert r.headers["cache-control"] == "no-store"

    jwk = PyJWK(client.get("/oidc/jwks").json()["keys"][0])
    claims = jwt.decode(tokens["id_token"], jwk.key, algorithms=["RS256"], audience=project["client_id"],
                        issuer="http://testserver")
    assert claims["preferred_username"] == "vadim" and claims["nonce"] == "n0nce"
    assert claims["groups"] == ["admins"]

    info = client.get("/oidc/userinfo", headers={"Authorization": f"Bearer {tokens['access_token']}"}).json()
    assert info["sub"] == claims["sub"] and info["name"] == "Вадим"

    again = client.post("/oidc/token", auth=(project["client_id"], secret), data={
        "grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT, "code_verifier": verifier})
    assert again.json()["error"] == "invalid_grant"


def test_oidc_rejects_unregistered_redirect(client, admin):
    project, _secret, _ = make_project(client)
    r = TestClient(client.app, follow_redirects=False, cookies=client.cookies).get("/oidc/authorize", params={
        "response_type": "code", "client_id": project["client_id"], "redirect_uri": "http://evil.example/cb",
        "scope": "openid"})
    assert r.headers["location"] == "/error?code=bad_redirect_uri"


def test_oidc_denies_users_outside_allowed_groups(client, admin):
    project, _secret, _ = make_project(client)
    r = TestClient(client.app, follow_redirects=False, cookies=client.cookies).get("/oidc/authorize", params={
        "response_type": "code", "client_id": project["client_id"], "redirect_uri": REDIRECT,
        "scope": "openid", "state": "s"})
    q = parse_qs(urlsplit(r.headers["location"]).query)
    assert q["error"] == ["access_denied"] and q["state"] == ["s"]


def test_totp_qr_is_rendered(client):
    from tests.conftest import ADMIN_PASSWORD, create_admin

    create_admin(client)
    client.post("/api/auth/login", headers=H, json={"username": "vadim", "password": ADMIN_PASSWORD})
    data = client.get("/api/auth/enroll").json()
    assert data["qr_svg"].startswith("<svg") and "otpauth://totp/" in data["otpauth_uri"]
    assert pyotp.TOTP(data["secret"]).now()
    # The secret stays the same if the page is reloaded.
    assert client.get("/api/auth/enroll").json()["secret"] == data["secret"]
