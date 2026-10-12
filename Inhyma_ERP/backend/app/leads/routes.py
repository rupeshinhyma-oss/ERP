"""
Lead API Endpoints.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, get_current_user
from app.database.session import get_db_session
from app.core.responses import build_success_response
from app.leads.models import Lead
from app.leads.repository import LeadRepository
from app.leads.schemas import LeadAllotRequest, LeadBulkDeleteRequest, LeadCreate, LeadRead, LeadUpdate
from app.leads.service import LeadService

router = APIRouter(prefix="", tags=["Leads"])


def get_service(db: AsyncSession = Depends(get_db_session)) -> LeadService:
    return LeadService(LeadRepository(db))


def _to_dict(lead: Lead) -> dict[str, Any]:
    return LeadRead.model_validate(lead).model_dump(mode="json")


@router.get("", summary="List leads with search, filtering, and pagination")
@router.get("/list", summary="List leads alias")
async def list_leads(
    request: Request,
    search: str | None = Query(default=None),
    source: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    business_type: str | None = Query(default=None),
    allotted_to: str | None = Query(default=None),
    created_by: str | None = Query(default=None),
    status: str | None = Query(default=None),
    lead_status: str | None = Query(default=None),
    city: str | None = Query(default=None),
    district: str | None = Query(default=None),
    state: str | None = Query(default=None),
    call_type: str | None = Query(default=None),
    company_name: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    sort_by: str = Query(default="created_at"),
    sort_dir: str = Query(default="desc"),
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int | None = Query(default=None, ge=0),
    page: int | None = Query(default=None, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=500),
    service: LeadService = Depends(get_service),
) -> dict:
    effective_limit = page_size if page_size is not None else (limit if limit is not None else 50)
    effective_offset = (
        ((page - 1) * effective_limit) if page is not None else (offset if offset is not None else 0)
    )
    current_page = (effective_offset // effective_limit) + 1 if effective_limit > 0 else 1

    effective_status = lead_status or status

    items, total = await service.list_leads(
        search=search,
        source=source,
        priority=priority,
        business_type=business_type,
        allotted_to=allotted_to,
        created_by=created_by,
        status=effective_status,
        city=city,
        district=district,
        state=state,
        call_type=call_type,
        company_name=company_name,
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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a new lead")
async def create_lead(
    payload: LeadCreate,
    request: Request,
    service: LeadService = Depends(get_service),
) -> dict:
    lead = await service.create(payload)
    return build_success_response(data=_to_dict(lead), message="Lead created successfully.")


@router.get("/{lead_id}", summary="Get lead by ID")
async def get_lead(
    lead_id: uuid.UUID,
    service: LeadService = Depends(get_service),
) -> dict:
    lead = await service.get_by_id(lead_id)
    return build_success_response(data=_to_dict(lead))


@router.put("/{lead_id}", summary="Update a lead")
async def update_lead(
    lead_id: uuid.UUID,
    payload: LeadUpdate,
    service: LeadService = Depends(get_service),
) -> dict:
    lead = await service.update(lead_id, payload)
    return build_success_response(data=_to_dict(lead), message="Lead updated successfully.")


@router.post("/{lead_id}/allot", summary="Allot lead to salesperson/team member")
async def allot_lead(
    lead_id: uuid.UUID,
    payload: LeadAllotRequest,
    service: LeadService = Depends(get_service),
) -> dict:
    lead = await service.allot_lead(lead_id, payload.allotted_to)
    return build_success_response(data=_to_dict(lead), message="Lead allotted successfully.")


@router.delete("/{lead_id}", summary="Delete a lead")
async def delete_lead(
    lead_id: uuid.UUID,
    service: LeadService = Depends(get_service),
) -> dict:
    await service.delete(lead_id)
    return build_success_response(data={"id": str(lead_id)}, message="Lead deleted successfully.")


@router.post("/bulk-delete", summary="Bulk soft-delete leads")
async def bulk_delete_leads(
    payload: LeadBulkDeleteRequest,
    service: LeadService = Depends(get_service),
) -> dict:
    deleted_count = await service.bulk_delete(payload.ids)
    return build_success_response(
        data={"deleted_count": deleted_count},
        message=f"{deleted_count} lead(s) deleted successfully.",
    )
