from sqlalchemy.orm import Session as DbSession

from app.models import AuditEvent, User


def record(
    db: DbSession,
    event: str,
    *,
    actor: User | None = None,
    actor_name: str | None = None,
    target: str | None = None,
    project_name: str | None = None,
    ip: str | None = None,
    success: bool = True,
    details: dict | None = None,
) -> None:
    db.add(
        AuditEvent(
            event=event,
            success=success,
            actor_id=actor.id if actor else None,
            actor_name=actor.username if actor else actor_name,
            target=target,
            project_name=project_name,
            ip=ip,
            details=details,
        )
    )
