import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app import audit, throttle, totp
from app.config import get_settings
from app.db import get_db
from app.deps import (
    CHALLENGE_COOKIE,
    SESSION_COOKIE,
    client_ip,
    csrf_guard,
    optional_session,
    set_cookie,
    start_session,
)
from app.models import ADMINS_GROUP, Group, LoginChallenge, Session, User, utcnow
from app.schemas import CodeIn, LoginIn, SetupIn, UserOut
from app.security import constant_eq, decrypt, encrypt, hash_password, new_token, password_needs_rehash, token_hash, verify_password

log = logging.getLogger("bastion")
router = APIRouter(prefix="/api/auth", tags=["auth"], dependencies=[Depends(csrf_guard)])

CHALLENGE_PATH = "/api/auth"
MAX_CODE_ATTEMPTS = 5


class SetupState:
    token: str | None = None


def ensure_setup_token(db: DbSession) -> None:
    """Prints a one-time setup token while there are no users yet."""
    if db.scalar(select(func.count()).select_from(User)):
        SetupState.token = None
        return
    SetupState.token = new_token(18)
    banner = "=" * 64
    log.warning(
        "\n%s\n  Bastion has no users yet.\n  Open the web UI and use this setup token to create the first admin:\n\n      %s\n%s",
        banner,
        SetupState.token,
        banner,
    )


def safe_return_to(value: str | None) -> str | None:
    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value:
        return None
    return value


def _err(code: str, http: int = status.HTTP_400_BAD_REQUEST, **extra) -> HTTPException:
    return HTTPException(http, detail={"code": code, **extra})


@router.get("/state")
def state(session: Session | None = Depends(optional_session), db: DbSession = Depends(get_db)) -> dict:
    return {
        "setup_required": SetupState.token is not None,
        "user": UserOut.of(session.user).model_dump(mode="json") if session else None,
    }


@router.post("/setup")
def setup(body: SetupIn, request: Request, db: DbSession = Depends(get_db)) -> dict:
    if SetupState.token is None or db.scalar(select(func.count()).select_from(User)):
        raise _err("setup_done", status.HTTP_409_CONFLICT)
    if not constant_eq(body.token.strip(), SetupState.token):
        audit.record(db, "setup_failed", actor_name=body.username, ip=client_ip(request), success=False)
        db.commit()
        raise _err("bad_setup_token", status.HTTP_403_FORBIDDEN)
    admins = db.scalar(select(Group).where(Group.name == ADMINS_GROUP))
    if admins is None:
        admins = Group(name=ADMINS_GROUP, description="Full access to Bastion")
        db.add(admins)
    user = User(
        username=body.username,
        display_name=body.display_name,
        email=body.email,
        password_hash=hash_password(body.password),
        groups=[admins],
    )
    db.add(user)
    audit.record(db, "setup_completed", actor=user, target=user.username, ip=client_ip(request))
    db.commit()
    SetupState.token = None
    return {"ok": True}


def _new_challenge(db: DbSession, response: Response, user: User, return_to: str | None) -> str:
    db.query(LoginChallenge).filter(LoginChallenge.user_id == user.id).delete()
    token = new_token()
    stage = "totp" if user.totp is not None else "enroll"
    db.add(
        LoginChallenge(
            id=token_hash(token),
            user_id=user.id,
            stage=stage,
            return_to=return_to,
            expires_at=utcnow() + timedelta(minutes=get_settings().challenge_ttl_minutes),
        )
    )
    set_cookie(response, CHALLENGE_COOKIE, token, get_settings().challenge_ttl_minutes * 60, path=CHALLENGE_PATH)
    return stage


def _challenge(db: DbSession, request: Request, stage: str) -> LoginChallenge:
    token = request.cookies.get(CHALLENGE_COOKIE)
    challenge = db.get(LoginChallenge, token_hash(token)) if token else None
    if challenge is None or challenge.expires_at <= utcnow() or not challenge.user.is_active:
        raise _err("challenge_expired", status.HTTP_401_UNAUTHORIZED)
    if challenge.stage != stage:
        raise _err("wrong_step", status.HTTP_409_CONFLICT, step=challenge.stage)
    return challenge


