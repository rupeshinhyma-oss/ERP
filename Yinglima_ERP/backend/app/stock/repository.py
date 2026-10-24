"""
Stock Movement Repository.

Provides database access for StockMovements, StockMovementItems,
Kardex ledger calculations, and sequence numbers.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import and_, case, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.stock.models import StockMovement, StockMovementItem


class StockMovementRepository:
    """Repository for managing stock movement transactions."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_id(self, movement_id: uuid.UUID) -> StockMovement | None:
        stmt = (
            select(StockMovement)
            .options(selectinload(StockMovement.items))
            .where(StockMovement.id == movement_id, StockMovement.deleted_at.is_(None))
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def get_next_movement_no(self, movement_type: str) -> str:
        """Generate formatted serial number, e.g. INW-2026-0001 or OUT-2026-0001."""
        prefix = "INW" if movement_type == "inward" else "OUT"
        current_year = date.today().year

        stmt = select(func.count(StockMovement.id)).where(
            StockMovement.movement_type == movement_type,
            func.extract("year", StockMovement.movement_date) == current_year,
        )
        result = await self.session.execute(stmt)
        count = result.scalar_one() or 0
        seq = count + 1
        return f"{prefix}-{current_year}-{seq:04d}"

    async def list_movements(
        self,
        movement_type: str | None = None,
        source_type: str | None = None,
        status: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[StockMovement]:
        query = (
            select(StockMovement)
            .options(selectinload(StockMovement.items))
            .where(StockMovement.deleted_at.is_(None))
        )

        if movement_type:
            query = query.where(StockMovement.movement_type == movement_type)
        if source_type:
            query = query.where(StockMovement.source_type == source_type)
        if status:
            query = query.where(StockMovement.status == status)
        if date_from:
            query = query.where(StockMovement.movement_date >= date_from)
        if date_to:
            query = query.where(StockMovement.movement_date <= date_to)
        if search:
            search_pattern = f"%{search.strip()}%"
            query = query.where(
                or_(
                    StockMovement.movement_no.ilike(search_pattern),
                    StockMovement.supplier_name.ilike(search_pattern),
                    StockMovement.buyer_name.ilike(search_pattern),
                    StockMovement.reference_no.ilike(search_pattern),
                    StockMovement.vehicle_no.ilike(search_pattern),
                    StockMovement.purchase_invoice_no.ilike(search_pattern),
                    StockMovement.sale_order_no.ilike(search_pattern),
                )
            )

        query = query.order_by(desc(StockMovement.movement_date), desc(StockMovement.created_at))
        query = query.offset(offset).limit(limit)

        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def count_movements(
        self,
        movement_type: str | None = None,
        source_type: str | None = None,
        status: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        search: str | None = None,
    ) -> int:
        query = select(func.count(StockMovement.id)).where(StockMovement.deleted_at.is_(None))

        if movement_type:
            query = query.where(StockMovement.movement_type == movement_type)
        if source_type:
            query = query.where(StockMovement.source_type == source_type)
        if status:
            query = query.where(StockMovement.status == status)
        if date_from:
            query = query.where(StockMovement.movement_date >= date_from)
        if date_to:
            query = query.where(StockMovement.movement_date <= date_to)
        if search:
            search_pattern = f"%{search.strip()}%"
            query = query.where(
                or_(
                    StockMovement.movement_no.ilike(search_pattern),
                    StockMovement.supplier_name.ilike(search_pattern),
                    StockMovement.buyer_name.ilike(search_pattern),
                    StockMovement.reference_no.ilike(search_pattern),
                    StockMovement.vehicle_no.ilike(search_pattern),
                    StockMovement.purchase_invoice_no.ilike(search_pattern),
                    StockMovement.sale_order_no.ilike(search_pattern),
                )
            )

        result = await self.session.execute(query)
        return result.scalar_one() or 0

    async def get_summary_metrics(self) -> dict[str, Any]:
        """Aggregate summary metrics for Stock Dashboard."""
        # Active confirmed inward
        inward_stmt = (
            select(
                func.count(StockMovement.id),
                func.coalesce(func.sum(StockMovement.total_quantity), 0.0),
            )
            .where(
                StockMovement.deleted_at.is_(None),
                StockMovement.movement_type == "inward",
                StockMovement.status == "confirmed",
            )
        )
        inward_res = await self.session.execute(inward_stmt)
        inward_row = inward_res.one()

        # Active confirmed outward
        outward_stmt = (
            select(
                func.count(StockMovement.id),
                func.coalesce(func.sum(StockMovement.total_quantity), 0.0),
            )
            .where(
                StockMovement.deleted_at.is_(None),
                StockMovement.movement_type == "outward",
                StockMovement.status == "confirmed",
            )
        )
        outward_res = await self.session.execute(outward_stmt)
        outward_row = outward_res.one()

        total_inward_records = int(inward_row[0] or 0)
        total_inward_quantity = float(inward_row[1] or 0.0)
        total_outward_records = int(outward_row[0] or 0)
        total_outward_quantity = float(outward_row[1] or 0.0)
        total_net_stock_quantity = total_inward_quantity - total_outward_quantity

        return {
            "total_inward_records": total_inward_records,
            "total_inward_quantity": total_inward_quantity,
            "total_outward_records": total_outward_records,
            "total_outward_quantity": total_outward_quantity,
            "total_net_stock_quantity": total_net_stock_quantity,
        }

    async def get_stock_balances(
        self,
        search: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """
        Compute live inventory balance grouped by product.
        Stock = sum(inward accepted_quantity) - sum(outward accepted_quantity)
        """
        # Join items with movement
        stmt = (
            select(
                StockMovementItem.product_id,
                StockMovementItem.product_name,
                StockMovementItem.product_code,
                func.sum(
                    case(
                        (StockMovement.movement_type == "inward", StockMovementItem.accepted_quantity),
                        else_=0.0,
                    )
                ).label("total_inward_qty"),
                func.sum(
                    case(
                        (StockMovement.movement_type == "outward", StockMovementItem.accepted_quantity),
                        else_=0.0,
                    )
                ).label("total_outward_qty"),
                func.max(StockMovement.movement_date).label("last_movement_date"),
            )
            .join(StockMovement, StockMovementItem.movement_id == StockMovement.id)
            .where(
                StockMovement.deleted_at.is_(None),
                StockMovement.status == "confirmed",
            )
            .group_by(
                StockMovementItem.product_id,
                StockMovementItem.product_name,
                StockMovementItem.product_code,
            )
        )

        if search:
            pattern = f"%{search.strip()}%"
            stmt = stmt.where(
                or_(
                    StockMovementItem.product_name.ilike(pattern),
                    StockMovementItem.product_code.ilike(pattern),
                )
            )

        stmt = stmt.order_by(StockMovementItem.product_name.asc()).offset(offset).limit(limit)

        result = await self.session.execute(stmt)
        rows = result.all()

        balances = []
        for row in rows:
            inward = float(row.total_inward_qty or 0.0)
            outward = float(row.total_outward_qty or 0.0)
            balances.append(
                {
                    "product_id": row.product_id,
                    "product_name": row.product_name,
                    "product_code": row.product_code,
                    "total_inward_qty": inward,
                    "total_outward_qty": outward,
                    "current_stock_qty": inward - outward,
                    "last_movement_date": row.last_movement_date,
                }
            )
        return balances

    async def get_product_kardex(
        self, product_id: uuid.UUID | None = None, product_name: str | None = None
    ) -> list[dict[str, Any]]:
        """Retrieve full chronological transaction ledger (Kardex) for an item."""
        stmt = (
            select(
                StockMovement.movement_no,
                StockMovement.movement_type,
                StockMovement.movement_date,
                StockMovement.source_type,
                StockMovement.supplier_name,
                StockMovement.buyer_name,
                StockMovement.reference_no,
                StockMovement.warehouse_location,
                StockMovementItem.expected_quantity,
                StockMovementItem.quantity,
                StockMovementItem.damaged_quantity,
                StockMovementItem.accepted_quantity,
                StockMovementItem.remarks,
            )
            .join(StockMovementItem, StockMovementItem.movement_id == StockMovement.id)
            .where(
                StockMovement.deleted_at.is_(None),
                StockMovement.status == "confirmed",
            )
        )

        if product_id:
            stmt = stmt.where(StockMovementItem.product_id == product_id)
        elif product_name:
            stmt = stmt.where(StockMovementItem.product_name.ilike(f"%{product_name.strip()}%"))

        stmt = stmt.order_by(StockMovement.movement_date.asc(), StockMovement.created_at.asc())

        result = await self.session.execute(stmt)
        rows = result.all()

        running_balance = 0.0
        kardex = []
        for r in rows:
            qty_in = float(r.accepted_quantity) if r.movement_type == "inward" else 0.0
            qty_out = float(r.accepted_quantity) if r.movement_type == "outward" else 0.0
            running_balance += (qty_in - qty_out)
            kardex.append(
                {
                    "movement_no": r.movement_no,
                    "movement_type": r.movement_type,
                    "movement_date": r.movement_date,
                    "source_type": r.source_type,
                    "party_name": r.supplier_name if r.movement_type == "inward" else r.buyer_name,
                    "reference_no": r.reference_no,
                    "warehouse_location": r.warehouse_location,
                    "expected_qty": float(r.expected_quantity),
                    "received_or_dispatched_qty": float(r.quantity),
                    "damaged_qty": float(r.damaged_quantity),
                    "net_qty": float(r.accepted_quantity),
                    "qty_in": qty_in,
                    "qty_out": qty_out,
                    "balance": running_balance,
                    "remarks": r.remarks,
                }
            )
        return kardex

    async def get_current_stock(
        self,
        product_id: uuid.UUID | None = None,
        product_code: str | None = None,
        product_name: str | None = None,
    ) -> float:
        """
        Calculate current confirmed in-stock balance for a specific product.
        Returns total_inward - total_outward for confirmed, non-deleted movements.
        """
        if not product_id and not (product_code and product_code.strip()) and not (product_name and product_name.strip()):
            return 0.0

        if product_id:
            conditions = [StockMovementItem.product_id == product_id]
            if product_code and product_code.strip():
                conditions.append(
                    and_(
                        StockMovementItem.product_id.is_(None),
                        StockMovementItem.product_code.ilike(product_code.strip()),
                    )
                )
            if product_name and product_name.strip():
                conditions.append(
                    and_(
                        StockMovementItem.product_id.is_(None),
                        func.lower(StockMovementItem.product_name) == product_name.strip().lower(),
                    )
                )
            filter_expr = or_(*conditions)
        elif product_code and product_code.strip():
            filter_expr = StockMovementItem.product_code.ilike(product_code.strip())
        elif product_name and product_name.strip():
            filter_expr = func.lower(StockMovementItem.product_name) == product_name.strip().lower()
        else:
            return 0.0

        stmt = (
            select(
                func.coalesce(
                    func.sum(
                        case(
                            (StockMovement.movement_type == "inward", StockMovementItem.accepted_quantity),
                            (StockMovement.movement_type == "outward", -StockMovementItem.accepted_quantity),
                            else_=0.0,
                        )
                    ),
                    0.0,
                )
            )
            .join(StockMovement, StockMovementItem.movement_id == StockMovement.id)
            .where(
                StockMovement.deleted_at.is_(None),
                StockMovement.status == "confirmed",
                filter_expr,
            )
        )
        result = await self.session.execute(stmt)
        val = result.scalar_one_or_none()
        return float(val or 0.0)

    async def delete_movement(self, movement: StockMovement) -> None:
        """Soft delete a stock movement."""
        movement.deleted_at = datetime.now(timezone.utc)
        await self.session.commit()

