"""
Stock Movement Service.

Coordinates stock movements, 1-click PO/SO extraction, and live ledger balances.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import BadRequestException, NotFoundException
from app.purchases.local.models import LocalPurchase
from app.sales.models import SaleOrder
from app.stock.models import StockMovement, StockMovementItem
from app.stock.repository import StockMovementRepository
from app.stock.schemas import (
    ExtractedItem,
    PurchaseExtractResponse,
    SaleOrderExtractResponse,
    StockMovementCreate,
)


class StockMovementService:
    """Business logic for Inward/Outward movements and inventory ledger."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repository = StockMovementRepository(session)

    async def get_movement(self, movement_id: uuid.UUID) -> StockMovement:
        movement = await self.repository.get_by_id(movement_id)
        if not movement:
            raise NotFoundException(f"Stock movement with ID {movement_id} not found.")
        return movement

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
    ) -> tuple[list[StockMovement], int]:
        items = await self.repository.list_movements(
            movement_type=movement_type,
            source_type=source_type,
            status=status,
            date_from=date_from,
            date_to=date_to,
            search=search,
            limit=limit,
            offset=offset,
        )
        total = await self.repository.count_movements(
            movement_type=movement_type,
            source_type=source_type,
            status=status,
            date_from=date_from,
            date_to=date_to,
            search=search,
        )
        return items, total

    async def create_movement(
        self,
        data: StockMovementCreate,
        created_by_id: uuid.UUID | None = None,
        created_by_name: str | None = None,
    ) -> StockMovement:
        if not data.items:
            raise BadRequestException("Stock movement must contain at least one line item.")

        # STRICT OUTWARD VALIDATION (Block Outward to prevent negative inventory)
        if data.movement_type == "outward":
            grouped_requests: dict[tuple, dict[str, Any]] = {}
            for item_in in data.items:
                accepted = (
                    item_in.accepted_quantity
                    if item_in.accepted_quantity > 0
                    else max(0.0, item_in.quantity - item_in.damaged_quantity)
                )
                if accepted <= 0:
                    continue

                key = (
                    str(item_in.product_id) if item_in.product_id else None,
                    (item_in.product_code or "").strip().lower(),
                    item_in.product_name.strip().lower(),
                )
                if key not in grouped_requests:
                    grouped_requests[key] = {
                        "product_id": item_in.product_id,
                        "product_code": item_in.product_code,
                        "product_name": item_in.product_name,
                        "total_requested": 0.0,
                    }
                grouped_requests[key]["total_requested"] += accepted

            for grp in grouped_requests.values():
                available_stock = await self.repository.get_current_stock(
                    product_id=grp["product_id"],
                    product_code=grp["product_code"],
                    product_name=grp["product_name"],
                )
                total_req = grp["total_requested"]
                if total_req > available_stock:
                    item_desc = grp["product_name"]
                    if grp["product_code"]:
                        item_desc += f" (SKU: {grp['product_code']})"
                    raise BadRequestException(
                        f"Insufficient Stock for '{item_desc}'. Available stock in warehouse is {available_stock:g} units, "
                        f"but requested outward dispatch is {total_req:g} units. Outward dispatch blocked to prevent negative inventory."
                    )

        movement_no = await self.repository.get_next_movement_no(data.movement_type)

        movement = StockMovement(
            movement_no=movement_no,
            movement_type=data.movement_type,
            movement_date=data.movement_date,
            status="confirmed",
            source_type=data.source_type,
            purchase_id=data.purchase_id,
            purchase_invoice_no=data.purchase_invoice_no,
            sale_order_id=data.sale_order_id,
            sale_order_no=data.sale_order_no,
            supplier_id=data.supplier_id,
            supplier_name=data.supplier_name,
            buyer_id=data.buyer_id,
            buyer_name=data.buyer_name,
            reference_no=data.reference_no,
            warehouse_location=data.warehouse_location,
            vehicle_no=data.vehicle_no,
            transporter_name=data.transporter_name,
            container_no=data.container_no,
            remarks=data.remarks,
            created_by_id=created_by_id,
            created_by_name=created_by_name,
        )

        total_qty = 0.0
        for item_in in data.items:
            # accepted_quantity default = quantity - damaged_quantity if not explicitly set
            accepted = (
                item_in.accepted_quantity
                if item_in.accepted_quantity > 0
                else max(0.0, item_in.quantity - item_in.damaged_quantity)
            )
            item_entity = StockMovementItem(
                product_id=item_in.product_id,
                product_name=item_in.product_name,
                product_code=item_in.product_code,
                expected_quantity=item_in.expected_quantity,
                quantity=item_in.quantity,
                damaged_quantity=item_in.damaged_quantity,
                accepted_quantity=accepted,
                unit_rate=item_in.unit_rate,
                package_details=item_in.package_details,
                remarks=item_in.remarks,
            )
            movement.items.append(item_entity)
            total_qty += accepted

        movement.total_quantity = total_qty
        movement.total_items_count = len(movement.items)

        self.session.add(movement)
        await self.session.commit()
        await self.session.refresh(movement)
        return movement

    async def cancel_movement(
        self, movement_id: uuid.UUID, reason: str | None = None
    ) -> StockMovement:
        movement = await self.get_movement(movement_id)
        if movement.status == "cancelled":
            raise BadRequestException("Stock movement is already cancelled.")

        # Guard inward cancellation: Ensure cancelling will not cause negative stock
        if movement.movement_type == "inward" and movement.status == "confirmed":
            for it in movement.items:
                accepted = float(it.accepted_quantity or 0.0)
                if accepted > 0:
                    current_stock = await self.repository.get_current_stock(
                        product_id=it.product_id,
                        product_code=it.product_code,
                        product_name=it.product_name,
                    )
                    if current_stock - accepted < 0:
                        raise BadRequestException(
                            f"Cannot cancel inward movement {movement.movement_no}: '{it.product_name}' "
                            f"has only {current_stock:g} units currently in warehouse, but this inward provided "
                            f"{accepted:g} units. Items have already been dispatched."
                        )

        movement.status = "cancelled"
        if reason:
            movement.remarks = f"{movement.remarks or ''} [Cancelled: {reason}]".strip()

        await self.session.commit()
        await self.session.refresh(movement)
        return movement

    async def delete_movement(self, movement_id: uuid.UUID) -> None:
        """Soft delete a stock movement, checking stock integrity."""
        movement = await self.get_movement(movement_id)

        # Guard inward deletion if confirmed: Ensure deleting will not cause negative stock
        if movement.movement_type == "inward" and movement.status == "confirmed":
            for it in movement.items:
                accepted = float(it.accepted_quantity or 0.0)
                if accepted > 0:
                    current_stock = await self.repository.get_current_stock(
                        product_id=it.product_id,
                        product_code=it.product_code,
                        product_name=it.product_name,
                    )
                    if current_stock - accepted < 0:
                        raise BadRequestException(
                            f"Cannot delete inward movement {movement.movement_no}: '{it.product_name}' "
                            f"has only {current_stock:g} units currently in warehouse, but this inward provided "
                            f"{accepted:g} units. Items have already been dispatched."
                        )

        await self.repository.delete_movement(movement)


    async def extract_from_local_purchase(
        self, purchase_id: uuid.UUID
    ) -> PurchaseExtractResponse:
        """Extract header and items from a Local Purchase order for 1-click Inward Entry."""
        stmt = (
            select(LocalPurchase)
            .options(selectinload(LocalPurchase.items))
            .where(LocalPurchase.id == purchase_id, LocalPurchase.deleted_at.is_(None))
        )
        res = await self.session.execute(stmt)
        purchase = res.scalars().first()
        if not purchase:
            raise NotFoundException(f"Local Purchase with ID {purchase_id} not found.")

        extracted_items = []
        for it in purchase.items:
            extracted_items.append(
                ExtractedItem(
                    product_id=it.product_id,
                    product_name=it.product_name,
                    product_code=it.product_code,
                    quantity=float(it.quantity),
                    unit_rate=float(it.unit_rate),
                    hsn_code=it.hsn_code,
                )
            )

        return PurchaseExtractResponse(
            purchase_id=purchase.id,
            invoice_no=purchase.invoice_no,
            invoice_date=purchase.invoice_date,
            supplier_id=purchase.supplier_id,
            supplier_name=purchase.supplier_name,
            consignment_code=purchase.consignment_code,
            currency=purchase.currency,
            total_quantity=float(purchase.total_quantity),
            items=extracted_items,
        )

    async def extract_from_sale_order(
        self, sale_order_id: uuid.UUID
    ) -> SaleOrderExtractResponse:
        """Extract header and items from a Sale Process order for 1-click Outward Entry."""
        stmt = (
            select(SaleOrder)
            .options(selectinload(SaleOrder.items))
            .where(SaleOrder.id == sale_order_id, SaleOrder.deleted_at.is_(None))
        )
        res = await self.session.execute(stmt)
        order = res.scalars().first()
        if not order:
            raise NotFoundException(f"Sale Process Order with ID {sale_order_id} not found.")

        extracted_items = []
        for it in order.items:
            extracted_items.append(
                ExtractedItem(
                    product_id=it.product_id,
                    product_name=it.product_name,
                    product_code=it.product_code,
                    quantity=float(it.quantity),
                    unit_rate=float(it.unit_rate),
                    hsn_code=it.hsn_code,
                )
            )

        return SaleOrderExtractResponse(
            sale_order_id=order.id,
            order_no=order.order_no,
            order_date=order.order_date,
            buyer_id=order.buyer_id,
            buyer_name=order.buyer_name,
            consignment_code=order.consignment_code,
            container_no=order.container_no,
            transporter_name=order.transporter_name,
            lr_no=order.lr_no,
            currency=order.currency,
            total_quantity=float(order.total_quantity),
            items=extracted_items,
        )

    async def get_summary_metrics(self) -> dict[str, Any]:
        return await self.repository.get_summary_metrics()

    async def get_stock_balances(
        self, search: str | None = None, limit: int = 100, offset: int = 0
    ) -> list[dict[str, Any]]:
        return await self.repository.get_stock_balances(search=search, limit=limit, offset=offset)

    async def get_product_kardex(
        self, product_id: uuid.UUID | None = None, product_name: str | None = None
    ) -> list[dict[str, Any]]:
        return await self.repository.get_product_kardex(
            product_id=product_id, product_name=product_name
        )

    async def get_available_stock(
        self,
        product_id: uuid.UUID | None = None,
        product_code: str | None = None,
        product_name: str | None = None,
    ) -> float:
        return await self.repository.get_current_stock(
            product_id=product_id,
            product_code=product_code,
            product_name=product_name,
        )

