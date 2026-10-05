from datetime import timedelta

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.db import get_db
from app.models import Session, User, utcnow
from app.security import new_token, token_hash

SESSION_COOKIE = "bastion_session"
CHALLENGE_COOKIE = "bastion_challenge"
CSRF_HEADER = "x-bastion"


def client_ip(request: Request) -> str | None:
    if get_settings().trust_forwarded:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else None


def user_agent(request: Request) -> str | None:
    ua = request.headers.get("user-agent")
    return ua[:255] if ua else None


def set_cookie(response: Response, name: str, value: str, max_age: int, path: str = "/") -> None:
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        path=path,
        httponly=True,
        samesite="lax",
        secure=get_settings().cookie_secure,
    )


def start_session(db: DbSession, response: Response, request: Request, user: User) -> Session:
    settings = get_settings()
    token = new_token()
    now = utcnow()
    session = Session(
        id=token_hash(token),
        user_id=user.id,
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(hours=settings.session_ttl_hours),
        ip=client_ip(request),
        user_agent=user_agent(request),
    )
    db.add(session)
    user.last_login_at = now
    set_cookie(response, SESSION_COOKIE, token, settings.session_ttl_hours * 3600)
    return session


def lookup_session(db: DbSession, request: Request) -> Session | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    session = db.get(Session, token_hash(token))
    if session is None:
        return None
    now = utcnow()
    if session.expires_at <= now or not session.user.is_active:
        db.delete(session)
        db.commit()
        return None
    if now - session.last_seen_at > timedelta(minutes=5):
        session.last_seen_at = now
        db.commit()
    return session


def optional_session(request: Request, db: DbSession = Depends(get_db)) -> Session | None:
    return lookup_session(db, request)


def require_session(session: Session | None = Depends(optional_session)) -> Session:
    if session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": "not_signed_in"})
    return session


def require_user(session: Session = Depends(require_session)) -> User:
    return session.user


def require_admin(user: User = Depends(require_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "admins_only"})
    return user


def csrf_guard(request: Request) -> None:
    """Cookie-authenticated mutations must carry a custom header.

    Browsers cannot attach custom headers cross-origin without a CORS preflight,
    which Bastion never approves, so this blocks cross-site request forgery.
    """
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get(CSRF_HEADER) != "1":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "csrf"})
