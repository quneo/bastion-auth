import secrets

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app import audit, totp
from app.db import get_db
from app.deps import client_ip, csrf_guard, require_admin
from app.models import ADMINS_GROUP, AuditEvent, Group, LoginChallenge, Project, Session, User, user_groups, utcnow
from app.schemas import (
    GroupCreate,
    GroupOut,
    GroupUpdate,
    PasswordSet,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
    ProjectWithSecret,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.security import hash_password, new_token, token_hash

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(csrf_guard)])


def _err(code: str, http: int = status.HTTP_400_BAD_REQUEST, **extra) -> HTTPException:
    return HTTPException(http, detail={"code": code, **extra})


def _user(db: DbSession, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise _err("not_found", status.HTTP_404_NOT_FOUND)
    return user


def _groups(db: DbSession, ids: list[int]) -> list[Group]:
    if not ids:
        return []
    groups = db.scalars(select(Group).where(Group.id.in_(set(ids)))).all()
    if len(groups) != len(set(ids)):
        raise _err("unknown_group")
    return list(groups)


def _active_admin_count(db: DbSession) -> int:
    return db.scalar(
        select(func.count(User.id))
        .join(user_groups, user_groups.c.user_id == User.id)
        .join(Group, Group.id == user_groups.c.group_id)
        .where(Group.name == ADMINS_GROUP, User.is_active.is_(True))
    ) or 0


def _revoke_sessions(db: DbSession, user: User) -> None:
    db.query(Session).filter(Session.user_id == user.id).delete()
    db.query(LoginChallenge).filter(LoginChallenge.user_id == user.id).delete()


# ---------- overview ----------


@router.get("/overview")
def overview(_admin: User = Depends(require_admin), db: DbSession = Depends(get_db)) -> dict:
    return {
        "users": db.scalar(select(func.count()).select_from(User)),
        "users_without_totp": db.scalar(
            select(func.count()).select_from(User).where(~User.totp.has())
        ),
        "groups": db.scalar(select(func.count()).select_from(Group)),
        "projects": db.scalar(select(func.count()).select_from(Project)),
        "active_sessions": db.scalar(select(func.count()).select_from(Session).where(Session.expires_at > utcnow())),
    }


# ---------- users ----------


@router.get("/users")
def list_users(_admin: User = Depends(require_admin), db: DbSession = Depends(get_db)) -> list[UserOut]:
    return [UserOut.of(u) for u in db.scalars(select(User).order_by(User.username)).all()]


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, request: Request, admin: User = Depends(require_admin),
                db: DbSession = Depends(get_db)) -> UserOut:
    if db.scalar(select(User).where(User.username == body.username)):
        raise _err("username_taken", status.HTTP_409_CONFLICT)
    user = User(
        username=body.username,
        display_name=body.display_name,
        email=body.email,
        password_hash=hash_password(body.password),
        groups=_groups(db, body.group_ids),
    )
    db.add(user)
    audit.record(db, "user_created", actor=admin, target=user.username, ip=client_ip(request))
    db.commit()
    return UserOut.of(user)


@router.get("/users/{user_id}")
def get_user(user_id: str, _admin: User = Depends(require_admin), db: DbSession = Depends(get_db)) -> dict:
    user = _user(db, user_id)
    sessions = db.scalars(
        select(Session).where(Session.user_id == user.id, Session.expires_at > utcnow())
        .order_by(Session.last_seen_at.desc())
    ).all()
    return {
        **UserOut.of(user).model_dump(mode="json"),
        "recovery_codes_left": totp.recovery_codes_left(db, user),
        "sessions": [
            {"id": s.public_id, "ip": s.ip, "user_agent": s.user_agent,
             "created_at": s.created_at.isoformat(), "last_seen_at": s.last_seen_at.isoformat()}
            for s in sessions
        ],
    }


