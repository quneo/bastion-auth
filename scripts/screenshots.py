"""Walks through Bastion like a person would and saves screenshots for the README.

Usage (against a fresh instance with no users):
    python scripts/screenshots.py http://127.0.0.1:8800 <setup-token>

Uses the locally installed Microsoft Edge through Playwright (no browser download).
Needs: pip install playwright pillow pyotp
"""

import sys
import time
from pathlib import Path

import pyotp
from PIL import Image
from playwright.sync_api import Page, sync_playwright

BASE = sys.argv[1].rstrip("/")
TOKEN = sys.argv[2]
OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
H = {"X-Bastion": "1"}
ADMIN = ("vadim", "Вадим", "demo-password-123")


def shot(page: Page, name: str, full: bool = False) -> None:
    page.wait_for_timeout(450)
    png = OUT / f"{name}.png"
    page.screenshot(path=str(png), full_page=full)
    Image.open(png).save(OUT / f"{name}.webp", "WEBP", quality=84, method=6)
    png.unlink()
    print("saved", name)


def code_at(secret: str, ahead: int) -> str:
    return pyotp.TOTP(secret).at(time.time() + 30 * ahead)


def type_code(page: Page, code: str) -> None:
    page.locator(".code-cell").first.click()
    page.keyboard.type(code, delay=40)


def post(page: Page, path: str, data: dict) -> dict:
    r = page.request.post(BASE + path, headers=H, data=data)
    assert r.ok, (path, r.status, r.text())
    return r.json()


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="msedge")
    light = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light", locale="ru-RU")
    page = light.new_page()

    # first admin
    page.goto(BASE + "/setup")
    shot(page, "00-setup")
    r = page.request.post(BASE + "/api/auth/setup", headers=H, data={
        "token": TOKEN, "username": ADMIN[0], "display_name": ADMIN[1], "password": ADMIN[2]})
    assert r.ok, r.text()

    # sign in and bind the phone
    page.goto(BASE + "/login")
    page.wait_for_timeout(1800)
    page.get_by_label("Логин").fill(ADMIN[0])
    page.get_by_label("Пароль").fill(ADMIN[2])
    shot(page, "01-login")
    page.get_by_role("button", name="Продолжить").click()
    page.wait_for_selector(".qr svg")
    page.get_by_text("Не сканируется").click()
    secret = page.locator(".secret").inner_text().replace(" ", "")
    shot(page, "02-enroll")
    type_code(page, pyotp.TOTP(secret).now())
    page.wait_for_selector(".recovery-list")
    shot(page, "03-recovery-codes")
    page.get_by_role("button", name="Коды сохранены, продолжить").click()
    page.wait_for_url(BASE + "/")

    # demo data
    family = post(page, "/api/admin/groups", {"name": "family", "description": "Мы вдвоём: бюджет, фото, планы"})
    post(page, "/api/admin/groups", {"name": "guests", "description": "Друзья: только фотоальбомы"})
    me = page.request.get(BASE + "/api/me").json()
    page.request.patch(BASE + f"/api/admin/users/{me['id']}", headers=H,
                       data={"group_ids": [g["id"] for g in me["groups"]] + [family["id"]]})
    post(page, "/api/admin/users", {"username": "anna", "display_name": "Анна", "email": "anna@citadel.lan",
                                    "password": "anna-demo-password", "group_ids": [family["id"]]})
    post(page, "/api/admin/projects", {
        "name": "MoneyChichhi", "description": "Общий бюджет и траты", "url": "http://192.168.31.93:8080",
        "redirect_uris": [], "group_ids": [family["id"]]})
    post(page, "/api/admin/projects", {
        "name": "Immich", "description": "Фото и видео", "url": "http://192.168.31.93:2283",
        "redirect_uris": ["http://192.168.31.93:2283/auth/login", "app.immich:///oauth-callback"],
        "allow_all_users": True})
    post(page, "/api/admin/projects", {
        "name": "Tracker", "description": "Задачи и привычки", "url": "http://192.168.31.93:8090",
        "group_ids": [family["id"]]})

    page.goto(BASE + "/")
    shot(page, "04-services")
    page.goto(BASE + "/admin/users")
    shot(page, "05-users")
    page.get_by_role("button", name="Анна").click()
    page.wait_for_selector(".drawer")
    shot(page, "06-user-drawer")
    page.keyboard.press("Escape")
    page.goto(BASE + "/admin/groups")
    shot(page, "07-groups")
    page.goto(BASE + "/admin/projects")
    page.get_by_role("button", name="Зарегистрировать проект").click()
    page.get_by_label("Название").fill("Notes")
    page.get_by_label("Описание").fill("Заметки и списки")
    page.get_by_label("Адрес сервиса").fill("http://192.168.31.93:8095")
    page.get_by_label("Адреса возврата (OIDC)").fill("http://192.168.31.93:8095/auth/callback")
    page.locator(".drawer .check", has_text="family").click()
    page.locator(".drawer").get_by_role("button", name="Зарегистрировать проект").click()
    page.wait_for_selector(".reveal")
    shot(page, "08-project-credentials")
    page.get_by_role("button", name="Секрет сохранён, закрыть").click()
    shot(page, "09-projects")
    page.goto(BASE + "/admin/audit")
    shot(page, "10-audit")
    page.goto(BASE + "/account")
    shot(page, "11-account", full=True)

    # night: second device, code from the app
    dark = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme="dark", locale="ru-RU")
    page = dark.new_page()
    page.goto(BASE + "/login")
    page.wait_for_timeout(1800)
    page.get_by_label("Логин").fill(ADMIN[0])
    page.get_by_label("Пароль").fill(ADMIN[2])
    page.get_by_role("button", name="Продолжить").click()
    page.wait_for_selector(".code-cell")
    shot(page, "12-code-dark")
    type_code(page, code_at(secret, 1))
    page.wait_for_url(BASE + "/")
    shot(page, "13-services-dark")
    page.goto(BASE + "/admin/users")
    shot(page, "14-users-dark")

    # phone
    phone = browser.new_context(viewport={"width": 390, "height": 844}, color_scheme="light", locale="ru-RU",
                                device_scale_factor=2, is_mobile=True, has_touch=True)
    page = phone.new_page()
    page.goto(BASE + "/login")
    page.wait_for_timeout(1800)
    shot(page, "15-login-phone")

    browser.close()
