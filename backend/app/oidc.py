"""OpenID Connect provider: authorization code flow with optional PKCE (S256)."""

import base64
import hashlib
from datetime import timedelta
from urllib.parse import urlencode, urlsplit, urlunsplit

import jwt
from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app import audit
from app.clients import authenticate_client
from app.config import get_settings
from app.db import get_db
from app.deps import SESSION_COOKIE, client_ip, lookup_session
from app.models import AccessToken, AuthCode, Project, User, utcnow
from app.security import constant_eq, new_token, public_jwk, signing_key, token_hash

router = APIRouter(tags=["oidc"])

SCOPES = ["openid", "profile", "email", "groups"]
NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


def _with_query(url: str, params: dict) -> str:
    parts = urlsplit(url)
    extra = urlencode({k: v for k, v in params.items() if v is not None})
    query = f"{parts.query}&{extra}" if parts.query else extra
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def _error_page(code: str) -> RedirectResponse:
    # Never redirect to an unverified redirect_uri; show Bastion's own error screen.
    return RedirectResponse(f"/error?code={code}", status_code=302)


def _redirect_error(redirect_uri: str, error: str, state: str | None, description: str | None = None) -> RedirectResponse:
    return RedirectResponse(
        _with_query(redirect_uri, {"error": error, "error_description": description, "state": state,
                                   "iss": get_settings().issuer}),
        status_code=302,
    )


def _oauth_error(error: str, description: str | None = None, status_code: int = 400) -> JSONResponse:
    body = {"error": error}
    if description:
        body["error_description"] = description
    return JSONResponse(body, status_code=status_code, headers=NO_STORE)


def _claims(user: User, scope: set[str]) -> dict:
    claims: dict = {"sub": user.id}
    if "profile" in scope:
        claims["name"] = user.display_name
        claims["preferred_username"] = user.username
    if "email" in scope and user.email:
        claims["email"] = user.email
        claims["email_verified"] = True
    if "groups" in scope:
        claims["groups"] = user.group_names
    return claims


@router.get("/.well-known/openid-configuration")
def discovery() -> dict:
    issuer = get_settings().issuer
    return {
        "issuer": issuer,
        "authorization_endpoint": f"{issuer}/oidc/authorize",
        "token_endpoint": f"{issuer}/oidc/token",
        "userinfo_endpoint": f"{issuer}/oidc/userinfo",
        "jwks_uri": f"{issuer}/oidc/jwks",
        "end_session_endpoint": f"{issuer}/oidc/logout",
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "scopes_supported": SCOPES,
        "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
        "code_challenge_methods_supported": ["S256"],
        "claims_supported": ["sub", "iss", "aud", "exp", "iat", "auth_time", "nonce", "name",
                             "preferred_username", "email", "email_verified", "groups"],
        "authorization_response_iss_parameter_supported": True,
    }


@router.get("/oidc/jwks")
def jwks() -> dict:
    return {"keys": [public_jwk()]}


@router.get("/oidc/authorize")
def authorize(request: Request, db: DbSession = Depends(get_db)):
    p = request.query_params
    project = db.scalar(select(Project).where(Project.client_id == p.get("client_id", "")))
    if project is None or not project.is_active:
        return _error_page("unknown_client")

    redirect_uri = p.get("redirect_uri")
    registered = project.redirect_uris or []
    if redirect_uri is None and len(registered) == 1:
        redirect_uri = registered[0]
    if redirect_uri not in registered:
        return _error_page("bad_redirect_uri")

    state = p.get("state")
    if p.get("response_type") != "code":
        return _redirect_error(redirect_uri, "unsupported_response_type", state)
    scope = set(p.get("scope", "").split())
    if "openid" not in scope:
        return _redirect_error(redirect_uri, "invalid_scope", state, "scope must include openid")
    challenge = p.get("code_challenge")
    if challenge and p.get("code_challenge_method", "plain") != "S256":
        return _redirect_error(redirect_uri, "invalid_request", state, "only S256 PKCE is supported")

    session = lookup_session(db, request)
    if session is None:
        if "none" in p.get("prompt", "").split():
            return _redirect_error(redirect_uri, "login_required", state)
        return_to = request.url.path + "?" + request.url.query
        return RedirectResponse("/login?" + urlencode({"return_to": return_to}), status_code=302)

    user = session.user
    if not project.allows(user):
        audit.record(db, "oidc_denied", actor=user, project_name=project.name, ip=client_ip(request), success=False)
        db.commit()
        return _redirect_error(redirect_uri, "access_denied", state, "no access to this project")

    code = new_token()
    now = utcnow()
    db.add(
        AuthCode(
            id=token_hash(code),
            project_id=project.id,
            user_id=user.id,
            redirect_uri=redirect_uri,
            scope=" ".join(sorted(scope & set(SCOPES))),
            nonce=p.get("nonce"),
            code_challenge=challenge,
            auth_time=session.created_at,
            expires_at=now + timedelta(seconds=get_settings().auth_code_ttl_seconds),
        )
    )
    audit.record(db, "oidc_authorize", actor=user, project_name=project.name, ip=client_ip(request))
    db.commit()
    return RedirectResponse(
        _with_query(redirect_uri, {"code": code, "state": state, "iss": get_settings().issuer}), status_code=302
    )


