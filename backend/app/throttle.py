"""Brute-force protection for password and code checks, persisted in the database."""

import math
from dataclasses import dataclass
from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy.orm import Session as DbSession

from app.models import Throttle, utcnow


@dataclass(frozen=True)
class Rule:
    max_failures: int
    window: timedelta
    lockout: timedelta


USER_RULE = Rule(5, timedelta(minutes=15), timedelta(minutes=15))
IP_RULE = Rule(25, timedelta(minutes=15), timedelta(minutes=15))


def keys_for(username: str | None, ip: str | None) -> list[tuple[str, Rule]]:
    keys: list[tuple[str, Rule]] = []
    if username:
        keys.append((f"user:{username.lower()}", USER_RULE))
    if ip:
        keys.append((f"ip:{ip}", IP_RULE))
    return keys


def check(db: DbSession, keys: list[tuple[str, Rule]]) -> None:
    now = utcnow()
    for key, _rule in keys:
        row = db.get(Throttle, key)
        if row and row.locked_until and row.locked_until > now:
            retry = math.ceil((row.locked_until - now).total_seconds())
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"code": "locked", "retry_after": retry},
                headers={"Retry-After": str(retry)},
            )


def fail(db: DbSession, keys: list[tuple[str, Rule]]) -> None:
    now = utcnow()
    for key, rule in keys:
        row = db.get(Throttle, key)
        if row is None:
            row = Throttle(key=key, failures=0, window_start=now)
            db.add(row)
        if now - row.window_start > rule.window:
            row.failures = 0
            row.window_start = now
        row.failures += 1
        if row.failures >= rule.max_failures:
            row.locked_until = now + rule.lockout
            row.failures = 0
            row.window_start = now


def reset(db: DbSession, username: str) -> None:
    row = db.get(Throttle, f"user:{username.lower()}")
    if row is not None:
        db.delete(row)
