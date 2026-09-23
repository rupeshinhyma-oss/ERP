"""
Trash API Routes.
"""

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.exceptions import ConflictException
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.rbac.dependencies import require_permission
from app.trash.schemas import TrashItemResponse, TrashRestoreRequest, TrashPermanentDeleteRequest
from app.trash.service import TrashService

router = APIRouter(prefix="/trash", tags=["Trash Management"])


@router.get("", summary="List all soft-deleted items")
async def list_trash(
    request: Request,
    # Deliberately view-only: restore/permanent-delete/empty below are NOT
    # gated by this or any other permission, by explicit design choice --
    # this single check only controls whether the Trash list itself is
    # visible.
    current_user: CurrentUser = Depends(require_permission("trash.view")),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Fetch soft-deleted items across all modules."""
    service = TrashService(db)
    items = await service.list_trash()
    data = [TrashItemResponse.model_validate(item).model_dump(mode="json") for item in items]
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/restore", summary="Restore soft-deleted items")
async def restore_trash(
    payload: TrashRestoreRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Restore selected soft-deleted items back to active state."""
    service = TrashService(db)
    restored_count = 0
    for item in payload.items:
        entity_type = item.get("entity_type")
        item_id = item.get("id")
        if entity_type and item_id:
            await service.restore_item(entity_type, item_id)
            restored_count += 1

    return build_success_response(
        data={"restored_count": restored_count, "message": f"Successfully restored {restored_count} item(s)."},
        request_id=request.state.request_id,
    )


@router.post("/permanent-delete", summary="Permanently delete items from database")
async def permanent_delete_trash(
    payload: TrashPermanentDeleteRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Permanently delete selected soft-deleted items from the database."""
    service = TrashService(db)
    deleted_count = 0
    blocked_reasons: list[str] = []

    for item in payload.items:
        entity_type = item.get("entity_type")
        item_id = item.get("id")
        if entity_type and item_id:
            try:
                await service.hard_delete_item(entity_type, item_id)
                deleted_count += 1
            except ConflictException as exc:
                if len(payload.items) == 1:
                    raise
                blocked_reasons.append(exc.message)

    if blocked_reasons and deleted_count == 0:
        raise ConflictException("\n".join(blocked_reasons))

    msg = f"Permanently deleted {deleted_count} item(s) from database."
    if blocked_reasons:
        msg += f" ({len(blocked_reasons)} item(s) kept archived due to active transaction history)."

    return build_success_response(
        data={"deleted_count": deleted_count, "message": msg},
        request_id=request.state.request_id,
        message=msg,
    )


@router.post("/empty", summary="Empty all items in trash permanently")
async def empty_trash(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Permanently delete ALL soft-deleted records from the database that have no active transaction dependencies."""
    service = TrashService(db)
    deleted_count, skipped_count = await service.empty_trash()
    if skipped_count > 0:
        msg = (
            f"Permanently deleted {deleted_count} unlinked item(s). "
            f"{skipped_count} item(s) with active transaction history were kept safely archived."
        )
    else:
        msg = f"Permanently deleted {deleted_count} item(s) from database."

    return build_success_response(
        data={
            "deleted_count": deleted_count,
            "skipped_count": skipped_count,
            "message": msg,
        },
        request_id=request.state.request_id,
        message=msg,
    )