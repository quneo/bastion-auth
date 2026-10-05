from fastapi.testclient import TestClient

from tests.conftest import H, login_and_enroll


def make_user(client, username="masha", groups=None, password="masha-password-1"):
    r = client.post("/api/admin/users", headers=H, json={
        "username": username, "display_name": username.title(), "password": password,
        "email": f"{username}@citadel.lan", "group_ids": groups or [],
    })
    assert r.status_code == 201, r.text
    return r.json()


def test_admin_manages_users_groups_projects(client, admin):
    group = client.post("/api/admin/groups", headers=H, json={"name": "family", "description": "Мы"}).json()
    user = make_user(client, groups=[group["id"]])
    assert [g["name"] for g in user["groups"]] == ["family"]
    assert user["totp_enrolled"] is False

    assert client.post("/api/admin/users", headers=H, json={
        "username": "masha", "display_name": "x", "password": "masha-password-1"}).status_code == 409
    assert client.post("/api/admin/users", headers=H, json={
        "username": "Bad Name!", "display_name": "x", "password": "masha-password-1"}).status_code == 422

    r = client.post("/api/admin/projects", headers=H, json={
        "name": "MoneyChichhi", "url": "http://192.168.31.93:8080",
        "redirect_uris": ["http://192.168.31.93:8080/auth/callback"], "group_ids": [group["id"]],
    })
    assert r.status_code == 201
    body = r.json()
    assert body["client_secret"] and body["project"]["client_id"].startswith("bastion-")

    groups = {g["name"]: g for g in client.get("/api/admin/groups").json()}
    assert groups["family"]["member_count"] == 1
    assert groups["admins"]["is_system"] is True
    assert client.delete(f"/api/admin/groups/{groups['admins']['id']}", headers=H).status_code == 400

    overview = client.get("/api/admin/overview").json()
    assert overview["users"] == 2 and overview["users_without_totp"] == 1 and overview["projects"] == 1

    events = [e["event"] for e in client.get("/api/admin/audit").json()]
    assert {"user_created", "group_created", "project_created", "login", "totp_enrolled"} <= set(events)


def test_regular_user_cannot_use_admin_api(client, admin):
    make_user(client)
    other = TestClient(client.app)
    login_and_enroll(other, "masha", "masha-password-1")
    assert other.get("/api/me").status_code == 200
    assert other.get("/api/admin/users").status_code == 403


def test_admin_cannot_lock_themselves_out(client, admin):
    me = client.get("/api/me").json()
    r = client.patch(f"/api/admin/users/{me['id']}", headers=H, json={"group_ids": []})
    assert r.json()["detail"]["code"] == "cannot_leave_admins"
    r = client.patch(f"/api/admin/users/{me['id']}", headers=H, json={"is_active": False})
    assert r.json()["detail"]["code"] == "cannot_disable_self"
    assert client.delete(f"/api/admin/users/{me['id']}", headers=H).json()["detail"]["code"] == "cannot_delete_self"


def test_disabling_user_ends_their_sessions(client, admin):
    user = make_user(client)
    other = TestClient(client.app)
    login_and_enroll(other, "masha", "masha-password-1")
    client.patch(f"/api/admin/users/{user['id']}", headers=H, json={"is_active": False})
    assert other.get("/api/me").status_code == 401
    r = other.post("/api/auth/login", headers=H, json={"username": "masha", "password": "masha-password-1"})
    assert r.status_code == 401


def test_reset_totp_forces_re_enrollment(client, admin):
    user = make_user(client)
    other = TestClient(client.app)
    login_and_enroll(other, "masha", "masha-password-1")
    assert client.post(f"/api/admin/users/{user['id']}/reset-totp", headers=H).status_code == 200
    assert other.get("/api/me").status_code == 401
    r = other.post("/api/auth/login", headers=H, json={"username": "masha", "password": "masha-password-1"})
    assert r.json()["step"] == "enroll"


def test_services_list_respects_groups(client, admin):
    group = client.post("/api/admin/groups", headers=H, json={"name": "family"}).json()
    client.post("/api/admin/projects", headers=H, json={"name": "Finance", "group_ids": [group["id"]]})
    client.post("/api/admin/projects", headers=H, json={"name": "Photos", "allow_all_users": True})
    make_user(client)
    other = TestClient(client.app)
    login_and_enroll(other, "masha", "masha-password-1")
    assert [s["name"] for s in other.get("/api/me/services").json()] == ["Photos"]
