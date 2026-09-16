"""
Local Purchase Repository.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy import Select, and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.common.base_repository import BaseRepository
from app.purchases.local.models import LocalPurchase, LocalPurchaseItem


class LocalPurchaseRepository(BaseRepository[LocalPurchase]):
    """Repository for local purchase orders and vendor invoices."""

    searchable_fields = (
        "invoice_no",
        "supplier_name",
        "organization_name",
        "branch_name",
        "remarks",
    )
    sortable_fields = (
        "invoice_date",
        "invoice_no",
        "supplier_name",
        "invoice_total_value",
        "created_at",
        "status",
    )
    filterable_fields = (
        "status",
        "organization_id",
        "branch_id",
        "supplier_id",
        "currency",
    )

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, LocalPurchase)

    async def get_with_items(self, purchase_id: uuid.UUID) -> LocalPurchase | None:
        """Fetch a single local purchase with its line items eagerly loaded."""
        stmt = (
            select(LocalPurchase)
            .options(selectinload(LocalPurchase.items))
            .where(
                LocalPurchase.id == purchase_id,
                LocalPurchase.deleted_at.is_(None),
            )
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_with_filters(
        self,
        *,
        search: str | None = None,
        organization_id: uuid.UUID | None = None,
        branch_id: str | None = None,
        supplier_id: uuid.UUID | None = None,
        status: str | None = None,
        currency: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[LocalPurchase], int]:
        """List local purchases with flexible filtering and total count."""
        base_conditions: list[Any] = [LocalPurchase.deleted_at.is_(None)]

        if organization_id:
            base_conditions.append(LocalPurchase.organization_id == organization_id)
        if branch_id:
            base_conditions.append(LocalPurchase.branch_id == branch_id)
        if supplier_id:
            base_conditions.append(LocalPurchase.supplier_id == supplier_id)
        if status:
            base_conditions.append(LocalPurchase.status == status)
        if currency:
            base_conditions.append(LocalPurchase.currency == currency)
        if date_from:
            base_conditions.append(LocalPurchase.invoice_date >= date_from)
        if date_to:
            base_conditions.append(LocalPurchase.invoice_date <= date_to)

        if search and search.strip():
            term = f"%{search.strip()}%"
            search_clause = or_(
                LocalPurchase.invoice_no.ilike(term),
                LocalPurchase.supplier_name.ilike(term),
                LocalPurchase.organization_name.ilike(term),
                LocalPurchase.branch_name.ilike(term),
                LocalPurchase.remarks.ilike(term),
            )
            base_conditions.append(search_clause)

        where_clause = and_(*base_conditions)

        # Count query
        count_stmt = select(func.count(LocalPurchase.id)).where(where_clause)
        total_count = (await self.session.execute(count_stmt)).scalar() or 0

        # Data query with items loaded for line-item count
        data_stmt = (
            select(LocalPurchase)
            .options(selectinload(LocalPurchase.items))
            .where(where_clause)
            .order_by(desc(LocalPurchase.created_at))
            .offset(offset)
            .limit(limit)
        )
        records = list((await self.session.execute(data_stmt)).scalars().all())

        return records, total_count

    async def create_purchase(
        self,
        purchase: LocalPurchase,
        items: list[LocalPurchaseItem],
    ) -> LocalPurchase:
        """Create a local purchase record along with its line items."""
        self.session.add(purchase)
        await self.session.flush()

        for item in items:
            item.purchase_id = purchase.id
            self.session.add(item)

        await self.session.flush()
        return await self.get_with_items(purchase.id)  # type: ignore[return-value]

    async def update_purchase(
        self,
        purchase: LocalPurchase,
        items: list[LocalPurchaseItem] | None = None,
    ) -> LocalPurchase:
        """Update purchase details and optionally replace line items."""
        await self.session.flush()

        if items is not None:
            # Delete old items
            stmt = select(LocalPurchaseItem).where(LocalPurchaseItem.purchase_id == purchase.id)
            existing_items = (await self.session.execute(stmt)).scalars().all()
            for old_item in existing_items:
                await self.session.delete(old_item)
            await self.session.flush()

            # Insert new items
            for item in items:
                item.purchase_id = purchase.id
                self.session.add(item)
            await self.session.flush()

        return await self.get_with_items(purchase.id)  # type: ignore[return-value]
