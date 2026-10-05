import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete

from app.api import account, admin, auth, service
from app.config import get_settings
from app.db import get_sessionmaker
from app.migrate import upgrade
from app.models import AccessToken, AuthCode, LoginChallenge, Session, utcnow
from app.security import public_jwk, _fernet
from app import oidc

log = logging.getLogger("bastion")

CSP = (
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
    "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
)


def cleanup_expired() -> None:
    now = utcnow()
    with get_sessionmaker()() as db:
        for model in (Session, LoginChallenge, AuthCode, AccessToken):
            db.execute(delete(model).where(model.expires_at <= now))
        db.commit()


async def _cleanup_loop() -> None:
    while True:
        await asyncio.sleep(3600)
        try:
            await asyncio.to_thread(cleanup_expired)
        except Exception:  # noqa: BLE001 - keep the loop alive, log and retry next hour
            log.exception("cleanup failed")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    upgrade()
    _fernet()
    public_jwk()
    cleanup_expired()
    with get_sessionmaker()() as db:
        auth.ensure_setup_token(db)
    log.info("Bastion is up, issuer %s", settings.issuer)
    task = asyncio.create_task(_cleanup_loop())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Bastion", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("Content-Security-Policy", CSP)
        if request.url.path.startswith(("/api/", "/oidc/")):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "error", "message": str(exc.detail)}
        return JSONResponse({"detail": detail}, status_code=exc.status_code, headers=exc.headers)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    app.include_router(auth.router)
    app.include_router(account.router)
    app.include_router(admin.router)
    app.include_router(service.router)
    app.include_router(oidc.router)

    static: Path | None = settings.static_dir
    if static and (static / "index.html").exists():
        if (static / "assets").is_dir():
            app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")
        index = static / "index.html"

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith(("api/", "oidc/", ".well-known/")):
                raise HTTPException(404, detail={"code": "not_found"})
            candidate = (static / path).resolve()
            if path and candidate.is_file() and candidate.is_relative_to(static.resolve()):
                return FileResponse(candidate)
            return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()
