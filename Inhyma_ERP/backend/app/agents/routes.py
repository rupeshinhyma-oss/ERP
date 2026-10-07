"""
Agents API Endpoints.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.models import Agent
from app.agents.repository import AgentRepository
from app.agents.schemas import (
    AgentBulkDeleteRequest,
    AgentCreate,
    AgentDuplicateCheckResponse,
    AgentRead,
    AgentUpdate,
)
from app.agents.service import AgentService
from app.auth.dependencies import CurrentUser, get_current_user
from app.database.session import get_db_session

router = APIRouter(prefix="", tags=["Agents"])


def get_service(db: AsyncSession = Depends(get_db_session)) -> AgentService:
    return AgentService(AgentRepository(db))


def _to_dict(agent: Agent) -> dict[str, Any]:
    return AgentRead.model_validate(agent).model_dump(mode="json")


@router.get("", summary="List agents with filtering and pagination")
@router.get("/list", summary="List agents alias")
async def list_agents(
    request: Request,
    search: str | None = Query(default=None),
    sales_person: str | None = Query(default=None),
    state: str | None = Query(default=None),
    district: str | None = Query(default=None),
    city: str | None = Query(default=None),
    grade: str | None = Query(default=None),
    status: str | None = Query(default=None),
    sort_by: str = Query(default="created_at"),
    sort_dir: str = Query(default="desc"),
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int | None = Query(default=None, ge=0),
    page: int | None = Query(default=None, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=500),
    service: AgentService = Depends(get_service),
) -> dict:
    effective_limit = page_size if page_size is not None else (limit if limit is not None else 50)
    effective_offset = (
        ((page - 1) * effective_limit) if page is not None else (offset if offset is not None else 0)
    )
    current_page = (effective_offset // effective_limit) + 1 if effective_limit > 0 else 1

    items, total = await service.list_agents(
        search=search,
        sales_person=sales_person,
        state=state,
        district=district,
        city=city,
        grade=grade,
        status=status,
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


@router.get("/check-duplicate", summary="Check duplicate calling/whatsapp numbers")
async def check_duplicate(
    calling_number: str | None = Query(default=None),
    whatsapp_number: str | None = Query(default=None),
    exclude_id: uuid.UUID | None = Query(default=None),
    service: AgentService = Depends(get_service),
) -> dict:
    exists, field, agent_name = await service.check_duplicate(calling_number, whatsapp_number, exclude_id)
    return {
        "success": True,
        "data": {
            "exists": exists,
            "field": field,
            "agent_name": agent_name,
        },
    }


@router.get("/{id}", summary="Get agent by ID")
async def get_agent(
    id: uuid.UUID,
    service: AgentService = Depends(get_service),
) -> dict:
    agent = await service.get_agent(id)
    return {"success": True, "data": _to_dict(agent)}


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a new agent")
async def create_agent(
    payload: AgentCreate,
    service: AgentService = Depends(get_service),
) -> dict:
    agent = await service.create_agent(payload)
    return {"success": True, "data": _to_dict(agent)}


@router.put("/{id}", summary="Update an existing agent")
async def update_agent(
    id: uuid.UUID,
    payload: AgentUpdate,
    service: AgentService = Depends(get_service),
) -> dict:
    agent = await service.update_agent(id, payload)
    return {"success": True, "data": _to_dict(agent)}


@router.delete("/{id}", summary="Soft-delete an agent")
async def delete_agent(
    id: uuid.UUID,
    service: AgentService = Depends(get_service),
) -> dict:
    success = await service.delete_agent(id)
    return {"success": success, "data": {"id": str(id)}}


@router.post("/bulk-delete", summary="Bulk soft-delete agents")
async def bulk_delete_agents(
    payload: AgentBulkDeleteRequest,
    service: AgentService = Depends(get_service),
) -> dict:
    deleted_count = await service.bulk_delete(payload.ids)
    return {"success": True, "data": {"deleted_count": deleted_count}}
