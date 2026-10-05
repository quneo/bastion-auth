from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app import audit, throttle, totp
from app.db import get_db
from app.deps import client_ip, csrf_guard, require_session
from app.models import Project, Session, utcnow
from app.schemas import PasswordChange, PasswordConfirm, ProfileUpdate, ServiceOut, UserOut
from app.security import hash_password, verify_password

router = APIRouter(prefix="/api/me", tags=["account"], dependencies=[Depends(csrf_guard)])


def _check_password(db: DbSession, request: Request, session: Session, password: str) -> None:
    keys = throttle.keys_for(session.user.username, client_ip(request))
    throttle.check(db, keys)
    if not verify_password(session.user.password_hash, password):
        throttle.fail(db, keys)
        audit.record(db, "password_check_failed", actor=session.user, ip=client_ip(request), success=False)
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"code": "bad_password"})


@router.get("")
def me(session: Session = Depends(require_session), db: DbSession = Depends(get_db)) -> dict:
    user = session.user
    return {
        **UserOut.of(user).model_dump(mode="json"),
        "recovery_codes_left": totp.recovery_codes_left(db, user),
        "password_changed_at": user.password_changed_at.isoformat(),
    }


@router.patch("")
def update_profile(body: ProfileUpdate, request: Request, session: Session = Depends(require_session),
                   db: DbSession = Depends(get_db)) -> UserOut:
    user = session.user
    if body.display_name is not None:
        user.display_name = body.display_name
    if "email" in body.model_fields_set:
        user.email = body.email
    audit.record(db, "profile_updated", actor=user, ip=client_ip(request))
    db.commit()
    return UserOut.of(user)


@router.get("/services")
def services(session: Session = Depends(require_session), db: DbSession = Depends(get_db)) -> list[ServiceOut]:
    projects = db.scalars(select(Project).where(Project.is_active.is_(True)).order_by(Project.name)).all()
    return [
        ServiceOut(id=p.id, name=p.name, description=p.description, url=p.url)
        for p in projects
        if p.allows(session.user)
    ]


@router.post("/password")
def change_password(body: PasswordChange, request: Request, session: Session = Depends(require_session),
                    db: DbSession = Depends(get_db)) -> dict:
    _check_password(db, request, session, body.current_password)
    user = session.user
    user.password_hash = hash_password(body.new_password)
    user.password_changed_at = utcnow()
    # Sign out everywhere else.
    db.query(Session).filter(Session.user_id == user.id, Session.id != session.id).delete()
    audit.record(db, "password_changed", actor=user, ip=client_ip(request))
    db.commit()
    return {"ok": True}


@router.post("/recovery-codes")
def new_recovery_codes(body: PasswordConfirm, request: Request, session: Session = Depends(require_session),
                       db: DbSession = Depends(get_db)) -> dict:
    _check_password(db, request, session, body.password)
    codes = totp.regenerate_recovery_codes(db, session.user)
    audit.record(db, "recovery_codes_regenerated", actor=session.user, ip=client_ip(request))
    db.commit()
    return {"recovery_codes": codes}


@router.get("/sessions")
def sessions(session: Session = Depends(require_session), db: DbSession = Depends(get_db)) -> list[dict]:
    rows = db.scalars(
        select(Session)
        .where(Session.user_id == session.user_id, Session.expires_at > utcnow())
        .order_by(Session.last_seen_at.desc())
    ).all()
    return [
        {
            "id": s.public_id,
            "current": s.id == session.id,
            "created_at": s.created_at.isoformat(),
            "last_seen_at": s.last_seen_at.isoformat(),
            "ip": s.ip,
            "user_agent": s.user_agent,
        }
        for s in rows
    ]


@router.delete("/sessions/{public_id}")
def end_session(public_id: str, request: Request, session: Session = Depends(require_session),
                db: DbSession = Depends(get_db)) -> dict:
    target = db.scalar(select(Session).where(Session.public_id == public_id, Session.user_id == session.user_id))
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"})
    db.delete(target)
    audit.record(db, "session_ended", actor=session.user, ip=client_ip(request))
    db.commit()
    return {"ok": True}
