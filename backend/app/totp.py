import re
import secrets
import time

import pyotp
import segno
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.models import RecoveryCode, TotpCredential, User, utcnow
from app.security import decrypt, encrypt, token_hash

STEP = 30
RECOVERY_CODE_COUNT = 10
_RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def new_secret() -> str:
    return pyotp.random_base32()


def provisioning(secret: str, username: str) -> dict:
    issuer = get_settings().totp_issuer
    uri = pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name=issuer)
    qr = segno.make(uri, error="m")
    # Drawn in #000, then switched to currentColor so the QR follows the theme's ink colour.
    svg = qr.svg_inline(scale=6, border=0, dark="#000", light=None, omitsize=True)
    svg = svg.replace('"#000"', '"currentColor"')
    return {"secret": secret, "otpauth_uri": uri, "qr_svg": svg}


def normalize_code(code: str) -> str:
    return re.sub(r"\s+", "", code or "")


def match_step(secret: str, code: str, after_step: int = 0, now: float | None = None) -> int | None:
    """Returns the matched time step (allowing ±1 step of clock drift), or None.

    Steps at or before ``after_step`` are rejected so a code cannot be replayed.
    """
    code = normalize_code(code)
    if not re.fullmatch(r"\d{6}", code):
        return None
    totp = pyotp.TOTP(secret)
    current = int((now if now is not None else time.time()) // STEP)
    for step in (current - 1, current, current + 1):
        if step <= after_step:
            continue
        if secrets.compare_digest(totp.at(step * STEP), code):
            return step
    return None


def verify_user_code(db: DbSession, user: User, code: str) -> bool:
    cred = user.totp
    if cred is None:
        return False
    step = match_step(decrypt(cred.secret_enc), code, cred.last_used_step)
    if step is None:
        return False
    cred.last_used_step = step
    return True


def enroll(db: DbSession, user: User, secret: str, step: int) -> list[str]:
    if user.totp is not None:
        db.delete(user.totp)
        db.flush()
    user.totp = TotpCredential(secret_enc=encrypt(secret), last_used_step=step)
    return regenerate_recovery_codes(db, user)


def _recovery_code() -> str:
    raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(10))
    return f"{raw[:5]}-{raw[5:]}"


def _normalize_recovery(code: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (code or "").lower())


def regenerate_recovery_codes(db: DbSession, user: User) -> list[str]:
    db.query(RecoveryCode).filter(RecoveryCode.user_id == user.id).delete()
    codes = [_recovery_code() for _ in range(RECOVERY_CODE_COUNT)]
    for code in codes:
        db.add(RecoveryCode(user_id=user.id, code_hash=token_hash(_normalize_recovery(code))))
    return codes


def use_recovery_code(db: DbSession, user: User, code: str) -> bool:
    normalized = _normalize_recovery(code)
    if len(normalized) != 10:
        return False
    row = db.scalar(
        select(RecoveryCode).where(
            RecoveryCode.user_id == user.id,
            RecoveryCode.code_hash == token_hash(normalized),
            RecoveryCode.used_at.is_(None),
        )
    )
    if row is None:
        return False
    row.used_at = utcnow()
    return True


def recovery_codes_left(db: DbSession, user: User) -> int:
    return (
        db.query(RecoveryCode)
        .filter(RecoveryCode.user_id == user.id, RecoveryCode.used_at.is_(None))
        .count()
    )


def clear(db: DbSession, user: User) -> None:
    if user.totp is not None:
        db.delete(user.totp)
    db.query(RecoveryCode).filter(RecoveryCode.user_id == user.id).delete()
