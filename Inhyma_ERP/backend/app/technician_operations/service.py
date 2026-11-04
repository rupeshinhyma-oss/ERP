"""Technician Operations business service.

Coordinates:
- Technician Spare Parts Gatepasses, Physical Warehouse Stock Sync & Returns
- Sales Order reconciliation for consumed parts
- Field Payment Collections & Technician Wallet Ledger
- Machine Warranty lifecycle & serial validation (Registry + Sales Order fallback)
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

from app.auth.service import CurrentUser
from app.core.exceptions import NotFoundException
from app.masters.products.models import Product
from app.masters.taxes.models import Tax
from app.technician_operations.repository import TechnicianOperationsRepository
from app.technician_operations.schemas import (
    DraftSOGenerationResponse,
    GatepassCreate,
    GatepassLinkSOPayload,
    GatepassRead,
    GatepassReturnPayload,
    TechnicianOperationsMetrics,
    TechnicianOpsLookupsResponse,
    TechnicianWalletSummary,
    WalletTransactionCreate,
    WalletTransactionRead,
    WarrantyRead,
    WarrantyRegisterPayload,
    WarrantyValidationResult,
)


def _actor_name(current_user: CurrentUser | None) -> str | None:
    if current_user is None:
        return None
    return (
        getattr(current_user, "display_name", None)
        or getattr(current_user, "full_name", None)
        or getattr(current_user, "username", None)
    )


class TechnicianOperationsService:
    """Service handling technician gatepasses, wallet balances, and warranty tracking."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = TechnicianOperationsRepository(session)

    # -----------------------------------------------------------------------
    # Master Lookups
    # -----------------------------------------------------------------------

    async def get_lookups(self) -> TechnicianOpsLookupsResponse:
        """Fetch master-driven lookups for Technician Operations forms."""
        return await self.repo.get_lookups()

    # -----------------------------------------------------------------------
    # Machine Warranty
    # -----------------------------------------------------------------------

    async def register_warranty(self, payload: WarrantyRegisterPayload) -> WarrantyRead:
        """Register a new machine warranty."""
        record = await self.repo.register_warranty(payload)
        await self.session.commit()
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
        actor = _actor_name(current_user)
        if actor:
            payload.issued_by_name = actor

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
        Reconciles issued vs returned vs consumed, restores good returns to physical stock,
        and flags `so_required = True` when chargeable consumed parts exist.
        """
        res = await self.repo.record_parts_return(gatepass_id, payload)
        await self.session.commit()
        return res

    async def link_sales_order(
        self,
        gatepass_id: uuid.UUID,
        payload: GatepassLinkSOPayload,
    ) -> GatepassRead:
        """Verify and link Sales Order created by salesperson for consumed parts."""
        res = await self.repo.link_sales_order(gatepass_id, payload)
        await self.session.commit()
        return res

    async def get_draft_so_payload(self, gatepass_id: uuid.UUID) -> DraftSOGenerationResponse:
        """
        Generate enriched draft Sales Order payload from gatepass for salesperson billing.
        Filters items consumed during service call that are out of warranty and enriches
        company address/city/state and product HSN/GST metadata.
        """
        gp = await self.repo.get_gatepass_by_id(gatepass_id)
        if gp is None:
            raise NotFoundException(f"Gatepass '{gatepass_id}' not found")

        company_id: uuid.UUID | None = None
        city_name: str | None = None
        state_name: str | None = None
        billing_address: str | None = None
        shipping_address: str | None = None

        if gp.customer_name and gp.customer_name.strip():
            try:
                from app.companies.models import Company
                from app.masters.cities.models import City
                from app.masters.states.models import State

                async with self.session.begin_nested():
                    comp = (
                        await self.session.execute(
                            select(Company)
                            .options(noload("*"))
                            .where(
                                Company.deleted_at.is_(None),
                                func.lower(Company.company_name) == gp.customer_name.strip().lower(),
                            )
                            .limit(1)
                        )
                    ).scalar_one_or_none()
                    if comp is not None:
                        company_id = comp.id
                        billing_address = comp.address
                        shipping_address = comp.address
                        if comp.city_id:
                            ct = await self.session.get(City, comp.city_id)
                            if ct:
                                city_name = ct.name
                                if ct.state_id:
                                    st = await self.session.get(State, ct.state_id)
                                    if st:
                                        state_name = st.name
                        if not state_name and comp.state_id:
                            st = await self.session.get(State, comp.state_id)
                            if st:
                                state_name = st.name
                        if not city_name and comp.town:
                            city_name = comp.town
            except Exception:
                pass

        items_to_bill: list[dict[str, Any]] = []
        subtotal = 0.0

        for item in gp.items:
            cons_qty = float(item.quantity_consumed or 0.0)
            if cons_qty > 0 and not item.is_warranty_covered:
                rate = float(item.unit_rate or 0.0)
                hsn_code: str | None = None
                gst_percent: float = 18.0

                try:
                    async with self.session.begin_nested():
                        prod: Product | None = None
                        if item.product_id is not None:
                            prod = await self.session.get(Product, item.product_id)
                        if prod is None:
                            prod = (
                                await self.session.execute(
                                    select(Product)
                                    .options(noload("*"))
                                    .where(
                                        Product.deleted_at.is_(None),
                                        func.lower(Product.product_name) == item.product_name.strip().lower(),
                                    )
                                    .limit(1)
                                )
                            ).scalar_one_or_none()
                        if prod is not None:
                            if rate <= 0:
                                rate = float(prod.standard_price or prod.standard_cost or 0.0)
                            if prod.hsn_id is not None:
                                tx = await self.session.get(Tax, prod.hsn_id)
                                if tx is not None:
                                    hsn_code = tx.hsn_number
                                    gst_percent = float(tx.gst_percent or 18.0)
                except Exception:
                    pass

                line_total = round(cons_qty * rate, 2)
                subtotal += line_total
                items_to_bill.append({
                    "gatepass_item_id": str(item.id),
                    "product_id": str(item.product_id) if item.product_id else None,
                    "product_code": item.product_code,
                    "product_name": item.product_name,
                    "hsn_code": hsn_code or "8422.90.90",
                    "gst_percent": gst_percent,
                    "uom": item.uom,
                    "quantity": cons_qty,
                    "unit_rate": rate,
                    "line_total": line_total,
                    "remarks": f"Consumed on service call ({gp.gatepass_number})",
                })

        if not items_to_bill:
            msg = "No chargeable consumed parts found on this gatepass (all parts returned or covered under warranty)."
        elif gp.so_created:
            msg = f"Sales Order '{gp.so_number}' has already been linked to this gatepass."
        else:
            msg = f"Ready to bill: {len(items_to_bill)} item(s) consumed. Create a Sales Order to close reconciliation."

        return DraftSOGenerationResponse(
            gatepass_id=gp.id,
            customer_name=gp.customer_name or "Direct Customer",
            company_id=company_id,
            warehouse_name=gp.warehouse_name,
            city=city_name,
            state=state_name,
            billing_address=billing_address,
            shipping_address=shipping_address,
            machine_model=gp.machine_model,
            machine_serial_number=gp.machine_serial_number,
            gatepass_number=gp.gatepass_number,
            so_created=gp.so_created,
            so_number=gp.so_number,
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
        current_user: CurrentUser | None = None,
    ) -> WalletTransactionRead:
        """Record money collected on field visit, cash handover, or field expense."""
        txn = await self.repo.record_wallet_transaction(
            payload,
            verified_by=_actor_name(current_user),
        )
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
