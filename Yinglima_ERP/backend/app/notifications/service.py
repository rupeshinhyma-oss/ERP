"""
Notification Service.

Handles fetching and updating notification rules, retrieving user inbox alerts,
and dispatching events to mapped roles/departments and users.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Sequence

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications.models import Notification, NotificationRule
from app.notifications.schemas import NotificationRuleUpdate
from app.rbac.models import RoleAssignmentStatus, UserRole
from app.users.models import User, UserStatus

logger = logging.getLogger("notifications")


class NotificationService:
    """Core service for managing notification rules and dispatching in-app alerts."""

    @staticmethod
    async def get_rules(db: AsyncSession) -> Sequence[NotificationRule]:
        stmt = select(NotificationRule).order_by(NotificationRule.module, NotificationRule.created_at)
        result = await db.execute(stmt)
        return result.scalars().all()

    @staticmethod
    async def get_rule_by_key(db: AsyncSession, event_key: str) -> NotificationRule | None:
        stmt = select(NotificationRule).where(NotificationRule.event_key == event_key)
        result = await db.execute(stmt)
        return result.scalars().first()

    @staticmethod
    async def update_rule(
        db: AsyncSession, event_key: str, data: NotificationRuleUpdate
    ) -> NotificationRule | None:
        rule = await NotificationService.get_rule_by_key(db, event_key)
        if not rule:
            return None

        if data.role_ids is not None:
            rule.role_ids = data.role_ids
        if data.user_ids is not None:
            rule.user_ids = data.user_ids
        if data.is_active is not None:
            rule.is_active = data.is_active

        await db.flush()
        return rule

    @staticmethod
    async def get_user_notifications(
        db: AsyncSession, user_id: uuid.UUID, limit: int = 50, unread_only: bool = False
    ) -> Sequence[Notification]:
        stmt = select(Notification).where(Notification.user_id == user_id)
        if unread_only:
            stmt = stmt.where(Notification.is_read.is_(False))
        stmt = stmt.order_by(Notification.created_at.desc()).limit(limit)
        result = await db.execute(stmt)
        return result.scalars().all()

    @staticmethod
    async def get_unread_count(db: AsyncSession, user_id: uuid.UUID) -> int:
        stmt = select(func.count()).select_from(Notification).where(
            Notification.user_id == user_id,
            Notification.is_read.is_(False),
        )
        result = await db.execute(stmt)
        return result.scalar() or 0

    @staticmethod
    async def mark_as_read(db: AsyncSession, notification_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        stmt = (
            update(Notification)
            .where(Notification.id == notification_id, Notification.user_id == user_id)
            .values(is_read=True)
        )
        res = await db.execute(stmt)
        await db.flush()
        return (res.rowcount or 0) > 0

    @staticmethod
    async def mark_all_as_read(db: AsyncSession, user_id: uuid.UUID) -> int:
        stmt = (
            update(Notification)
            .where(Notification.user_id == user_id, Notification.is_read.is_(False))
            .values(is_read=True)
        )
        res = await db.execute(stmt)
        await db.flush()
        return res.rowcount or 0

    @staticmethod
    async def dispatch_event(
        db: AsyncSession,
        event_key: str,
        title: str,
        message: str,
        link: str | None = None,
        sender_id: uuid.UUID | None = None,
    ) -> list[uuid.UUID]:
        """
        Dispatches an in-app alert according to the configured rule for event_key.
        Finds all active users matching the rule's role_ids and user_ids, excluding sender_id.
        """
        rule = await NotificationService.get_rule_by_key(db, event_key)
        if not rule or not rule.is_active:
            return []

        recipient_ids: set[uuid.UUID] = set()

        # 1. Parse directly assigned user IDs
        for uid_str in rule.user_ids or []:
            try:
                recipient_ids.add(uuid.UUID(str(uid_str)))
            except (ValueError, TypeError):
                pass

        # 2. Parse mapped role/department IDs and find active member users
        role_uuids: list[uuid.UUID] = []
        for rid_str in rule.role_ids or []:
            try:
                role_uuids.append(uuid.UUID(str(rid_str)))
            except (ValueError, TypeError):
                pass

        if role_uuids:
            stmt = select(UserRole.user_id).where(
                UserRole.role_id.in_(role_uuids),
                UserRole.status == RoleAssignmentStatus.ACTIVE,
            )
            res = await db.execute(stmt)
            for r in res.scalars():
                recipient_ids.add(r)

        # 3. Exclude sender so they don't notify themselves
        if sender_id and sender_id in recipient_ids:
            recipient_ids.remove(sender_id)

        if not recipient_ids:
            return []

        # 4. Create notification records in bulk
        for r_user_id in recipient_ids:
            notif = Notification(
                user_id=r_user_id,
                sender_id=sender_id,
                type=rule.event_key,
                module=rule.module,
                title=title,
                message=message,
                link=link,
                is_read=False,
            )
            db.add(notif)

        await db.flush()
        logger.info(f"Dispatched notification '{event_key}' to {len(recipient_ids)} recipients.")
        return list(recipient_ids)

    @staticmethod
    async def get_active_users(db: AsyncSession) -> list[dict[str, Any]]:
        """Retrieve active users belonging to Yinglima ERP for notification recipient configuration."""
        stmt = (
            select(User)
            .where(
                User.deleted_at.is_(None),
                User.is_active.is_(True),
                User.status == UserStatus.ACTIVE,
            )
            .order_by(User.first_name.nulls_last(), User.username)
        )
        result = await db.execute(stmt)
        users = result.scalars().all()
        return [
            {
                "id": str(u.id),
                "username": u.username or u.employee_code or "user",
                "display_name": u.display_name,
                "first_name": u.first_name,
                "last_name": u.last_name,
                "email": u.email,
            }
            for u in users
        ]
