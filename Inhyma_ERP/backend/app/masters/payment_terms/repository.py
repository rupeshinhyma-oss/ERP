"""Payment Term Repository layer."""

from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.payment_terms.models import PaymentTerm


class PaymentTermRepository(BaseRepository[PaymentTerm]):
    """Repository handling database operations for PaymentTerm."""

    model = PaymentTerm
    searchable_fields = ("name",)
    sortable_fields = ("created_at", "updated_at", "name", "status")
    filterable_fields = ("status", "name")

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``PaymentTerm`` model."""
        super().__init__(session, PaymentTerm)

    async def get_by_name(self, name: str) -> PaymentTerm | None:
        """Find an active or non-deleted payment term by exact name."""
        stmt = (
            select(PaymentTerm)
            .where(PaymentTerm.name == name, PaymentTerm.deleted_at.is_(None))
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def name_exists(self, name: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Return True if another active/non-deleted payment term uses this name."""
        stmt = select(PaymentTerm.id).where(
            PaymentTerm.deleted_at.is_(None),
            PaymentTerm.name == name,
        )
        if exclude_id is not None:
            stmt = stmt.where(PaymentTerm.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def list_all(self) -> list[PaymentTerm]:
        """Return every non-deleted payment term, ordered by name."""
        stmt = self._base_select().order_by(PaymentTerm.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