@router.patch("/users/{user_id}")
def update_user(user_id: str, body: UserUpdate, request: Request, admin: User = Depends(require_admin),
                db: DbSession = Depends(get_db)) -> UserOut:
    user = _user(db, user_id)
    was_admin = user.is_admin and user.is_active
    if body.display_name is not None:
        user.display_name = body.display_name
    if "email" in body.model_fields_set:
        user.email = body.email
    if body.is_active is not None:
        if user.id == admin.id and not body.is_active:
            raise _err("cannot_disable_self")
        user.is_active = body.is_active
        if not body.is_active:
            _revoke_sessions(db, user)
    if body.group_ids is not None:
        user.groups = _groups(db, body.group_ids)
        if user.id == admin.id and not user.is_admin:
            raise _err("cannot_leave_admins")
    db.flush()
    if was_admin and not (user.is_admin and user.is_active) and _active_admin_count(db) == 0:
        raise _err("last_admin")
    audit.record(db, "user_updated", actor=admin, target=user.username, ip=client_ip(request),
                 details={"fields": sorted(body.model_fields_set)})
    db.commit()
    return UserOut.of(user)


@router.post("/users/{user_id}/password")
def set_password(user_id: str, body: PasswordSet, request: Request, admin: User = Depends(require_admin),
                 db: DbSession = Depends(get_db)) -> dict:
    user = _user(db, user_id)
    user.password_hash = hash_password(body.password)
    user.password_changed_at = utcnow()
    if user.id != admin.id:
        _revoke_sessions(db, user)
    audit.record(db, "password_set", actor=admin, target=user.username, ip=client_ip(request))
    db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/reset-totp")
def reset_totp(user_id: str, request: Request, admin: User = Depends(require_admin),
               db: DbSession = Depends(get_db)) -> dict:
    user = _user(db, user_id)
    totp.clear(db, user)
    _revoke_sessions(db, user)
    audit.record(db, "totp_reset", actor=admin, target=user.username, ip=client_ip(request))
    db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/sign-out")
def sign_out_user(user_id: str, request: Request, admin: User = Depends(require_admin),
                  db: DbSession = Depends(get_db)) -> dict:
    user = _user(db, user_id)
    _revoke_sessions(db, user)
    audit.record(db, "sessions_revoked", actor=admin, target=user.username, ip=client_ip(request))
    db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}")
def delete_user(user_id: str, request: Request, admin: User = Depends(require_admin),
                db: DbSession = Depends(get_db)) -> dict:
    user = _user(db, user_id)
    if user.id == admin.id:
        raise _err("cannot_delete_self")
    username = user.username
    db.delete(user)
    audit.record(db, "user_deleted", actor=admin, target=username, ip=client_ip(request))
    db.commit()
    return {"ok": True}


# ---------- groups ----------


def _group(db: DbSession, group_id: int) -> Group:
    group = db.get(Group, group_id)
    if group is None:
        raise _err("not_found", status.HTTP_404_NOT_FOUND)
    return group


@router.get("/groups")
def list_groups(_admin: User = Depends(require_admin), db: DbSession = Depends(get_db)) -> list[GroupOut]:
    return [GroupOut.of(g) for g in db.scalars(select(Group).order_by(Group.name)).all()]


@router.post("/groups", status_code=status.HTTP_201_CREATED)
def create_group(body: GroupCreate, request: Request, admin: User = Depends(require_admin),
                 db: DbSession = Depends(get_db)) -> GroupOut:
    if db.scalar(select(Group).where(Group.name == body.name)):
        raise _err("group_exists", status.HTTP_409_CONFLICT)
    group = Group(name=body.name, description=body.description)
    db.add(group)
    audit.record(db, "group_created", actor=admin, target=group.name, ip=client_ip(request))
    db.commit()
    return GroupOut.of(group)


@router.patch("/groups/{group_id}")
def update_group(group_id: int, body: GroupUpdate, request: Request, admin: User = Depends(require_admin),
                 db: DbSession = Depends(get_db)) -> GroupOut:
    group = _group(db, group_id)
    group.description = body.description
    audit.record(db, "group_updated", actor=admin, target=group.name, ip=client_ip(request))
    db.commit()
    return GroupOut.of(group)


