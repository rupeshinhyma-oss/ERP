"""
Technical Task Service.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from app.core.exceptions import NotFoundException
from app.technical_tasks.models import TechnicalTask
from app.technical_tasks.repository import TechnicalTaskRepository
from app.technical_tasks.schemas import TechnicalTaskCreate, TechnicalTaskStatusUpdate, TechnicalTaskUpdate


class TechnicalTaskService:
    """Business logic for TechnicalTask lifecycle."""

    def __init__(self, repository: TechnicalTaskRepository) -> None:
        self.repository = repository

    async def get_by_id(self, task_id: uuid.UUID) -> TechnicalTask:
        task = await self.repository.get_by_id(task_id)
        if not task:
            raise NotFoundException(f"Technical task {task_id} not found.")
        return task

    async def get_counts(self) -> dict[str, int]:
        return await self.repository.get_counts()

    async def list_tasks(
        self,
        *,
        tab: str | None = None,
        search: str | None = None,
        city: str | None = None,
        task_type: str | None = None,
        call_type: str | None = None,
        service_type: str | None = None,
        priority: str | None = None,
        technician: str | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[TechnicalTask], int]:
        return await self.repository.list_tasks(
            tab=tab,
            search=search,
            city=city,
            task_type=task_type,
            call_type=call_type,
            service_type=service_type,
            priority=priority,
            technician=technician,
            sort_by=sort_by,
            sort_dir=sort_dir,
            limit=limit,
            offset=offset,
        )

    async def create(self, payload: TechnicalTaskCreate, creator_name: str = "Admin") -> TechnicalTask:
        data = payload.model_dump()
        if not data.get("created_by_name"):
            data["created_by_name"] = creator_name
        if not data.get("task_created_date"):
            data["task_created_date"] = date.today()

        return await self.repository.create(**data)

    async def update(self, task_id: uuid.UUID, payload: TechnicalTaskUpdate) -> TechnicalTask:
        task = await self.get_by_id(task_id)
        updates = payload.model_dump(exclude_unset=True)
        return await self.repository.update(task, **updates)

    async def update_status(
        self, task_id: uuid.UUID, payload: TechnicalTaskStatusUpdate, user_name: str | None = None
    ) -> TechnicalTask:
        task = await self.get_by_id(task_id)
        new_status = payload.status.capitalize()

        updates: dict = {"status": new_status}
        if payload.task_allotted_to:
            updates["task_allotted_to"] = payload.task_allotted_to

        if new_status == "Approved":
            updates["task_approved_by"] = payload.task_approved_by or user_name or "Manager"
            updates["task_approved_date"] = payload.task_approved_date or date.today()
        elif new_status == "Completed":
            updates["completed_date"] = payload.completed_date or date.today()
        elif new_status == "Cancel":
            pass

        return await self.repository.update(task, **updates)

    async def delete(self, task_id: uuid.UUID) -> None:
        task = await self.get_by_id(task_id)
        await self.repository.delete(task)

    async def bulk_delete(self, ids: list[uuid.UUID]) -> int:
        return await self.repository.bulk_soft_delete(ids)
