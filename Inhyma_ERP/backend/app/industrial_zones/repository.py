"""
Industrial Zone Repository.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.industrial_zones.models import IndustrialZone


class IndustrialZoneRepository(BaseRepository[IndustrialZone]):
    """Repository for IndustrialZone entities."""

    searchable_fields = (
        "zone_name",
        "state",
        "district",
        "nearby_city",
        "zone_grade",
        "industry_types",
        "potential_machine_categories",
        "remarks",
    )
    sortable_fields = ("zone_name", "state", "district", "nearby_city", "num_industries", "zone_grade", "created_at")

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, IndustrialZone)

    async def list_zones(
        self,
        *,
        search: str | None = None,
        grade: str | None = None,
        state: str | None = None,
        district: str | None = None,
        city: str | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[IndustrialZone], int]:
        """Query industrial zones with filtering, sorting, and pagination."""
        stmt = self._base_select()

        if grade and grade.strip() and grade.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(IndustrialZone.zone_grade) == grade.strip().lower())
        if state and state.strip() and state.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(IndustrialZone.state) == state.strip().lower())
        if district and district.strip() and district.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(IndustrialZone.district) == district.strip().lower())
        if city and city.strip() and city.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(IndustrialZone.nearby_city) == city.strip().lower())

        if search and search.strip():
            term = f"%{search.strip().lower()}%"
            stmt = stmt.where(
                or_(
                    func.lower(IndustrialZone.zone_name).like(term),
                    func.lower(IndustrialZone.nearby_city).like(term),
                    func.lower(IndustrialZone.district).like(term),
                    func.lower(IndustrialZone.state).like(term),
                    func.lower(IndustrialZone.potential_machine_categories).like(term),
                    func.lower(IndustrialZone.industry_types).like(term),
                )
            )

        # Count total
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_res = await self.session.execute(count_stmt)
        total = total_res.scalar_one()

        # Sorting
        sort_col = getattr(IndustrialZone, sort_by, IndustrialZone.created_at)
        if sort_dir.lower() == "asc":
            stmt = stmt.order_by(sort_col.asc())
        else:
            stmt = stmt.order_by(sort_col.desc())

        stmt = stmt.offset(offset).limit(limit)
        result = await self.session.execute(stmt)
        items = list(result.scalars().all())
        return items, total

    async def get_by_name(self, name: str, exclude_id: uuid.UUID | None = None) -> IndustrialZone | None:
        """Find an industrial zone by case-insensitive name."""
        stmt = self._base_select().where(func.lower(IndustrialZone.zone_name) == name.strip().lower())
        if exclude_id:
            stmt = stmt.where(IndustrialZone.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalars().first()
