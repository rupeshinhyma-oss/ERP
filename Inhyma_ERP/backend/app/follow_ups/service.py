"""
FollowUp Service.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from app.core.exceptions import NotFoundException
from app.follow_ups.models import FollowUp
from app.follow_ups.repository import FollowUpRepository
from app.follow_ups.schemas import FollowUpCreate, FollowUpUpdate


class FollowUpService:
    """Service layer for FollowUp operations."""

    def __init__(self, repository: FollowUpRepository) -> None:
        self.repository = repository

    async def list_follow_ups(
        self,
        *,
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
        added_date: Any | None = None,
        date_from: Any | None = None,
        date_to: Any | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[FollowUp], int]:
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
            added_date=added_date,
            date_from=date_from,
            date_to=date_to,
            sort_by=sort_by,
            sort_dir=sort_dir,
            limit=limit,
            offset=offset,
        )

    async def get_by_id(self, item_id: uuid.UUID) -> FollowUp:
        item = await self.repository.get_by_id(item_id)
        if not item:
            raise NotFoundException(f"Follow-up log {item_id} not found.")
        return item

    async def create(self, payload: FollowUpCreate) -> FollowUp:
        data = payload.model_dump()
        if not data.get("added_on"):
            data["added_on"] = date.today()
        item = await self.repository.create(**data)
        return item

    async def update(self, item_id: uuid.UUID, payload: FollowUpUpdate) -> FollowUp:
        item = await self.get_by_id(item_id)
        updates = payload.model_dump(exclude_unset=True)
        if updates:
            item = await self.repository.update(item, **updates)
        return item

    async def delete(self, item_id: uuid.UUID) -> None:
        item = await self.get_by_id(item_id)
        await self.repository.soft_delete(item)

    async def bulk_delete(self, ids: list[uuid.UUID]) -> int:
        return await self.repository.bulk_soft_delete(ids)
