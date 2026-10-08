"""
FollowUp API Endpoints.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, get_current_user
from app.database.session import get_db_session
from app.core.responses import build_success_response
from app.follow_ups.models import FollowUp
from app.follow_ups.repository import FollowUpRepository
from app.follow_ups.schemas import (
    FollowUpBulkDeleteRequest,
    FollowUpCreate,
    FollowUpRead,
    FollowUpUpdate,
)
from app.follow_ups.service import FollowUpService

router = APIRouter(prefix="", tags=["Follow Ups"])


def get_service(db: AsyncSession = Depends(get_db_session)) -> FollowUpService:
    return FollowUpService(FollowUpRepository(db))


def _to_dict(item: FollowUp) -> dict[str, Any]:
    return FollowUpRead.model_validate(item).model_dump(mode="json")


@router.get("", summary="List follow-ups with search, filtering, and pagination")
@router.get("/list", summary="List follow-ups alias")
async def list_follow_ups(
    request: Request,
    search: str | None = Query(default=None),
    call_type: str | None = Query(default=None),
    marketing_person: str | None = Query(default=None),
    business_type: str | None = Query(default=None),
    state: str | None = Query(default=None),
    district: str | None = Query(default=None),
    city: str | None = Query(default=None),
    current_status: str | None = Query(default=None),
    status: str | None = Query(default=None),
    category: str | None = Query(default=None),
    client_grade: str | None = Query(default=None),
    potential_type: str | None = Query(default=None),
    business_category: str | None = Query(default=None),
    company_name: str | None = Query(default=None),
    call_category: str | None = Query(default=None),
    direct_import_from_china: str | None = Query(default=None),
    monthly_import_volume: str | None = Query(default=None),
    lead_status: str | None = Query(default=None),
    entry_source: str | None = Query(default=None),
    added_date: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    sort_by: str = Query(default="created_at"),
    sort_dir: str = Query(default="desc"),
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int | None = Query(default=None, ge=0),
    page: int | None = Query(default=None, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=500),
    service: FollowUpService = Depends(get_service),
) -> dict:
    effective_limit = page_size if page_size is not None else (limit if limit is not None else 50)
    effective_offset = (
        ((page - 1) * effective_limit) if page is not None else (offset if offset is not None else 0)
    )
    current_page = (effective_offset // effective_limit) + 1 if effective_limit > 0 else 1

    effective_status = current_status or status

    items, total = await service.list_follow_ups(
        search=search,
        call_type=call_type,
        marketing_person=marketing_person,
        business_type=business_type,
        state=state,
        district=district,
        city=city,
        current_status=effective_status,
        category=category,
        client_grade=client_grade,
        potential_type=potential_type,
        business_category=business_category,
        company_name=company_name,
        call_category=call_category,
        direct_import_from_china=direct_import_from_china,
        monthly_import_volume=monthly_import_volume,
        lead_status=lead_status,
        entry_source=entry_source,
        added_date=added_date,
        date_from=date_from,
        date_to=date_to,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=effective_limit,
        offset=effective_offset,
    )
    data = [_to_dict(item) for item in items]
    total_pages = (total + effective_limit - 1) // effective_limit if total > 0 else 1

    return {
        "success": True,
        "data": data,
        "meta": {
            "total": total,
            "limit": effective_limit,
            "offset": effective_offset,
            "page": current_page,
            "pages": total_pages,
            "pagination": {
                "total_records": total,
                "page": current_page,
                "page_size": effective_limit,
                "total_pages": total_pages,
            },
        },
    }


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a new follow-up log")
async def create_follow_up(
    payload: FollowUpCreate,
    service: FollowUpService = Depends(get_service),
) -> dict:
    item = await service.create(payload)
    return {
        "success": True,
        "message": "Follow-up log created successfully.",
        "data": _to_dict(item),
    }


@router.post("/bulk-delete", summary="Bulk soft-delete follow-up logs")
async def bulk_delete_follow_ups(
    payload: FollowUpBulkDeleteRequest,
    service: FollowUpService = Depends(get_service),
) -> dict:
    deleted_count = await service.bulk_delete(payload.ids)
    return {
        "success": True,
        "message": f"Successfully deleted {deleted_count} follow-up log(s).",
        "data": {"deleted_count": deleted_count},
    }


@router.get("/{item_id}", summary="Get follow-up log by ID")
async def get_follow_up(
    item_id: uuid.UUID,
    service: FollowUpService = Depends(get_service),
) -> dict:
    item = await service.get_by_id(item_id)
    return {
        "success": True,
        "data": _to_dict(item),
    }


@router.put("/{item_id}", summary="Update an existing follow-up log")
async def update_follow_up(
    item_id: uuid.UUID,
    payload: FollowUpUpdate,
    service: FollowUpService = Depends(get_service),
) -> dict:
    item = await service.update(item_id, payload)
    return {
        "success": True,
        "message": "Follow-up log updated successfully.",
        "data": _to_dict(item),
    }


@router.delete("/{item_id}", summary="Soft delete a follow-up log")
async def delete_follow_up(
    item_id: uuid.UUID,
    service: FollowUpService = Depends(get_service),
) -> dict:
    await service.delete(item_id)
    return {
        "success": True,
        "message": "Follow-up log deleted successfully.",
        "data": {"id": str(item_id)},
    }
