"""
Lead Repository.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.leads.models import Lead


class LeadRepository(BaseRepository[Lead]):
    """Repository for Lead entities."""

    searchable_fields = (
        "company_name",
        "business_type",
        "source",
        "contact_person",
        "contact_phone",
        "contact_email",
        "priority",
        "area",
        "city",
        "district",
        "state",
        "requirements",
        "allotted_to",
        "lead_status",
    )
    sortable_fields = ("company_name", "priority", "added_on", "created_at", "city", "lead_status")
    filterable_fields = ("business_type", "source", "priority", "city", "state", "allotted_to", "lead_status")

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, Lead)

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
        date_from: Any | None = None,
        date_to: Any | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Lead], int]:
        """Query leads with full text search, field filtering, sorting, and pagination."""
        stmt = self._base_select()

        # Specific filters
        if source and source.strip():
            stmt = stmt.where(func.lower(Lead.source) == source.strip().lower())
        if priority and priority.strip():
            stmt = stmt.where(func.lower(Lead.priority) == priority.strip().lower())
        if business_type and business_type.strip():
            stmt = stmt.where(func.lower(Lead.business_type) == business_type.strip().lower())
        if allotted_to and allotted_to.strip():
            stmt = stmt.where(func.lower(Lead.allotted_to) == allotted_to.strip().lower())
        if created_by and created_by.strip():
            stmt = stmt.where(func.lower(Lead.created_by) == created_by.strip().lower())
        if status and status.strip():
            stmt = stmt.where(func.lower(Lead.lead_status) == status.strip().lower())
        if district and district.strip():
            stmt = stmt.where(func.lower(Lead.district) == district.strip().lower())
        if city and city.strip():
            stmt = stmt.where(func.lower(Lead.city) == city.strip().lower())
        if state and state.strip():
            stmt = stmt.where(func.lower(Lead.state) == state.strip().lower())
        if date_from:
            stmt = stmt.where(Lead.added_on >= date_from)
        if date_to:
            stmt = stmt.where(Lead.added_on <= date_to)

        # Full-text search
        if search and search.strip():
            term = f"%{search.strip()}%"
            stmt = stmt.where(
                or_(
                    Lead.company_name.ilike(term),
                    Lead.contact_person.ilike(term),
                    Lead.contact_phone.ilike(term),
                    Lead.contact_email.ilike(term),
                    Lead.area.ilike(term),
                    Lead.city.ilike(term),
                    Lead.district.ilike(term),
                    Lead.state.ilike(term),
                    Lead.requirements.ilike(term),
                    Lead.source.ilike(term),
                    Lead.allotted_to.ilike(term),
                )
            )

        # Count total matches
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await self.session.execute(count_stmt)).scalar() or 0

        # Sorting
        sort_column = getattr(Lead, sort_by, Lead.created_at)
        if sort_dir.lower() == "asc":
            stmt = stmt.order_by(sort_column.asc())
        else:
            stmt = stmt.order_by(sort_column.desc())

        # Pagination
        stmt = stmt.limit(limit).offset(offset)

        result = await self.session.execute(stmt)
        items = list(result.scalars().all())
        return items, total

    async def bulk_soft_delete(self, ids: list[uuid.UUID]) -> int:
        """Soft-delete multiple lead records in a single query."""
        now = datetime.now(timezone.utc)
        stmt = select(Lead).where(Lead.id.in_(ids), Lead.deleted_at.is_(None))
        result = await self.session.execute(stmt)
        leads = list(result.scalars().all())
        for lead in leads:
            lead.deleted_at = now
        await self.session.flush()
        return len(leads)
