"""PaymentMode Repository."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.core.constants import RecordStatus
from app.masters.payment_modes.models import PaymentMode


class PaymentModeRepository(BaseRepository[PaymentMode]):
    """Repository for payment_mode rows."""

    searchable_fields = ("name", "code", "account_type", "currency_code")
    sortable_fields = ("name", "code", "account_type", "currency_code", "created_at", "updated_at")
    filterable_fields = ("status",)

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session."""
        super().__init__(session, PaymentMode)

    async def get_by_code(self, code: str) -> PaymentMode | None:
        """Fetch a payment mode by its code."""
        stmt = self._base_select().where(PaymentMode.code == code)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def code_exists(self, code: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Check if code exists."""
        stmt = self._base_select().with_only_columns(PaymentMode.id).where(PaymentMode.code == code)
        if exclude_id is not None:
            stmt = stmt.where(PaymentMode.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def get_by_name(self, name: str, *, exclude_id: uuid.UUID | None = None) -> PaymentMode | None:
        """Fetch by name."""
        stmt = self._base_select().where(PaymentMode.name == name)
        if exclude_id is not None:
            stmt = stmt.where(PaymentMode.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_all(self, *, active_only: bool = True) -> list[PaymentMode]:
        """Return all payment modes, optionally filtering to active only, ordered by name."""
        stmt = self._base_select()
        if active_only:
            stmt = stmt.where(PaymentMode.status == RecordStatus.ACTIVE)
        stmt = stmt.order_by(PaymentMode.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
