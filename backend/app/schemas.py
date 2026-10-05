import re
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field, StringConstraints

from app.models import Group, Project, User
from app.security import MIN_PASSWORD_LENGTH

_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,31}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _slug(value: str) -> str:
    value = value.strip().lower()
    if not _NAME_RE.fullmatch(value):
        raise ValueError("2–32 символа: латиница, цифры, точка, дефис, подчёркивание")
    return value


def _email(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if not _EMAIL_RE.fullmatch(value):
        raise ValueError("Некорректный email")
    return value


def _password(value: str) -> str:
    if len(value) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Минимум {MIN_PASSWORD_LENGTH} символов")
    if len(value) > 256:
        raise ValueError("Слишком длинный пароль")
    return value


_BLOCKED_SCHEMES = {"javascript", "data", "file", "vbscript", "blob"}


def _redirect_uri(value: str) -> str:
    value = value.strip()
    # http(s) for web apps, custom schemes (app.immich:///...) for mobile apps.
    match = re.match(r"^([a-z][a-z0-9+.-]*):(//)?[^\s#]+$", value, re.IGNORECASE)
    if not match or match.group(1).lower() in _BLOCKED_SCHEMES or len(value) > 512:
        raise ValueError("Нужен полный адрес вида https://… или app.scheme:///…, без #")
    return value


def _optional_url(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    value = value.strip()
    if not re.match(r"^https?://\S+$", value) or len(value) > 512:
        raise ValueError("Адрес должен начинаться с http:// или https://")
    return value


Slug = Annotated[str, AfterValidator(_slug)]
Email = Annotated[str | None, AfterValidator(_email)]
Password = Annotated[str, AfterValidator(_password)]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
RedirectUri = Annotated[str, AfterValidator(_redirect_uri)]
Url = Annotated[str | None, AfterValidator(_optional_url)]


# ---------- auth ----------


class LoginIn(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)
    return_to: str | None = Field(default=None, max_length=4096)


class CodeIn(BaseModel):
    code: str | None = Field(default=None, max_length=16)
    recovery_code: str | None = Field(default=None, max_length=32)


class SetupIn(BaseModel):
    token: str = Field(max_length=128)
    username: Slug
    display_name: DisplayName
    email: Email = None
    password: Password


# ---------- users ----------


class GroupRef(BaseModel):
    id: int
    name: str


class UserOut(BaseModel):
    id: str
    username: str
    display_name: str
    email: str | None
    is_active: bool
    is_admin: bool
    groups: list[GroupRef]
    totp_enrolled: bool
    created_at: datetime
    last_login_at: datetime | None

    @classmethod
    def of(cls, user: User) -> "UserOut":
        return cls(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            email=user.email,
            is_active=user.is_active,
            is_admin=user.is_admin,
            groups=[GroupRef(id=g.id, name=g.name) for g in sorted(user.groups, key=lambda g: g.name)],
            totp_enrolled=user.totp is not None,
            created_at=user.created_at,
            last_login_at=user.last_login_at,
        )


class UserCreate(BaseModel):
    username: Slug
    display_name: DisplayName
    email: Email = None
    password: Password
    group_ids: list[int] = []


class UserUpdate(BaseModel):
    display_name: DisplayName | None = None
    email: Email = None
    is_active: bool | None = None
    group_ids: list[int] | None = None


class PasswordSet(BaseModel):
    password: Password


class ProfileUpdate(BaseModel):
    display_name: DisplayName | None = None
    email: Email = None


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: Password


class PasswordConfirm(BaseModel):
    password: str = Field(max_length=256)


# ---------- groups ----------


class GroupOut(BaseModel):
    id: int
    name: str
    description: str
    is_system: bool
    member_count: int
    created_at: datetime

    @classmethod
    def of(cls, group: Group) -> "GroupOut":
        return cls(
            id=group.id,
            name=group.name,
            description=group.description,
            is_system=group.is_system,
            member_count=len(group.users),
            created_at=group.created_at,
        )


class GroupCreate(BaseModel):
    name: Slug
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] = ""


class GroupUpdate(BaseModel):
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]


# ---------- projects ----------


class ProjectOut(BaseModel):
    id: int
    name: str
    description: str
    url: str | None
    client_id: str
    redirect_uris: list[str]
    allow_all_users: bool
    allowed_groups: list[GroupRef]
    is_active: bool
    created_at: datetime
    secret_rotated_at: datetime

    @classmethod
    def of(cls, project: Project) -> "ProjectOut":
        return cls(
            id=project.id,
            name=project.name,
            description=project.description,
            url=project.url,
            client_id=project.client_id,
            redirect_uris=project.redirect_uris or [],
            allow_all_users=project.allow_all_users,
            allowed_groups=[GroupRef(id=g.id, name=g.name) for g in sorted(project.allowed_groups, key=lambda g: g.name)],
            is_active=project.is_active,
            created_at=project.created_at,
            secret_rotated_at=project.secret_rotated_at,
        )


class ProjectWithSecret(BaseModel):
    project: ProjectOut
    client_secret: str


class ProjectCreate(BaseModel):
    name: DisplayName
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] = ""
    url: Url = None
    redirect_uris: list[RedirectUri] = []
    allow_all_users: bool = False
    group_ids: list[int] = []


class ProjectUpdate(BaseModel):
    name: DisplayName | None = None
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] | None = None
    url: Url = None
    redirect_uris: list[RedirectUri] | None = None
    allow_all_users: bool | None = None
    is_active: bool | None = None
    group_ids: list[int] | None = None


class ServiceOut(BaseModel):
    id: int
    name: str
    description: str
    url: str | None


# ---------- service API (backend-to-backend) ----------


class ServiceAuthIn(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)
    totp_code: str | None = Field(default=None, max_length=16)


class ServiceUser(BaseModel):
    id: str
    username: str
    display_name: str
    email: str | None
    groups: list[str]
    is_active: bool

    @classmethod
    def of(cls, user: User) -> "ServiceUser":
        return cls(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            email=user.email,
            groups=user.group_names,
            is_active=user.is_active,
        )
