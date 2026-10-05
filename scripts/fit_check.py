"""Checks that every screen fits the browser window without scrolling.

Usage (fresh instance with no users):
    python scripts/fit_check.py http://127.0.0.1:8801 <setup-token> [en|ru]

Prints, per viewport and screen, the page height vs. window height and any
element whose content is clipped or scrolls inside it.
"""

import sys
import time

import pyotp
from playwright.sync_api import Page, sync_playwright

BASE = sys.argv[1].rstrip("/")
TOKEN = sys.argv[2]
LANG = sys.argv[3] if len(sys.argv) > 3 else "en"
H = {"X-Bastion": "1"}
# Browser window content areas at 100% zoom (screen minus taskbar and browser chrome).
VIEWPORTS = [(1920, 945), (1536, 730), (1440, 760), (1366, 633), (1280, 610), (390, 664)]

problems: list[str] = []


def measure(page: Page, label: str, vw: tuple[int, int]) -> None:
    page.wait_for_timeout(300)
    data = page.evaluate(
        """() => {
        const doc = document.documentElement;
        const inner = [];
        for (const el of document.querySelectorAll('.wall, .drawer, .sheet, .dialog, .table-wrap')) {
          if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== 'visible')
            inner.push(el.className + ' ' + el.scrollHeight + '/' + el.clientHeight);
          if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible')
            inner.push(el.className + ' wide ' + el.scrollWidth + '/' + el.clientWidth);
        }
        return {h: doc.scrollHeight, vh: innerHeight, w: doc.scrollWidth, vw: innerWidth, inner};
      }"""
    )
    bad = data["h"] > data["vh"] or data["w"] > data["vw"] or data["inner"]
    line = f"{vw[0]}x{vw[1]} {label:22} page {data['h']}/{data['vh']} w {data['w']}/{data['vw']} {data['inner'] or ''}"
    print(("!! " if bad else "   ") + line)
    if bad:
        problems.append(line)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="msedge")
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script(f"localStorage.setItem('bastion.lang', '{LANG}')")
    page = ctx.new_page()

    def each(label: str, setup=None) -> None:
        for vw in VIEWPORTS:
            page.set_viewport_size({"width": vw[0], "height": vw[1]})
            if setup:
                setup()
            measure(page, label, vw)

    page.goto(BASE + "/setup")
    page.wait_for_selector("form")
    each("setup")

    r = page.request.post(BASE + "/api/auth/setup", headers=H, data={
        "token": TOKEN, "username": "user1", "display_name": "User 1", "password": "demo-password-123"})
    assert r.ok, r.text()

    page.goto(BASE + "/login")
    page.wait_for_selector("form")
    each("login")
    page.fill("input[name=username]", "user1")
    page.fill("input[name=password]", "wrong-password-1")
    page.click("button[type=submit]")
    page.wait_for_selector(".notice")
    each("login + error")
    page.fill("input[name=password]", "demo-password-123")
    page.click("button[type=submit]")
    page.wait_for_selector(".qr svg")
    secret = page.locator(".secret").inner_text().replace(" ", "")
    each("enroll")
    page.locator(".code-cell").first.click()
    page.keyboard.type(pyotp.TOTP(secret).now())
    page.wait_for_selector(".recovery-list")
    each("recovery codes")
    page.click(".wall-form > button.btn-wide")
    page.wait_for_url(BASE + "/")

    fam = page.request.post(BASE + "/api/admin/groups", headers=H, data={"name": "members", "description": "Everyone at home"}).json()
    for i in range(2, 14):
        page.request.post(BASE + "/api/admin/users", headers=H, data={
            "username": f"user{i}", "display_name": f"User {i}", "password": "demo-password-123", "group_ids": [fam["id"]]})
    for i in range(1, 13):
        page.request.post(BASE + "/api/admin/projects", headers=H, data={
            "name": f"Service {i}", "description": "A long enough description of what this service does",
            "url": f"http://service{i}.home.arpa", "redirect_uris": [f"http://service{i}.home.arpa/cb"], "group_ids": [fam["id"]]})

    for path in ["/", "/account", "/admin/users", "/admin/groups", "/admin/projects", "/admin/audit"]:
        page.goto(BASE + path)
        page.wait_for_selector(".page-title")
        each(path)

    page.goto(BASE + "/admin/users")
    page.locator("tr.clickable").nth(1).click()
    page.wait_for_selector(".drawer")
    each("user drawer")
    page.locator(".drawer [role=tab]").nth(1).click()
    each("user drawer security")
    page.keyboard.press("Escape")
    page.click(".page-head .btn")
    page.wait_for_selector(".drawer")
    each("new user drawer")
    page.keyboard.press("Escape")
    page.goto(BASE + "/admin/projects")
    page.click(".page-head .btn")
    page.wait_for_selector(".drawer")
    each("new project drawer")
    page.keyboard.press("Escape")
    page.locator("tr.clickable").first.click()
    page.wait_for_selector(".drawer")
    each("project drawer")
    for n, name in ((1, "project connect tab"), (2, "project secret tab")):
        page.locator(".drawer [role=tab]").nth(n).click()
        each(name)

    # second login: code step
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx2.add_init_script(f"localStorage.setItem('bastion.lang', '{LANG}')")
    page = ctx2.new_page()
    page.goto(BASE + "/login")
    page.fill("input[name=username]", "user1")
    page.fill("input[name=password]", "demo-password-123")
    page.click("button[type=submit]")
    page.wait_for_selector(".code-cell")
    each("code step")
    page.click(".wall-form .link-button")
    each("recovery step")
    browser.close()

print(f"\n{len(problems)} problem(s)")
