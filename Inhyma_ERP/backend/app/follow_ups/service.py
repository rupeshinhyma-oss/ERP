"""
FollowUp Service.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from app.auth.service import CurrentUser
from app.core.exceptions import ForbiddenException, NotFoundException
from app.follow_ups.models import FollowUp
from app.follow_ups.repository import FollowUpRepository
from app.follow_ups.schemas import FollowUpCreate, FollowUpUpdate


class FollowUpService:
    """Service layer for FollowUp operations."""

    def __init__(self, repository: FollowUpRepository) -> None:
        self.repository = repository

    def _is_manager_or_admin(self, actor: CurrentUser | None) -> bool:
        if actor is None:
            return True
        if actor.is_admin or actor.is_super_admin or actor.username == "admin" or "*" in actor.permissions:
            return True
        if "crm.leads.manage" in actor.permissions or "leads.manage" in actor.permissions:
            return True
        return False

    def _can_access_follow_up(self, item: FollowUp, actor: CurrentUser | None) -> bool:
        if self._is_manager_or_admin(actor) or actor is None:
            return True
        actor_names = {actor.username.lower(), str(actor.id).lower()}
        person = (item.marketing_person or "").lower()
        return person in actor_names

    async def list_follow_ups(
        self,
        *,
        actor: CurrentUser | None = None,
        search: str | None = None,
        call_type: str | None = None,
        marketing_person: str | None = None,
        business_type: str | None = None,
        state: str | None = None,
        district: str | None = None,
        city: str | None = None,
        current_status: str | None = None,
        category: str | None = None,
        client_grade: str | None = None,
        potential_type: str | None = None,
        business_category: str | None = None,
        company_name: str | None = None,
        call_category: str | None = None,
        direct_import_from_china: str | None = None,
        monthly_import_volume: str | None = None,
        lead_status: str | None = None,
        entry_source: str | None = None,
        added_date: Any | None = None,
        date_from: Any | None = None,
        date_to: Any | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[FollowUp], int]:
        if actor is not None and not self._is_manager_or_admin(actor):
            if marketing_person and marketing_person.strip().lower() not in {actor.username.lower(), str(actor.id).lower()}:
                raise ForbiddenException("Users can only query their own follow-ups.")
            marketing_person = actor.username

        return await self.repository.list_follow_ups(
            search=search,
            call_type=call_type,
            marketing_person=marketing_person,
            business_type=business_type,
            state=state,
            district=district,
            city=city,
            current_status=current_status,
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
            limit=limit,
            offset=offset,
        )

    async def get_by_id(self, item_id: uuid.UUID, *, actor: CurrentUser | None = None) -> FollowUp:
        item = await self.repository.get_by_id(item_id)
        if not item:
            raise NotFoundException(f"Follow-up log {item_id} not found.")
        if not self._can_access_follow_up(item, actor):
            raise ForbiddenException("You do not have permission to view this follow-up log.")
        return item

    async def create(self, payload: FollowUpCreate, *, actor: CurrentUser | None = None) -> FollowUp:
        data = payload.model_dump()
        if not data.get("added_on"):
            data["added_on"] = date.today()
        if actor is not None and not data.get("marketing_person"):
            data["marketing_person"] = actor.username
        item = await self.repository.create(**data)
        return item

    async def update(self, item_id: uuid.UUID, payload: FollowUpUpdate, *, actor: CurrentUser | None = None) -> FollowUp:
        item = await self.get_by_id(item_id, actor=actor)
        if not self._can_access_follow_up(item, actor):
            raise ForbiddenException("You do not have permission to update this follow-up log.")
        updates = payload.model_dump(exclude_unset=True)
        if updates:
            item = await self.repository.update(item, **updates)
        return item

    async def delete(self, item_id: uuid.UUID, *, actor: CurrentUser | None = None) -> None:
        item = await self.get_by_id(item_id, actor=actor)
        if not self._can_access_follow_up(item, actor):
            raise ForbiddenException("You do not have permission to delete this follow-up log.")
        await self.repository.soft_delete(item)

    async def bulk_delete(self, ids: list[uuid.UUID], *, actor: CurrentUser | None = None) -> int:
        if not ids:
            return 0
        for item_id in ids:
            item = await self.repository.get_by_id(item_id)
            if not item:
                raise NotFoundException(f"Follow-up log {item_id} not found.")
            if not self._can_access_follow_up(item, actor):
                raise ForbiddenException("You do not have permission to delete one or more selected follow-up logs.")
        return await self.repository.bulk_soft_delete(ids)
