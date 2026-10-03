"""Option Lists Routes.

Read endpoints need only an authenticated user (they feed every dropdown in the app);
write endpoints require the ``option_list.manage`` permission.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.masters.option_lists.schemas import (
    OptionListCreate,
    OptionListRead,
    OptionListUpdate,
    OptionLookup,
)
from app.masters.option_lists.service import OptionListService
from app.rbac.dependencies import require_permission

router = APIRouter(tags=["Masters - Option Lists"])


def get_option_list_service(session: AsyncSession = Depends(get_db_session)) -> OptionListService:
    """Build a request-scoped service."""
    return OptionListService(session)


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


@router.get("/lookup", summary="Active options for one or more groups (comma-separated keys)")
async def lookup_options(
    request: Request,
    groups: str = Query(..., description="Comma-separated group keys"),
    service: OptionListService = Depends(get_option_list_service),
    _user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Return ``{group_key: [options...]}`` for dropdowns."""
    grouped = await service.list_groups(groups.split(","))
    data = {
        key: [OptionLookup.model_validate(i).model_dump(mode="json") for i in items]
        for key, items in grouped.items()
    }
    return build_success_response(data=data, request_id=_rid(request))


@router.get("/groups", summary="List all defined group keys")
async def list_groups(
    request: Request,
    service: OptionListService = Depends(get_option_list_service),
    _user: CurrentUser = Depends(require_permission("option_list.manage")),
) -> dict:
    return build_success_response(data=await service.list_all_group_keys(), request_id=_rid(request))


@router.get("", summary="List options (admin view, all statuses)")
async def list_options(
    request: Request,
    group_key: str | None = None,
    service: OptionListService = Depends(get_option_list_service),
    _user: CurrentUser = Depends(require_permission("option_list.manage")),
) -> dict:
    items = await service.list_admin(group_key)
    data = [OptionListRead.model_validate(i).model_dump(mode="json") for i in items]
    return build_success_response(data=data, request_id=_rid(request))


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create an option")
async def create_option(
    request: Request,
    payload: OptionListCreate,
    service: OptionListService = Depends(get_option_list_service),
    _user: CurrentUser = Depends(require_permission("option_list.manage")),
) -> dict:
    item = await service.create(**payload.model_dump())
    return build_success_response(
        data=OptionListRead.model_validate(item).model_dump(mode="json"),
        message="Option created successfully.",
        request_id=_rid(request),
    )


@router.put("/{option_id}", summary="Update an option")
async def update_option(
    request: Request,
    option_id: uuid.UUID,
    payload: OptionListUpdate,
    service: OptionListService = Depends(get_option_list_service),
    _user: CurrentUser = Depends(require_permission("option_list.manage")),
) -> dict:
    item = await service.update(option_id, **payload.model_dump(exclude_unset=True))
    return build_success_response(
        data=OptionListRead.model_validate(item).model_dump(mode="json"),
        message="Option updated successfully.",
        request_id=_rid(request),
    )


@router.delete("/{option_id}", summary="Soft-delete an option")
async def delete_option(
    request: Request,
    option_id: uuid.UUID,
    service: OptionListService = Depends(get_option_list_service),
    _user: CurrentUser = Depends(require_permission("option_list.manage")),
) -> dict:
    await service.delete(option_id)
    return build_success_response(data=None, message="Option deleted successfully.", request_id=_rid(request))
