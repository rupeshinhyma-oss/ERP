"""Bank Repository layer."""

from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.banks.models import Bank


class BankRepository(BaseRepository[Bank]):
    """Repository handling database operations for Bank."""

    model = Bank
    searchable_fields = ("bank_name", "account_number", "account_holder_name", "ifsc_code", "branch")
    sortable_fields = ("created_at", "updated_at", "bank_name", "account_number", "account_holder_name", "status")
    filterable_fields = ("status", "bank_name", "branch")

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``Bank`` model."""
        super().__init__(session, Bank)

    async def get_by_account_number(self, account_number: str) -> Bank | None:
        """Find an active or non-deleted bank by account number."""
        stmt = (
            select(Bank)
            .where(Bank.account_number == account_number, Bank.deleted_at.is_(None))
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def list_all(self) -> list[Bank]:
        """Return every non-deleted bank, ordered by bank_name."""
        stmt = self._base_select().order_by(Bank.bank_name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

