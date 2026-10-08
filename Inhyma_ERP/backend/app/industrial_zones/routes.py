"""
Industrial Zones API Endpoints.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, get_current_user
from app.database.session import get_db_session
from app.industrial_zones.models import IndustrialZone
from app.industrial_zones.repository import IndustrialZoneRepository
from app.industrial_zones.schemas import (
    IndustrialZoneBulkDeleteRequest,
    IndustrialZoneCreate,
    IndustrialZoneRead,
    IndustrialZoneUpdate,
)
from app.industrial_zones.service import IndustrialZoneService

router = APIRouter(prefix="", tags=["Industrial Zones"])


def get_service(db: AsyncSession = Depends(get_db_session)) -> IndustrialZoneService:
    return IndustrialZoneService(IndustrialZoneRepository(db))


def _to_dict(zone: IndustrialZone) -> dict[str, Any]:
    return IndustrialZoneRead.model_validate(zone).model_dump(mode="json")


@router.get("", summary="List industrial zones with filtering and pagination")
@router.get("/list", summary="List industrial zones alias")
async def list_industrial_zones(
    request: Request,
    search: str | None = Query(default=None),
    grade: str | None = Query(default=None),
    state: str | None = Query(default=None),
    district: str | None = Query(default=None),
    city: str | None = Query(default=None),
    sort_by: str = Query(default="created_at"),
    sort_dir: str = Query(default="desc"),
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int | None = Query(default=None, ge=0),
    page: int | None = Query(default=None, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=500),
    service: IndustrialZoneService = Depends(get_service),
) -> dict:
    effective_limit = page_size if page_size is not None else (limit if limit is not None else 50)
    effective_offset = (
        ((page - 1) * effective_limit) if page is not None else (offset if offset is not None else 0)
    )
    current_page = (effective_offset // effective_limit) + 1 if effective_limit > 0 else 1

    items, total = await service.list_zones(
        search=search,
        grade=grade,
        state=state,
        district=district,
        city=city,
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


@router.get("/check-name", summary="Check if zone name already exists")
async def check_zone_name(
    name: str = Query(..., min_length=1),
    exclude_id: uuid.UUID | None = Query(default=None),
    service: IndustrialZoneService = Depends(get_service),
) -> dict:
    exists = await service.check_name_exists(name, exclude_id)
    return {"success": True, "data": {"exists": exists}}


@router.get("/{id}", summary="Get industrial zone by ID")
async def get_industrial_zone(
    id: uuid.UUID,
    service: IndustrialZoneService = Depends(get_service),
) -> dict:
    zone = await service.get_zone(id)
    return {"success": True, "data": _to_dict(zone)}


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a new industrial zone")
async def create_industrial_zone(
    payload: IndustrialZoneCreate,
    service: IndustrialZoneService = Depends(get_service),
) -> dict:
    zone = await service.create_zone(payload)
    return {"success": True, "data": _to_dict(zone)}


@router.put("/{id}", summary="Update an existing industrial zone")
async def update_industrial_zone(
    id: uuid.UUID,
    payload: IndustrialZoneUpdate,
    service: IndustrialZoneService = Depends(get_service),
) -> dict:
    zone = await service.update_zone(id, payload)
    return {"success": True, "data": _to_dict(zone)}


@router.delete("/{id}", summary="Soft-delete an industrial zone")
async def delete_industrial_zone(
    id: uuid.UUID,
    service: IndustrialZoneService = Depends(get_service),
) -> dict:
    success = await service.delete_zone(id)
    return {"success": success, "data": {"id": str(id)}}


@router.post("/bulk-delete", summary="Bulk soft-delete industrial zones")
async def bulk_delete_industrial_zones(
    payload: IndustrialZoneBulkDeleteRequest,
    service: IndustrialZoneService = Depends(get_service),
) -> dict:
    deleted_count = await service.bulk_delete(payload.ids)
    return {"success": True, "data": {"deleted_count": deleted_count}}
