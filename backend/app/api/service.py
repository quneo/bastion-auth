"""Backend-to-backend API for projects that keep their own sign-in form.

Projects authenticate with their client_id / client_secret (HTTP Basic).
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app import audit, throttle, totp
from app.clients import authenticate_client, unauthorized_client
from app.db import get_db
from app.deps import client_ip
from app.models import Project, User, utcnow
from app.schemas import ServiceAuthIn, ServiceUser
from app.security import hash_password, password_needs_rehash, verify_password

router = APIRouter(prefix="/api/v1", tags=["service"])


def require_project(request: Request, db: DbSession = Depends(get_db)) -> Project:
    project = authenticate_client(db, request)
    if project is None:
        raise unauthorized_client()
    return project


def _deny(code: str, http: int = status.HTTP_401_UNAUTHORIZED) -> HTTPException:
    return HTTPException(http, detail={"code": code})


@router.post("/authenticate")
def authenticate(body: ServiceAuthIn, request: Request, project: Project = Depends(require_project),
                 db: DbSession = Depends(get_db)) -> dict:
    """Checks username + password + TOTP code in one call.

    Projects should pass the end user's IP in X-Bastion-End-User-IP so throttling
    and the audit log see the real client; otherwise the project's own IP is used.
    """
    username = body.username.strip().lower()
    ip = request.headers.get("x-bastion-end-user-ip", "")[:64] or client_ip(request)
    keys = throttle.keys_for(username, ip)
    throttle.check(db, keys)

    def fail(code: str, reason: str) -> HTTPException:
        throttle.fail(db, keys)
        audit.record(db, "api_login_failed", actor_name=username, project_name=project.name, ip=ip,
                     success=False, details={"reason": reason})
        db.commit()
        return _deny(code)

    user = db.scalar(select(User).where(User.username == username))
    if not verify_password(user.password_hash if user else None, body.password) or user is None or not user.is_active:
        raise fail("invalid_credentials", "bad_credentials")
    if not project.allows(user):
        audit.record(db, "api_login_failed", actor=user, project_name=project.name, ip=ip, success=False,
                     details={"reason": "access_denied"})
        db.commit()
        raise _deny("access_denied", status.HTTP_403_FORBIDDEN)
    if user.totp is None:
        # Password was right; do not count as a brute-force failure.
        audit.record(db, "api_login_failed", actor=user, project_name=project.name, ip=ip, success=False,
                     details={"reason": "totp_not_enrolled"})
        db.commit()
        raise _deny("totp_not_enrolled", status.HTTP_403_FORBIDDEN)
    if not body.totp_code:
        raise _deny("totp_required")
    if not totp.verify_user_code(db, user, body.totp_code):
        raise fail("invalid_totp", "bad_totp")

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    user.last_login_at = utcnow()
    throttle.reset(db, username)
    audit.record(db, "api_login", actor=user, project_name=project.name, ip=ip)
    db.commit()
    return {"user": ServiceUser.of(user).model_dump()}


@router.get("/users")
def users(project: Project = Depends(require_project), db: DbSession = Depends(get_db)) -> list[ServiceUser]:
    """Users who are allowed into this project."""
    return [ServiceUser.of(u) for u in db.scalars(select(User).order_by(User.username)).all() if project.allows(u)]


@router.get("/users/{user_id}")
def user(user_id: str, project: Project = Depends(require_project), db: DbSession = Depends(get_db)) -> ServiceUser:
    found = db.get(User, user_id)
    if found is None or not project.allows(found):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"})
    return ServiceUser.of(found)
