import base64
import binascii
from urllib.parse import unquote

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.models import Project
from app.security import constant_eq, token_hash


def _basic_credentials(request: Request) -> tuple[str, str] | None:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("basic "):
        return None
    try:
        decoded = base64.b64decode(header[6:].strip(), validate=True).decode()
    except (binascii.Error, UnicodeDecodeError):
        return None
    if ":" not in decoded:
        return None
    client_id, secret = decoded.split(":", 1)
    # RFC 6749 §2.3.1: credentials are form-urlencoded before base64.
    return unquote(client_id), unquote(secret)


def authenticate_client(
    db: DbSession,
    request: Request,
    form_client_id: str | None = None,
    form_client_secret: str | None = None,
) -> Project | None:
    """client_secret_basic or client_secret_post. Returns None when credentials are wrong."""
    creds = _basic_credentials(request)
    if creds is None and form_client_id and form_client_secret:
        creds = (form_client_id, form_client_secret)
    if creds is None:
        return None
    client_id, secret = creds
    project = db.scalar(select(Project).where(Project.client_id == client_id))
    expected = project.client_secret_hash if project else token_hash("unknown-client")
    if not constant_eq(token_hash(secret), expected) or project is None or not project.is_active:
        return None
    return project


def unauthorized_client() -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        detail={"code": "invalid_client"},
        headers={"WWW-Authenticate": 'Basic realm="bastion"'},
    )
