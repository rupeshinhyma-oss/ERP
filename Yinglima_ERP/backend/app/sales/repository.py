"""
Sale Process Repository.

Encapsulates database access for Sale Orders and items, auto-numbering,
dynamic filtering, and KPI aggregations.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.sales.models import SaleOrder, SaleOrderItem
from app.sales.schemas import MetricItem, SaleSummaryMetrics


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SaleRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def generate_order_no(self, order_date: date) -> str:
        """
        Generate sequential order numbers matching SO-YLM/YY-YY/XXXX.
        Financial year rollover: April 1 - March 31.
        """
        year = order_date.year
        month = order_date.month
        if month >= 4:
            start_yr = year % 100
            end_yr = (year + 1) % 100
        else:
            start_yr = (year - 1) % 100
            end_yr = year % 100

        prefix = f"SO-YLM/{start_yr:02d}-{end_yr:02d}/"

        q = select(func.count(SaleOrder.id)).where(
            SaleOrder.order_no.like(f"{prefix}%")
        )
        res = await self.session.execute(q)
        count = (res.scalar() or 0) + 1
        return f"{prefix}{count:04d}"

    async def get_by_id(self, order_id: uuid.UUID) -> SaleOrder | None:
        q = (
            select(SaleOrder)
            .where(
                SaleOrder.id == order_id,
                SaleOrder.deleted_at.is_(None),
            )
            .options(selectinload(SaleOrder.items))
        )
        res = await self.session.execute(q)
        return res.scalar_one_or_none()

    async def list_with_filters(
        self,
        *,
        search: str | None = None,
        organization_id: uuid.UUID | None = None,
        buyer_id: uuid.UUID | None = None,
        buyer_branch_id: str | None = None,
        status: str | None = None,
        currency: str | None = None,
        consignment_code: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[SaleOrder], int]:
        conditions: list[Any] = [SaleOrder.deleted_at.is_(None)]

        if organization_id:
            conditions.append(SaleOrder.organization_id == organization_id)
        if buyer_id:
            conditions.append(SaleOrder.buyer_id == buyer_id)
        if buyer_branch_id:
            conditions.append(SaleOrder.buyer_branch_id == buyer_branch_id)
        if currency:
            conditions.append(SaleOrder.currency == currency)
        if status and status.strip().lower() != "all":
            conditions.append(SaleOrder.status == status.strip().lower())
        if consignment_code:
            conditions.append(SaleOrder.consignment_code.ilike(f"%{consignment_code.strip()}%"))
        if date_from:
            conditions.append(SaleOrder.order_date >= date_from)
        if date_to:
            conditions.append(SaleOrder.order_date <= date_to)

        if search and search.strip():
            clean_search = f"%{search.strip()}%"
            conditions.append(
                or_(
                    SaleOrder.order_no.ilike(clean_search),
                    SaleOrder.buyer_name.ilike(clean_search),
                    SaleOrder.consignment_code.ilike(clean_search),
                    SaleOrder.container_no.ilike(clean_search),
                    SaleOrder.bl_no.ilike(clean_search),
                    SaleOrder.lr_no.ilike(clean_search),
                )
            )

        count_query = select(func.count(SaleOrder.id)).where(and_(*conditions))
        total_count = (await self.session.execute(count_query)).scalar() or 0

        query = (
            select(SaleOrder)
            .where(and_(*conditions))
            .options(selectinload(SaleOrder.items))
            .order_by(SaleOrder.order_date.desc(), SaleOrder.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await self.session.execute(query)
        records = list(result.scalars().all())

        return records, total_count

    async def get_metrics(
        self,
        *,
        organization_id: uuid.UUID | None = None,
        buyer_id: uuid.UUID | None = None,
        currency: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> SaleSummaryMetrics:
        """Compute aggregate metrics for top KPI cards."""
        conditions: list[Any] = [SaleOrder.deleted_at.is_(None)]
        if organization_id:
            conditions.append(SaleOrder.organization_id == organization_id)
        if buyer_id:
            conditions.append(SaleOrder.buyer_id == buyer_id)
        if currency:
            conditions.append(SaleOrder.currency == currency)
        if date_from:
            conditions.append(SaleOrder.order_date >= date_from)
        if date_to:
            conditions.append(SaleOrder.order_date <= date_to)

        q = (
            select(
                SaleOrder.status,
                func.count(SaleOrder.id).label("count"),
                func.coalesce(func.sum(SaleOrder.total_amount), 0.0).label("amount"),
            )
            .where(and_(*conditions))
            .group_by(SaleOrder.status)
        )
        result = await self.session.execute(q)
        rows = result.all()

        metrics = SaleSummaryMetrics()
        all_count = 0
        all_amount = 0.0

        for r in rows:
            st = str(r[0]).lower().strip()
            cnt = int(r[1])
            amt = float(r[2])

            all_count += cnt
            all_amount += amt

            if st == "pending":
                metrics.pending = MetricItem(count=cnt, amount=amt)
            elif st == "sales_confirmed":
                metrics.sales_confirmed = MetricItem(count=cnt, amount=amt)
            elif st == "admin_approved":
                metrics.admin_approved = MetricItem(count=cnt, amount=amt)
            elif st == "dispatched":
                metrics.dispatched = MetricItem(count=cnt, amount=amt)
            elif st == "lr":
                metrics.lr = MetricItem(count=cnt, amount=amt)
            elif st == "cancelled":
                metrics.cancelled = MetricItem(count=cnt, amount=amt)

        metrics.all = MetricItem(count=all_count, amount=round(all_amount, 2))
        return metrics

    async def create(self, order: SaleOrder) -> SaleOrder:
        self.session.add(order)
        await self.session.flush()
        await self.session.refresh(order, ["items"])
        return order

    async def update(self, order: SaleOrder) -> SaleOrder:
        order.updated_at = _utcnow()
        await self.session.flush()
        await self.session.refresh(order, ["items"])
        return order

    async def soft_delete(self, order_or_id: SaleOrder | uuid.UUID, deleted_by: str | None = None) -> bool:
        if isinstance(order_or_id, uuid.UUID):
            order = await self.get_by_id(order_or_id)
            if not order:
                return False
        else:
            order = order_or_id

        order.deleted_at = _utcnow()
        if deleted_by:
            order.remarks = f"{order.remarks or ''}\n[{date.today()}] Deleted by {deleted_by}".strip()
        await self.session.flush()
        return True