def _finish(db: DbSession, request: Request, response: Response, challenge: LoginChallenge) -> str:
    user = challenge.user
    return_to = challenge.return_to or "/"
    db.delete(challenge)
    start_session(db, response, request, user)
    response.delete_cookie(CHALLENGE_COOKIE, path=CHALLENGE_PATH)
    throttle.reset(db, user.username)
    audit.record(db, "login", actor=user, ip=client_ip(request))
    return return_to


def _code_failed(db: DbSession, request: Request, challenge: LoginChallenge, event: str) -> HTTPException:
    challenge.attempts += 1
    user = challenge.user
    throttle.fail(db, throttle.keys_for(user.username, client_ip(request)))
    audit.record(db, event, actor=user, ip=client_ip(request), success=False)
    if challenge.attempts >= MAX_CODE_ATTEMPTS:
        db.delete(challenge)
        db.commit()
        return _err("challenge_expired", status.HTTP_401_UNAUTHORIZED)
    db.commit()
    return _err("bad_code", attempts_left=MAX_CODE_ATTEMPTS - challenge.attempts)


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: DbSession = Depends(get_db)) -> dict:
    username = body.username.strip().lower()
    ip = client_ip(request)
    keys = throttle.keys_for(username, ip)
    throttle.check(db, keys)

    user = db.scalar(select(User).where(User.username == username))
    ok = verify_password(user.password_hash if user else None, body.password)
    if not ok or user is None or not user.is_active:
        throttle.fail(db, keys)
        audit.record(db, "login_failed", actor_name=username, ip=ip, success=False,
                     details={"reason": "inactive" if ok and user else "bad_credentials"})
        db.commit()
        raise _err("bad_credentials", status.HTTP_401_UNAUTHORIZED)

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    step = _new_challenge(db, response, user, safe_return_to(body.return_to))
    db.commit()
    return {"step": step, "display_name": user.display_name}


@router.post("/totp")
def verify_totp(body: CodeIn, request: Request, response: Response, db: DbSession = Depends(get_db)) -> dict:
    challenge = _challenge(db, request, "totp")
    throttle.check(db, throttle.keys_for(challenge.user.username, client_ip(request)))
    user = challenge.user
    if body.recovery_code:
        if not totp.use_recovery_code(db, user, body.recovery_code):
            raise _code_failed(db, request, challenge, "recovery_code_failed")
        audit.record(db, "recovery_code_used", actor=user, ip=client_ip(request),
                     details={"left": totp.recovery_codes_left(db, user)})
    elif not totp.verify_user_code(db, user, body.code or ""):
        raise _code_failed(db, request, challenge, "totp_failed")
    return_to = _finish(db, request, response, challenge)
    db.commit()
    return {"ok": True, "return_to": return_to}


@router.get("/enroll")
def enroll_start(request: Request, db: DbSession = Depends(get_db)) -> dict:
    challenge = _challenge(db, request, "enroll")
    if challenge.pending_secret_enc:
        secret = decrypt(challenge.pending_secret_enc)
    else:
        secret = totp.new_secret()
        challenge.pending_secret_enc = encrypt(secret)
        db.commit()
    return totp.provisioning(secret, challenge.user.username)


@router.post("/enroll")
def enroll_finish(body: CodeIn, request: Request, response: Response, db: DbSession = Depends(get_db)) -> dict:
    challenge = _challenge(db, request, "enroll")
    if not challenge.pending_secret_enc:
        raise _err("wrong_step", status.HTTP_409_CONFLICT, step="enroll")
    secret = decrypt(challenge.pending_secret_enc)
    step = totp.match_step(secret, body.code or "")
    if step is None:
        raise _code_failed(db, request, challenge, "totp_enroll_failed")
    user = challenge.user
    codes = totp.enroll(db, user, secret, step)
    audit.record(db, "totp_enrolled", actor=user, ip=client_ip(request))
    return_to = _finish(db, request, response, challenge)
    db.commit()
    return {"ok": True, "return_to": return_to, "recovery_codes": codes}


@router.post("/logout")
def logout(request: Request, response: Response, session: Session | None = Depends(optional_session),
           db: DbSession = Depends(get_db)) -> dict:
    if session is not None:
        audit.record(db, "logout", actor=session.user, ip=client_ip(request))
        db.delete(session)
        db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}
