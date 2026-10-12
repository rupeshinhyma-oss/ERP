"""Technician Operations business service.

Coordinates:
- Technician Spare Parts Gatepasses & Returns
- Sales Order reconciliation for consumed parts
- Field Payment Collections & Technician Wallet Ledger
- Machine Warranty lifecycle & serial validation
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import CurrentUser
from app.core.exceptions import BadRequestException, NotFoundException
from app.technician_operations.models import MachineWarranty, TechnicianGatepass, TechnicianWalletTransaction
from app.technician_operations.repository import TechnicianOperationsRepository
from app.technician_operations.schemas import (
    DraftSOGenerationResponse,
    GatepassCreate,
    GatepassLinkSOPayload,
    GatepassRead,
    GatepassReturnPayload,
    TechnicianOperationsMetrics,
    TechnicianWalletSummary,
    WalletTransactionCreate,
    WalletTransactionRead,
    WarrantyRead,
    WarrantyRegisterPayload,
    WarrantyValidationResult,
)


class TechnicianOperationsService:
    """Service handling technician gatepasses, wallet balances, and warranty tracking."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = TechnicianOperationsRepository(session)

    # -----------------------------------------------------------------------
    # Machine Warranty
    # -----------------------------------------------------------------------

    async def register_warranty(self, payload: WarrantyRegisterPayload) -> WarrantyRead:
        """Register a new machine warranty."""
        record = await self.repo.register_warranty(payload)
        await self.session.commit()
        # Fetch fresh read model with remaining days
        reads, _ = await self.repo.list_warranties(search=record.serial_number, page=1, page_size=1)
        if reads:
            return reads[0]
        today = date.today()
        is_cov = record.is_currently_covered()
        days_rem = max(0, (record.warranty_end_date - today).days) if is_cov else 0
        return WarrantyRead(
            id=record.id,
            serial_number=record.serial_number,
            machine_model=record.machine_model,
            product_id=record.product_id,
            company_name=record.company_name,
            company_id=record.company_id,
            invoice_number=record.invoice_number,
            invoice_date=record.invoice_date,
            warranty_months=record.warranty_months,
            warranty_end_date=record.warranty_end_date,
            status=record.status if is_cov else "OUT_OF_WARRANTY",
            contact_person=record.contact_person,
            contact_phone=record.contact_phone,
            installation_city=record.installation_city,
            notes=record.notes,
            created_at=record.created_at,
            is_currently_covered=is_cov,
            days_remaining=days_rem,
        )

    async def validate_serial(self, serial: str) -> WarrantyValidationResult:
        """Validate if a machine serial number is under active warranty."""
        return await self.repo.validate_serial(serial)

    async def list_warranties(
        self,
        *,
        search: str | None = None,
        status: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[WarrantyRead], int]:
        """List warranties with computed days remaining."""
        return await self.repo.list_warranties(
            search=search,
            status=status,
            page=page,
            page_size=page_size,
        )

    # -----------------------------------------------------------------------
    # Spare Parts Gatepass & Returns
    # -----------------------------------------------------------------------

    async def create_gatepass(
        self,
        payload: GatepassCreate,
        current_user: CurrentUser | None = None,
    ) -> GatepassRead:
        """Create an Outward Spare Parts Gatepass for technician field visit."""
        if current_user and current_user.full_name:
            payload.issued_by_name = current_user.full_name

        gatepass = await self.repo.create_gatepass(payload)
        await self.session.commit()
        refreshed = await self.repo.get_gatepass_by_id(gatepass.id)
        if refreshed is None:
            raise NotFoundException("Gatepass was not found after creation")
        return self.repo._to_gatepass_read(refreshed)

    async def get_gatepass(self, gatepass_id: uuid.UUID) -> GatepassRead:
        """Get full gatepass details by ID."""
        gp = await self.repo.get_gatepass_by_id(gatepass_id)
        if gp is None:
            raise NotFoundException(f"Gatepass '{gatepass_id}' not found")
        return self.repo._to_gatepass_read(gp)

    async def list_gatepasses(
        self,
        *,
        technician_name: str | None = None,
        status: str | None = None,
        search: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[GatepassRead], int]:
        """List gatepasses with filters and computed reconciliation totals."""
        return await self.repo.list_gatepasses(
            technician_name=technician_name,
            status=status,
            search=search,
            page=page,
            page_size=page_size,
        )

    async def record_parts_return(
        self,
        gatepass_id: uuid.UUID,
        payload: GatepassReturnPayload,
    ) -> GatepassRead:
        """
        Record return of parts to warehouse.
        Reconciles issued vs returned vs consumed.
        If consumed parts exist and are chargeable, triggers `so_required = True`.
        """
        res = await self.repo.record_parts_return(gatepass_id, payload)
        await self.session.commit()
        return res

    async def link_sales_order(
        self,
        gatepass_id: uuid.UUID,
        payload: GatepassLinkSOPayload,
    ) -> GatepassRead:
        """Link Sales Order created by salesperson for consumed parts."""
        res = await self.repo.link_sales_order(gatepass_id, payload)
        await self.session.commit()
        return res

    async def get_draft_so_payload(self, gatepass_id: uuid.UUID) -> DraftSOGenerationResponse:
        """
        Generate draft Sales Order payload from gatepass for salesperson billing.
        Filters items consumed during service call that are out of warranty.
        """
        gp = await self.repo.get_gatepass_by_id(gatepass_id)
        if gp is None:
            raise NotFoundException(f"Gatepass '{gatepass_id}' not found")

        items_to_bill: list[dict[str, Any]] = []
        subtotal = 0.0

        for item in gp.items:
            if item.quantity_consumed > 0 and not item.is_warranty_covered:
                rate = float(item.unit_rate or 0.0)
                line_total = round(item.quantity_consumed * rate, 2)
                subtotal += line_total
                items_to_bill.append({
                    "gatepass_item_id": str(item.id),
                    "product_id": str(item.product_id) if item.product_id else None,
                    "product_code": item.product_code,
                    "product_name": item.product_name,
                    "uom": item.uom,
                    "quantity": item.quantity_consumed,
                    "unit_rate": rate,
                    "line_total": line_total,
                    "remarks": f"Consumed on service call ({gp.gatepass_number})",
                })

        if not items_to_bill:
            msg = "No chargeable consumed parts found on this gatepass (all parts returned or covered under warranty)."
        elif gp.so_created:
            msg = f"Sales Order '{gp.so_number}' has already been linked to this gatepass."
        else:
            msg = f"Ready to bill: {len(items_to_bill)} item(s) consumed. Please generate a Sales Order."

        return DraftSOGenerationResponse(
            customer_name=gp.customer_name or "Direct Customer",
            machine_serial_number=gp.machine_serial_number,
            gatepass_number=gp.gatepass_number,
            items_to_bill=items_to_bill,
            estimated_subtotal=round(subtotal, 2),
            message=msg,
        )

    # -----------------------------------------------------------------------
    # Technician Payment & Wallet Management
    # -----------------------------------------------------------------------

    async def record_wallet_transaction(
        self,
        payload: WalletTransactionCreate,
    ) -> WalletTransactionRead:
        """Record money collected on field visit, cash handover, or field expense."""
        txn = await self.repo.record_wallet_transaction(payload)
        await self.session.commit()
        return WalletTransactionRead.model_validate(txn)

    async def list_wallet_transactions(
        self,
        *,
        technician_name: str | None = None,
        transaction_type: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[WalletTransactionRead], int]:
        """List paginated wallet transactions with filters."""
        txns, total = await self.repo.list_wallet_transactions(
            technician_name=technician_name,
            transaction_type=transaction_type,
            date_from=date_from,
            date_to=date_to,
            page=page,
            page_size=page_size,
        )
        return [WalletTransactionRead.model_validate(t) for t in txns], total

    async def get_technician_wallet_summaries(self) -> list[TechnicianWalletSummary]:
        """Calculate live wallet cash balances across all service technicians."""
        return await self.repo.get_technician_wallet_summaries()

    # -----------------------------------------------------------------------
    # Operations Metrics
    # -----------------------------------------------------------------------

    async def get_metrics(self) -> TechnicianOperationsMetrics:
        """High-level KPI metrics for technician operations."""
        return await self.repo.get_metrics()
