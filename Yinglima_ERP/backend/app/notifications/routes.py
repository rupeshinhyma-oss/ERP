"""
Notification Routes.

Provides endpoints for fetching user notifications, marking them read,
and configuring notification rules for administrators.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.notifications.schemas import (
    NotificationRead,
    NotificationRuleRead,
    NotificationRuleUpdate,
)
from app.notifications.service import NotificationService

router = APIRouter(prefix="/notifications", tags=["Notifications"])


def _req_id(request: Request) -> str:
    return getattr(getattr(request, "state", None), "request_id", str(uuid.uuid4()))


@router.get("", response_model=dict[str, Any])
async def get_my_notifications(
    request: Request,
    limit: int = Query(50, ge=1, le=100),
    unread_only: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Retrieve notifications for the current authenticated user."""
    notifs = await NotificationService.get_user_notifications(
        db, current_user.id, limit=limit, unread_only=unread_only
    )
    data = [NotificationRead.model_validate(n).model_dump(mode="json") for n in notifs]
    return build_success_response(data=data, request_id=_req_id(request))


@router.get("/unread-count", response_model=dict[str, Any])
async def get_my_unread_count(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Get the unread notification count for the current user."""
    count = await NotificationService.get_unread_count(db, current_user.id)
    return build_success_response(data={"unread_count": count}, request_id=_req_id(request))


@router.post("/{notification_id}/read", response_model=dict[str, Any])
async def mark_notification_read(
    request: Request,
    notification_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Mark a specific notification as read."""
    success = await NotificationService.mark_as_read(db, notification_id, current_user.id)
    await db.commit()
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    return build_success_response(data={"success": True}, request_id=_req_id(request))


@router.post("/read-all", response_model=dict[str, Any])
async def mark_all_notifications_read(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Mark all notifications as read for current user."""
    updated = await NotificationService.mark_all_as_read(db, current_user.id)
    await db.commit()
    return build_success_response(data={"marked_read_count": updated}, request_id=_req_id(request))


@router.get("/rules", response_model=dict[str, Any])
async def list_notification_rules(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """List all available notification rules and their mapped roles/users."""
    rules = await NotificationService.get_rules(db)
    data = [NotificationRuleRead.model_validate(r).model_dump(mode="json") for r in rules]
    return build_success_response(data=data, request_id=_req_id(request))


@router.put("/rules/{event_key}", response_model=dict[str, Any])
async def update_notification_rule(
    request: Request,
    event_key: str,
    payload: NotificationRuleUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Update mapped roles/departments and users for a notification rule."""
    rule = await NotificationService.update_rule(db, event_key, payload)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification rule not found")
    await db.commit()
    return build_success_response(
        data=NotificationRuleRead.model_validate(rule).model_dump(mode="json"),
        request_id=_req_id(request),
    )


@router.get("/users", response_model=dict[str, Any])
async def list_notification_users(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """List active users for notification recipient configuration."""
    users = await NotificationService.get_active_users(db)
    return build_success_response(data=users, request_id=_req_id(request))


@router.get("/roles", response_model=dict[str, Any])
async def list_notification_roles(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """List roles for notification department configuration."""
    from sqlalchemy import select
    from app.rbac.models import Role
    stmt = select(Role).where(Role.deleted_at.is_(None)).order_by(Role.name)
    res = await db.execute(stmt)
    data = [{"id": str(r.id), "name": r.name, "description": r.description} for r in res.scalars()]
    return build_success_response(data=data, request_id=_req_id(request))
