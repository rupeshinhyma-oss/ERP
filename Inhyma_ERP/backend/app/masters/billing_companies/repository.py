"""Billing Company Repository."""

from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.billing_companies.models import BillingCompany


class BillingCompanyRepository(BaseRepository[BillingCompany]):
    """Repository for billing company master rows."""

    searchable_fields = ("name", "email", "mobile", "city", "gst_no", "pan_no", "bank_name")
    sortable_fields = ("name", "email", "city", "status", "created_at", "updated_at")
    filterable_fields = ("status", "city", "bank_name")

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``BillingCompany`` model."""
        super().__init__(session, BillingCompany)

    async def get_by_name(self, name: str) -> BillingCompany | None:
        """Fetch a billing company by unique name."""
        stmt = select(BillingCompany).where(
            BillingCompany.deleted_at.is_(None),
            BillingCompany.name == name,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def name_exists(self, name: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Return True if another active/non-deleted billing company uses this name."""
        stmt = select(BillingCompany.id).where(
            BillingCompany.deleted_at.is_(None),
            BillingCompany.name == name,
        )
        if exclude_id is not None:
            stmt = stmt.where(BillingCompany.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None
