"""
Lead Service.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from app.core.exceptions import NotFoundException
from app.leads.models import Lead
from app.leads.repository import LeadRepository
from app.leads.schemas import LeadCreate, LeadUpdate


class LeadService:
    """Service layer for Lead operations."""

    def __init__(self, repository: LeadRepository) -> None:
        self.repository = repository

    async def list_leads(
        self,
        *,
        search: str | None = None,
        source: str | None = None,
        priority: str | None = None,
        business_type: str | None = None,
        allotted_to: str | None = None,
        created_by: str | None = None,
        status: str | None = None,
        city: str | None = None,
        district: str | None = None,
        state: str | None = None,
        call_type: str | None = None,
        company_name: str | None = None,
        date_from: Any | None = None,
        date_to: Any | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Lead], int]:
        return await self.repository.list_leads(
            search=search,
            source=source,
            priority=priority,
            business_type=business_type,
            allotted_to=allotted_to,
            created_by=created_by,
            status=status,
            city=city,
            district=district,
            state=state,
            call_type=call_type,
            company_name=company_name,
            date_from=date_from,
            date_to=date_to,
            sort_by=sort_by,
            sort_dir=sort_dir,
            limit=limit,
            offset=offset,
        )

    async def get_by_id(self, lead_id: uuid.UUID) -> Lead:
        lead = await self.repository.get_by_id(lead_id)
        if not lead:
            raise NotFoundException(f"Lead {lead_id} not found.")
        return lead

    async def create(self, payload: LeadCreate) -> Lead:
        data = payload.model_dump()
        if not data.get("added_on"):
            data["added_on"] = date.today()
        lead = await self.repository.create(**data)
        return lead

    async def update(self, lead_id: uuid.UUID, payload: LeadUpdate) -> Lead:
        lead = await self.get_by_id(lead_id)
        updates = payload.model_dump(exclude_unset=True)
        if updates:
            lead = await self.repository.update(lead, **updates)
        return lead

    async def delete(self, lead_id: uuid.UUID) -> None:
        lead = await self.get_by_id(lead_id)
        await self.repository.soft_delete(lead)

    async def bulk_delete(self, ids: list[uuid.UUID]) -> int:
        return await self.repository.bulk_soft_delete(ids)
