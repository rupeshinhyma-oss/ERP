"""
Central session helpers: ONE session id (`sid`) per login.

A login -- on the dashboard or on an ERP -- creates exactly one `GlobalSession` row.  Its id is the `sid` that is put
inside every token issued during that login (the dashboard token and each ERP's tokens).  Signing out revokes that
one `sid`: it ends this login everywhere it was used, and never touches another login of the same account, a second
device, or another person.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.global_auth.models import GlobalSession
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.platform_auth.models import PlatformAdmin, PlatformAdminRole


def _utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse_session_id(value: object) -> Optional[uuid.UUID]:
    """A central session id is a UUID.  Anything else (e.g. a local fallback id) is not a central session."""
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


async def ensure_admin_mirror_user(db: AsyncSession, admin: PlatformAdmin) -> GlobalUser:
    """The GlobalUser row that persists a platform admin's sessions (so they survive restarts / several workers)."""
    email = (admin.email or "").strip().lower()
    mirror = await db.scalar(select(GlobalUser).where(func.lower(GlobalUser.primary_email) == email))
    if mirror is None:
        mirror = GlobalUser(
            primary_email=email,
            display_name=admin.display_name or "Super Admin",
            status=GlobalUserStatus.ACTIVE,
            metadata_json={"role": "super_admin" if admin.role == PlatformAdminRole.SUPER_ADMIN else "admin"},
        )
        db.add(mirror)
        await db.flush()
    return mirror


async def create_session_row(
    db: AsyncSession, global_user_id: uuid.UUID, *, ip: Optional[str] = None, user_agent: Optional[str] = None
) -> GlobalSession:
    now = datetime.now(timezone.utc)
    row = GlobalSession(
        global_user_id=global_user_id,
        expires_at=now + timedelta(hours=settings.GLOBAL_SESSION_MAX_LIFETIME_HOURS),
        last_activity_at=now,
        ip_address=(ip or None),
        user_agent=((user_agent or "")[:500] or None),
    )
    db.add(row)
    await db.flush()
    return row


async def open_admin_session(
    db: AsyncSession, admin: PlatformAdmin, *, ip: Optional[str] = None, user_agent: Optional[str] = None
) -> str:
    """A new login for a platform admin: returns the `sid` to embed in the admin's token."""
    mirror = await ensure_admin_mirror_user(db, admin)
    row = await create_session_row(db, mirror.id, ip=ip, user_agent=user_agent)
    await db.commit()
    return str(row.id)


async def session_is_live(db: AsyncSession, session_id: object) -> bool:
    """True only if this exact session exists, is not revoked and has not expired."""
    sid = parse_session_id(session_id)
    if sid is None:
        return False
    row = await db.scalar(select(GlobalSession).where(GlobalSession.id == sid))
    if row is None or row.revoked_at is not None:
        return False
    return _utc(row.expires_at) > datetime.now(timezone.utc)
