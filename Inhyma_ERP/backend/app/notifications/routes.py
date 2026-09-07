"""
Notifications API Routes.
"""

from __future__ import annotations

import uuid
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.notifications.repository import NotificationRepository
from app.notifications.schemas import NotificationListResponse, NotificationRead
from app.notifications.service import NotificationService

router = APIRouter(prefix="/notifications", tags=["Notifications"])


def get_notification_service(db: AsyncSession = Depends(get_db_session)) -> NotificationService:
    return NotificationService(repository=NotificationRepository(db))


@router.get("", summary="Get current user's notifications")
async def get_my_notifications(
    request: Request,
    unread_only: bool = False,
    limit: int = 50,
    current_user: CurrentUser = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
) -> dict:
    items, unread_count = await service.list_notifications(
        current_user.id, limit=limit, unread_only=unread_only
    )
    serialized = [NotificationRead.model_validate(n).model_dump() for n in items]
    data = NotificationListResponse(items=serialized, unread_count=unread_count).model_dump()
    return build_success_response(data=data, request_id=getattr(request.state, "request_id", "-"))


@router.patch("/{id}/read", summary="Mark single notification as read")
async def mark_notification_read(
    id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
) -> dict:
    success = await service.mark_read(id, current_user.id)
    return build_success_response(
        data={"success": success}, request_id=getattr(request.state, "request_id", "-")
    )


@router.post("/read-all", summary="Mark all notifications as read")
async def mark_all_notifications_read(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
) -> dict:
    count = await service.mark_all_read(current_user.id)
    return build_success_response(
        data={"marked_read_count": count}, request_id=getattr(request.state, "request_id", "-")
    )