@router.delete("/groups/{group_id}")
def delete_group(group_id: int, request: Request, admin: User = Depends(require_admin),
                 db: DbSession = Depends(get_db)) -> dict:
    group = _group(db, group_id)
    if group.is_system:
        raise _err("system_group")
    name = group.name
    db.delete(group)
    audit.record(db, "group_deleted", actor=admin, target=name, ip=client_ip(request))
    db.commit()
    return {"ok": True}


# ---------- projects ----------


def _project(db: DbSession, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise _err("not_found", status.HTTP_404_NOT_FOUND)
    return project


def _new_secret(project: Project) -> str:
    secret = new_token(32)
    project.client_secret_hash = token_hash(secret)
    project.secret_rotated_at = utcnow()
    return secret


@router.get("/projects")
def list_projects(_admin: User = Depends(require_admin), db: DbSession = Depends(get_db)) -> list[ProjectOut]:
    return [ProjectOut.of(p) for p in db.scalars(select(Project).order_by(Project.name)).all()]


@router.post("/projects", status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectCreate, request: Request, admin: User = Depends(require_admin),
                   db: DbSession = Depends(get_db)) -> ProjectWithSecret:
    project = Project(
        name=body.name,
        description=body.description,
        url=body.url,
        client_id=f"bastion-{secrets.token_hex(6)}",
        redirect_uris=body.redirect_uris,
        allow_all_users=body.allow_all_users,
        allowed_groups=_groups(db, body.group_ids),
    )
    secret = _new_secret(project)
    db.add(project)
    audit.record(db, "project_created", actor=admin, target=project.name, ip=client_ip(request))
    db.commit()
    return ProjectWithSecret(project=ProjectOut.of(project), client_secret=secret)


@router.patch("/projects/{project_id}")
def update_project(project_id: int, body: ProjectUpdate, request: Request, admin: User = Depends(require_admin),
                   db: DbSession = Depends(get_db)) -> ProjectOut:
    project = _project(db, project_id)
    for field in ("name", "description", "redirect_uris", "allow_all_users", "is_active"):
        value = getattr(body, field)
        if value is not None:
            setattr(project, field, value)
    if "url" in body.model_fields_set:
        project.url = body.url
    if body.group_ids is not None:
        project.allowed_groups = _groups(db, body.group_ids)
    audit.record(db, "project_updated", actor=admin, target=project.name, ip=client_ip(request),
                 details={"fields": sorted(body.model_fields_set)})
    db.commit()
    return ProjectOut.of(project)


@router.post("/projects/{project_id}/rotate-secret")
def rotate_secret(project_id: int, request: Request, admin: User = Depends(require_admin),
                  db: DbSession = Depends(get_db)) -> ProjectWithSecret:
    project = _project(db, project_id)
    secret = _new_secret(project)
    audit.record(db, "project_secret_rotated", actor=admin, target=project.name, ip=client_ip(request))
    db.commit()
    return ProjectWithSecret(project=ProjectOut.of(project), client_secret=secret)


@router.delete("/projects/{project_id}")
def delete_project(project_id: int, request: Request, admin: User = Depends(require_admin),
                   db: DbSession = Depends(get_db)) -> dict:
    project = _project(db, project_id)
    name = project.name
    db.delete(project)
    audit.record(db, "project_deleted", actor=admin, target=name, ip=client_ip(request))
    db.commit()
    return {"ok": True}


# ---------- audit ----------


@router.get("/audit")
def audit_log(
    before: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    only_failures: bool = False,
    _admin: User = Depends(require_admin),
    db: DbSession = Depends(get_db),
) -> list[dict]:
    q = select(AuditEvent).order_by(AuditEvent.id.desc()).limit(limit)
    if before is not None:
        q = q.where(AuditEvent.id < before)
    if only_failures:
        q = q.where(AuditEvent.success.is_(False))
    return [
        {
            "id": e.id,
            "ts": e.ts.isoformat(),
            "event": e.event,
            "success": e.success,
            "actor": e.actor_name,
            "target": e.target,
            "project": e.project_name,
            "ip": e.ip,
            "details": e.details,
        }
        for e in db.scalars(q).all()
    ]
