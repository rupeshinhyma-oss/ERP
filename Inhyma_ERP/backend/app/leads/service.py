"""
Lead Service.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from app.auth.service import CurrentUser
from app.core.exceptions import BadRequestException, ForbiddenException, NotFoundException
from app.leads.models import Lead
from app.leads.repository import LeadRepository
from app.leads.schemas import LeadCreate, LeadUpdate


class LeadService:
    """Service layer for Lead operations."""

    def __init__(self, repository: LeadRepository) -> None:
        self.repository = repository

    def _is_manager_or_admin(self, actor: CurrentUser | None) -> bool:
        if actor is None:
            return True
        if actor.is_admin or actor.is_super_admin or actor.username == "admin" or "*" in actor.permissions:
            return True
        if "crm.leads.manage" in actor.permissions or "leads.manage" in actor.permissions:
            return True
        return False

    def _can_access_lead(self, lead: Lead, actor: CurrentUser | None) -> bool:
        if self._is_manager_or_admin(actor) or actor is None:
            return True
        actor_names = {actor.username.lower(), str(actor.id).lower()}
        allotted = (lead.allotted_to or "").lower()
        creator = (lead.created_by or "").lower()
        return allotted in actor_names or creator in actor_names

    async def list_leads(
        self,
        *,
        actor: CurrentUser | None = None,
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
        if actor is not None and not self._is_manager_or_admin(actor):
            if allotted_to and allotted_to.strip().lower() not in {actor.username.lower(), str(actor.id).lower()}:
                raise ForbiddenException("Salespeople can only query their own leads.")
            allotted_to = actor.username

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

    async def get_by_id(self, lead_id: uuid.UUID, *, actor: CurrentUser | None = None) -> Lead:
        lead = await self.repository.get_by_id(lead_id)
        if not lead:
            raise NotFoundException(f"Lead {lead_id} not found.")
        if not self._can_access_lead(lead, actor):
            raise ForbiddenException("You do not have permission to view this lead.")
        return lead

    async def create(self, payload: LeadCreate, *, actor: CurrentUser | None = None) -> Lead:
        data = payload.model_dump()
        if not data.get("added_on"):
            data["added_on"] = date.today()
        if actor is not None:
            if not data.get("created_by"):
                data["created_by"] = actor.username
            if not self._is_manager_or_admin(actor):
                if not data.get("allotted_to"):
                    data["allotted_to"] = actor.username
        lead = await self.repository.create(**data)
        return lead

    async def update(self, lead_id: uuid.UUID, payload: LeadUpdate, *, actor: CurrentUser | None = None) -> Lead:
        lead = await self.get_by_id(lead_id, actor=actor)
        if not self._can_access_lead(lead, actor):
            raise ForbiddenException("You do not have permission to update this lead.")
        updates = payload.model_dump(exclude_unset=True)
        if updates:
            lead = await self.repository.update(lead, **updates)
        return lead

    async def allot_lead(self, lead_id: uuid.UUID, allotted_to: str, *, actor: CurrentUser | None = None) -> Lead:
        if actor is not None and not self._is_manager_or_admin(actor):
            raise ForbiddenException("Only managers and administrators can allot leads.")
        if not allotted_to or not allotted_to.strip():
            raise BadRequestException("Target assignee cannot be empty.")
        lead = await self.get_by_id(lead_id, actor=actor)
        return await self.repository.allot_lead(lead, allotted_to.strip())

    async def delete(self, lead_id: uuid.UUID, *, actor: CurrentUser | None = None) -> None:
        lead = await self.get_by_id(lead_id, actor=actor)
        if not self._can_access_lead(lead, actor):
            raise ForbiddenException("You do not have permission to delete this lead.")
        await self.repository.soft_delete(lead)

    async def bulk_delete(self, ids: list[uuid.UUID], *, actor: CurrentUser | None = None) -> int:
        if not ids:
            return 0
        # Authorize every requested record before performing mutations
        for lead_id in ids:
            lead = await self.repository.get_by_id(lead_id)
            if not lead:
                raise NotFoundException(f"Lead {lead_id} not found.")
            if not self._can_access_lead(lead, actor):
                raise ForbiddenException("You do not have permission to delete one or more selected leads.")
        return await self.repository.bulk_soft_delete(ids)
