"""Walks through Bastion like a person would and saves README screenshots.

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
from playwright.sync_api import Browser, Page, sync_playwright

BASE = sys.argv[1].rstrip("/")
TOKEN = sys.argv[2]
OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
H = {"X-Bastion": "1"}
PASSWORD = "demo-password-123"
DESKTOP = {"width": 1440, "height": 900}


def shot(page: Page, name: str) -> None:
    page.wait_for_timeout(450)
    png = OUT / f"{name}.png"
    page.screenshot(path=str(png))
    Image.open(png).save(OUT / f"{name}.webp", "WEBP", quality=84, method=6)
    png.unlink()
    print("saved", name)


def context(browser: Browser, scheme: str, **extra):
    ctx = browser.new_context(color_scheme=scheme, **{"viewport": DESKTOP, **extra})
    ctx.add_init_script("localStorage.setItem('bastion.lang', 'en')")
    return ctx


def sign_in(page: Page, username: str) -> None:
    page.goto(BASE + "/login")
    page.wait_for_timeout(1800)
    page.fill("input[name=username]", username)
    page.fill("input[name=password]", PASSWORD)
    page.click("button[type=submit]")


def type_code(page: Page, code: str) -> None:
    page.locator(".code-cell").first.click()
    page.keyboard.type(code, delay=40)


def post(page: Page, path: str, data: dict) -> dict:
    r = page.request.post(BASE + path, headers=H, data=data)
    assert r.ok, (path, r.status, r.text())
    return r.json()


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="msedge")
    page = context(browser, "light").new_page()

    page.goto(BASE + "/setup")
    page.wait_for_selector("form")
    shot(page, "00-setup")
    post(page, "/api/auth/setup", {"token": TOKEN, "username": "user1", "display_name": "User 1", "password": PASSWORD})

    page.goto(BASE + "/login")
    page.wait_for_timeout(1800)
    page.fill("input[name=username]", "user1")
    page.fill("input[name=password]", PASSWORD)
    shot(page, "01-login")
    page.click("button[type=submit]")
    page.wait_for_selector(".qr svg")
    secret = page.locator(".secret").inner_text().replace(" ", "")
    shot(page, "02-enroll")
    type_code(page, pyotp.TOTP(secret).now())
    page.wait_for_selector(".recovery-list")
    shot(page, "03-recovery-codes")
    page.click(".wall-form > button.btn-wide")
    page.wait_for_url(BASE + "/")

    members = post(page, "/api/admin/groups", {"name": "members", "description": "Everyone at home"})
    post(page, "/api/admin/groups", {"name": "guests", "description": "Friends: photo albums only"})
    me = page.request.get(BASE + "/api/me").json()
    page.request.patch(BASE + f"/api/admin/users/{me['id']}", headers=H,
                       data={"group_ids": [g["id"] for g in me["groups"]] + [members["id"]]})
    for i in (2, 3):
        post(page, "/api/admin/users", {"username": f"user{i}", "display_name": f"User {i}",
                                        "email": f"user{i}@example.home", "password": PASSWORD,
                                        "group_ids": [members["id"]]})
    services = [("Service 1", "Shared budget"), ("Service 2", "Photos and videos"), ("Service 3", "Habits and tasks")]
    for i, (name, desc) in enumerate(services, start=1):
        post(page, "/api/admin/projects", {
            "name": name, "description": desc, "url": f"http://service{i}.home.arpa",
            "redirect_uris": [f"http://service{i}.home.arpa/auth/callback"],
            "allow_all_users": i == 2, "group_ids": [] if i == 2 else [members["id"]]})

    page.goto(BASE + "/")
    shot(page, "04-services")
    page.goto(BASE + "/admin/users")
    shot(page, "05-users")
    page.locator("tr.clickable").nth(1).click()
    page.wait_for_selector(".drawer")
    shot(page, "06-user-drawer")
    page.keyboard.press("Escape")
    page.goto(BASE + "/admin/groups")
    shot(page, "07-groups")
    page.goto(BASE + "/admin/projects")
    page.click(".page-head .btn")
    page.wait_for_selector(".drawer")
    page.locator(".drawer input").nth(0).fill("Service 4")
    page.locator(".drawer input").nth(1).fill("Notes and lists")
    page.locator(".drawer input").nth(2).fill("http://service4.home.arpa")
    page.locator(".drawer textarea").fill("http://service4.home.arpa/auth/callback")
    page.locator(".drawer .check", has_text="members").click()
    page.click(".drawer button[type=submit]")
    page.wait_for_selector(".reveal")
    shot(page, "08-project-credentials")
    page.keyboard.press("Escape")
    shot(page, "09-projects")
    page.goto(BASE + "/admin/audit")
    shot(page, "10-audit")
    page.goto(BASE + "/account")
    shot(page, "11-account")

    # night: a second device asks for the code
    page = context(browser, "dark").new_page()
    sign_in(page, "user1")
    page.wait_for_selector(".code-cell")
    shot(page, "12-code-dark")
    type_code(page, pyotp.TOTP(secret).at(time.time() + 30))
    page.wait_for_url(BASE + "/")
    shot(page, "13-services-dark")
    page.goto(BASE + "/admin/users")
    shot(page, "14-users-dark")

    phone = context(browser, "light", viewport={"width": 390, "height": 844}, device_scale_factor=2,
                    is_mobile=True, has_touch=True)
    page = phone.new_page()
    page.goto(BASE + "/login")
    page.wait_for_timeout(1800)
    shot(page, "15-login-phone")

    browser.close()