@router.post("/oidc/token")
def token(
    request: Request,
    grant_type: str = Form(""),
    code: str = Form(""),
    redirect_uri: str | None = Form(None),
    code_verifier: str | None = Form(None),
    client_id: str | None = Form(None),
    client_secret: str | None = Form(None),
    db: DbSession = Depends(get_db),
):
    project = authenticate_client(db, request, client_id, client_secret)
    if project is None:
        return _oauth_error("invalid_client", status_code=401)
    if grant_type != "authorization_code":
        return _oauth_error("unsupported_grant_type")

    row = db.get(AuthCode, token_hash(code)) if code else None
    now = utcnow()
    if row is None or row.used or row.expires_at <= now or row.project_id != project.id:
        return _oauth_error("invalid_grant", "code is invalid or expired")
    row.used = True
    db.commit()

    if redirect_uri is not None and redirect_uri != row.redirect_uri:
        return _oauth_error("invalid_grant", "redirect_uri mismatch")
    if row.code_challenge:
        if not code_verifier:
            return _oauth_error("invalid_grant", "code_verifier required")
        digest = base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode()).digest()).rstrip(b"=").decode()
        if not constant_eq(digest, row.code_challenge):
            return _oauth_error("invalid_grant", "PKCE verification failed")

    user = db.get(User, row.user_id)
    if user is None or not project.allows(user):
        return _oauth_error("invalid_grant", "user is no longer allowed")

    settings = get_settings()
    access = new_token()
    db.add(
        AccessToken(
            id=token_hash(access),
            project_id=project.id,
            user_id=user.id,
            scope=row.scope,
            expires_at=now + timedelta(seconds=settings.access_token_ttl_seconds),
        )
    )
    scope = set(row.scope.split())
    claims = {
        **_claims(user, scope),
        "iss": settings.issuer,
        "aud": project.client_id,
        "iat": int(now.timestamp()),
        "exp": int(now.timestamp()) + settings.id_token_ttl_seconds,
        "auth_time": int(row.auth_time.timestamp()),
    }
    if row.nonce:
        claims["nonce"] = row.nonce
    jwk = public_jwk()
    id_token = jwt.encode(claims, signing_key(), algorithm="RS256", headers={"kid": jwk["kid"]})
    audit.record(db, "oidc_token", actor=user, project_name=project.name, ip=client_ip(request))
    db.commit()
    return JSONResponse(
        {
            "access_token": access,
            "token_type": "Bearer",
            "expires_in": settings.access_token_ttl_seconds,
            "id_token": id_token,
            "scope": row.scope,
        },
        headers=NO_STORE,
    )


@router.api_route("/oidc/userinfo", methods=["GET", "POST"])
def userinfo(request: Request, db: DbSession = Depends(get_db)):
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return JSONResponse({"error": "invalid_token"}, status_code=401,
                            headers={"WWW-Authenticate": 'Bearer error="invalid_token"'})
    row = db.get(AccessToken, token_hash(header[7:].strip()))
    if row is None or row.expires_at <= utcnow() or not row.user.is_active:
        return JSONResponse({"error": "invalid_token"}, status_code=401,
                            headers={"WWW-Authenticate": 'Bearer error="invalid_token"'})
    return JSONResponse(_claims(row.user, set(row.scope.split())), headers=NO_STORE)


def _origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


@router.get("/oidc/logout")
def logout(request: Request, db: DbSession = Depends(get_db)):
    p = request.query_params
    session = lookup_session(db, request)
    if session is not None:
        audit.record(db, "logout", actor=session.user, ip=client_ip(request), details={"via": "oidc"})
        db.delete(session)
        db.commit()

    target = "/login?signed_out=1"
    post_logout = p.get("post_logout_redirect_uri")
    client_id = p.get("client_id")
    if not client_id and p.get("id_token_hint"):
        try:
            hint = jwt.decode(p["id_token_hint"], signing_key().public_key(), algorithms=["RS256"],
                              options={"verify_aud": False, "verify_exp": False})
            client_id = hint.get("aud")
        except jwt.PyJWTError:
            client_id = None
    if post_logout and client_id:
        project = db.scalar(select(Project).where(Project.client_id == client_id))
        allowed = {_origin(u) for u in (project.redirect_uris if project else [])}
        if project is not None and (post_logout in project.redirect_uris or _origin(post_logout) in allowed):
            target = _with_query(post_logout, {"state": p.get("state")})

    response = RedirectResponse(target, status_code=302)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response
