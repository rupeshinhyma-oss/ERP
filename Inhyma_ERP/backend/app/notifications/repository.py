"""
Notifications Repository.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications.models import Notification


class NotificationRepository:
    """Database repository for user notifications."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_for_user(
        self, user_id: uuid.UUID, *, limit: int = 50, unread_only: bool = False
    ) -> list[Notification]:
        stmt = (
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
            .limit(limit)
        )
        if unread_only:
            stmt = stmt.where(Notification.is_read.is_(False))
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    async def count_unread_for_user(self, user_id: uuid.UUID) -> int:
        stmt = (
            select(func.count(Notification.id))
            .where(Notification.user_id == user_id, Notification.is_read.is_(False))
        )
        res = await self.session.execute(stmt)
        return int(res.scalar() or 0)

    async def get_by_id(self, notification_id: uuid.UUID) -> Notification | None:
        stmt = select(Notification).where(Notification.id == notification_id)
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def create(
        self,
        *,
        user_id: uuid.UUID,
        type: str,
        title: str,
        message: str,
        link: str | None = None,
    ) -> Notification:
        notif = Notification(
            user_id=user_id,
            type=type,
            title=title,
            message=message,
            link=link,
            is_read=False,
        )
        self.session.add(notif)
        await self.session.flush()
        return notif

    async def mark_as_read(self, notification_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        stmt = (
            update(Notification)
            .where(Notification.id == notification_id, Notification.user_id == user_id)
            .values(is_read=True)
        )
        res = await self.session.execute(stmt)
        await self.session.flush()
        return bool(res.rowcount > 0)

    async def mark_all_as_read(self, user_id: uuid.UUID) -> int:
        stmt = (
            update(Notification)
            .where(Notification.user_id == user_id, Notification.is_read.is_(False))
            .values(is_read=True)
        )
        res = await self.session.execute(stmt)
        await self.session.flush()
        return int(res.rowcount)

    async def has_recent_notification(
        self,
        user_id: uuid.UUID,
        type: str,
        link: str | None = None,
        *,
        within_hours: int = 24,
    ) -> bool:
        """Check if user was already notified with the same type and link recently (deduplication)."""
        since = datetime.now(timezone.utc) - timedelta(hours=within_hours)
        stmt = select(func.count(Notification.id)).where(
            Notification.user_id == user_id,
            Notification.type == type,
            Notification.created_at >= since,
        )
        if link:
            stmt = stmt.where(Notification.link == link)
        res = await self.session.execute(stmt)
        return int(res.scalar() or 0) > 0
