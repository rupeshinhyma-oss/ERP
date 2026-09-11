"""
Notifications Service.
"""

from __future__ import annotations

import uuid
from typing import Any

from app.core.logging import get_logger
from app.events.channels import user_channel
from app.events.dispatcher import EventDispatcher
from app.events.models import Event
from app.notifications.models import Notification
from app.notifications.repository import NotificationRepository

logger = get_logger(__name__)


class NotificationService:
    """Orchestrates notification creation, database persistence, and WebSocket push."""

    def __init__(
        self,
        repository: NotificationRepository,
        dispatcher: EventDispatcher | None = None,
    ) -> None:
        self.repository = repository
        self.dispatcher = dispatcher or EventDispatcher()

    async def notify_user(
        self,
        *,
        user_id: uuid.UUID,
        type: str,
        title: str,
        message: str,
        link: str | None = None,
    ) -> Notification:
        """Store notification in database and push live WebSocket event to active user."""
        notif = await self.repository.create(
            user_id=user_id,
            type=type,
            title=title,
            message=message,
            link=link,
        )

        # Broadcast real-time event to user's private channel
        try:
            event = Event(
                event_type="NOTIFICATION_RECEIVED",
                entity="notification",
                entity_id=str(notif.id),
                changes={
                    "id": str(notif.id),
                    "type": notif.type,
                    "title": notif.title,
                    "message": notif.message,
                    "link": notif.link,
                    "created_at": notif.created_at.isoformat() if notif.created_at else None,
                },
            )
            await self.dispatcher.publish(user_channel(user_id), event)
        except Exception:
            logger.exception("Failed to dispatch live notification event.", extra={"user_id": str(user_id)})

        return notif

    async def list_notifications(
        self, user_id: uuid.UUID, *, limit: int = 50, unread_only: bool = False
    ) -> tuple[list[Notification], int]:
        items = await self.repository.list_for_user(user_id, limit=limit, unread_only=unread_only)
        unread_count = await self.repository.count_unread_for_user(user_id)
        return items, unread_count

    async def mark_read(self, notification_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        return await self.repository.mark_as_read(notification_id, user_id)

    async def mark_all_read(self, user_id: uuid.UUID) -> int:
        return await self.repository.mark_all_as_read(user_id)

    async def has_recent_notification(
        self, user_id: uuid.UUID, type: str, link: str | None = None, *, within_hours: int = 24
    ) -> bool:
        return await self.repository.has_recent_notification(
            user_id, type, link, within_hours=within_hours
        )
