"""
Technical Task Repository.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.technical_tasks.models import TechnicalTask


class TechnicalTaskRepository(BaseRepository[TechnicalTask]):
    """Repository for TechnicalTask entities."""

    searchable_fields = (
        "company_name",
        "city",
        "third_party",
        "machine_model",
        "task_description",
        "contact_person_name",
        "contact_phone",
        "task_allotted_to",
        "task_approved_by",
        "created_by_name",
    )
    sortable_fields = ("company_name", "city", "priority", "status", "created_at", "task_created_date")
    filterable_fields = ("task_type", "city", "priority", "service_type", "call_type", "task_allotted_to", "status")

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, TechnicalTask)

    async def get_counts(self) -> dict[str, int]:
        """Return counts for all lifecycle tabs: all, pending, approved, completed, cancel."""
        base = self._base_select()
        # Count total active
        total_stmt = select(func.count()).select_from(base.subquery())
        total = (await self.session.execute(total_stmt)).scalar() or 0

        # Count per status
        status_stmt = (
            select(func.lower(TechnicalTask.status), func.count(TechnicalTask.id))
            .where(TechnicalTask.deleted_at.is_(None))
            .group_by(func.lower(TechnicalTask.status))
        )
        res = (await self.session.execute(status_stmt)).all()
        counts_map = {row[0]: row[1] for row in res}

        return {
            "all": total,
            "pending": counts_map.get("pending", 0),
            "approved": counts_map.get("approved", 0),
            "completed": counts_map.get("completed", 0),
            "cancel": counts_map.get("cancel", 0),
        }

    async def list_tasks(
        self,
        *,
        tab: str | None = None,
        search: str | None = None,
        city: str | None = None,
        task_type: str | None = None,
        call_type: str | None = None,
        technician: str | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[TechnicalTask], int]:
        """Fetch filtered and paginated technical tasks with total matching count."""
        stmt = self._base_select()

        # Filter by tab
        if tab and tab.lower() != "all":
            stmt = stmt.where(func.lower(TechnicalTask.status) == tab.strip().lower())

        # Exact filters
        if city:
            stmt = stmt.where(TechnicalTask.city.ilike(f"%{city.strip()}%"))
        if task_type:
            stmt = stmt.where(TechnicalTask.task_type.ilike(f"%{task_type.strip()}%"))
        if call_type:
            stmt = stmt.where(TechnicalTask.call_type.ilike(f"%{call_type.strip()}%"))
        if technician:
            stmt = stmt.where(TechnicalTask.task_allotted_to.ilike(f"%{technician.strip()}%"))

        # Search across searchable fields
        if search and search.strip():
            clean_s = f"%{search.strip()}%"
            conds = [
                TechnicalTask.company_name.ilike(clean_s),
                TechnicalTask.city.ilike(clean_s),
                TechnicalTask.machine_model.ilike(clean_s),
                TechnicalTask.contact_person_name.ilike(clean_s),
                TechnicalTask.contact_phone.ilike(clean_s),
                TechnicalTask.task_description.ilike(clean_s),
                TechnicalTask.task_allotted_to.ilike(clean_s),
                TechnicalTask.task_approved_by.ilike(clean_s),
                TechnicalTask.created_by_name.ilike(clean_s),
            ]
            stmt = stmt.where(or_(*conds))

        # Count total matching query
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await self.session.execute(count_stmt)).scalar() or 0

        # Sorting
        sort_col = getattr(TechnicalTask, sort_by, TechnicalTask.created_at)
        if sort_dir.lower() == "asc":
            stmt = stmt.order_by(sort_col.asc())
        else:
            stmt = stmt.order_by(sort_col.desc())

        # Pagination
        stmt = stmt.offset(offset).limit(limit)
        items = list((await self.session.execute(stmt)).scalars().all())

        return items, total

    async def bulk_soft_delete(self, ids: list[uuid.UUID]) -> int:
        """Soft-delete all tasks in ids list."""
        if not ids:
            return 0
        now = datetime.now(timezone.utc)
        stmt = (
            select(TechnicalTask)
            .where(TechnicalTask.id.in_(ids), TechnicalTask.deleted_at.is_(None))
        )
        tasks = list((await self.session.execute(stmt)).scalars().all())
        for t in tasks:
            t.deleted_at = now
        await self.session.flush()
        return len(tasks)
