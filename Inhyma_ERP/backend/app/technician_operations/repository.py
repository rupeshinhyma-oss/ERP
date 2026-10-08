"""Database repository for Technician Operations, Spare Parts Gatepass, Wallet & Warranty."""

from __future__ import annotations

import calendar
import uuid
from datetime import date, datetime
from typing import Any


def _add_months(orig_date: date, months: int) -> date:
    """Add integer months to a date, preserving day of month or clipping to month end."""
    new_year = orig_date.year + (orig_date.month + months - 1) // 12
    new_month = (orig_date.month + months - 1) % 12 + 1
    max_day = calendar.monthrange(new_year, new_month)[1]
    new_day = min(orig_date.day, max_day)
    return date(new_year, new_month, new_day)

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import BadRequestException, NotFoundException
from app.masters.technicians.models import Technician
from app.technician_operations.models import (
    MachineWarranty,
    TechnicianGatepass,
    TechnicianGatepassItem,
    TechnicianWalletTransaction,
)
from app.technician_operations.schemas import (
    GatepassCreate,
    GatepassLinkSOPayload,
    GatepassRead,
    GatepassReturnPayload,
    TechnicianOperationsMetrics,
    TechnicianWalletSummary,
    WalletTransactionCreate,
    WarrantyRead,
    WarrantyRegisterPayload,
    WarrantyValidationResult,
)


class TechnicianOperationsRepository:
    """Repository managing Gatepass, Wallet transactions, and Warranty lifecycle."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # -----------------------------------------------------------------------
    # Machine Warranty
    # -----------------------------------------------------------------------

    async def register_warranty(self, payload: WarrantyRegisterPayload) -> MachineWarranty:
        """Register a new machine warranty policy."""
        existing = await self.get_warranty_by_serial(payload.serial_number)
        if existing is not None:
            raise BadRequestException(f"Machine with serial number '{payload.serial_number}' is already registered")

        end_date = _add_months(payload.invoice_date, payload.warranty_months)
        is_active = date.today() <= end_date
        status = "UNDER_WARRANTY" if is_active else "OUT_OF_WARRANTY"

        warranty = MachineWarranty(
            serial_number=payload.serial_number.strip().upper(),
            machine_model=payload.machine_model.strip(),
            product_id=payload.product_id,
            company_name=payload.company_name.strip(),
            company_id=payload.company_id,
            invoice_number=payload.invoice_number.strip() if payload.invoice_number else None,
            invoice_date=payload.invoice_date,
            warranty_months=payload.warranty_months,
            warranty_end_date=end_date,
            status=status,
            contact_person=payload.contact_person,
            contact_phone=payload.contact_phone,
            installation_city=payload.installation_city,
            notes=payload.notes,
        )
        self.session.add(warranty)
        await self.session.flush()
        return warranty

    async def get_warranty_by_serial(self, serial: str) -> MachineWarranty | None:
        """Find warranty record by exact or case-insensitive serial number."""
        clean = serial.strip().upper()
        stmt = select(MachineWarranty).where(
            func.upper(MachineWarranty.serial_number) == clean,
            MachineWarranty.deleted_at.is_(None),
        )
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def validate_serial(self, serial: str) -> WarrantyValidationResult:
        """Check if machine is currently under active warranty for service call."""
        record = await self.get_warranty_by_serial(serial)
        if record is None:
            return WarrantyValidationResult(
                serial_number=serial,
                is_registered=False,
                is_covered=False,
                status="NOT_REGISTERED",
                message=f"Serial '{serial}' not found in Machine Registry. Replacement spare parts will be Chargeable.",
            )

        today = date.today()
        is_covered = record.is_currently_covered()
        days_rem = (record.warranty_end_date - today).days

        if is_covered:
            msg = f"Machine is UNDER WARRANTY ({days_rem} days remaining until {record.warranty_end_date}). Eligible for FOC warranty spare parts replacement."
        else:
            msg = f"Machine warranty EXPIRED on {record.warranty_end_date}. Spare parts are Chargeable and require a Sales Order."

        return WarrantyValidationResult(
            serial_number=record.serial_number,
            is_registered=True,
            is_covered=is_covered,
            status=record.status if is_covered else "OUT_OF_WARRANTY",
            company_name=record.company_name,
            machine_model=record.machine_model,
            invoice_date=record.invoice_date,
            warranty_end_date=record.warranty_end_date,
            message=msg,
        )

    async def list_warranties(
        self,
        *,
        search: str | None = None,
        status: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[WarrantyRead], int]:
        """List paginated machine warranty records with days remaining."""
        page = max(1, page)
        page_size = max(1, min(200, page_size))
        offset = (page - 1) * page_size

        stmt = select(MachineWarranty).where(MachineWarranty.deleted_at.is_(None))

        if status:
            stmt = stmt.where(MachineWarranty.status == status)

        if search and search.strip():
            term = f"%{search.strip()}%"
            stmt = stmt.where(
                or_(
                    MachineWarranty.serial_number.ilike(term),
                    MachineWarranty.machine_model.ilike(term),
                    MachineWarranty.company_name.ilike(term),
                    MachineWarranty.invoice_number.ilike(term),
                )
            )

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await self.session.execute(count_stmt)).scalar() or 0

        stmt = stmt.order_by(MachineWarranty.invoice_date.desc()).limit(page_size).offset(offset)
        res = await self.session.execute(stmt)
        records = res.scalars().all()

        today = date.today()
        reads: list[WarrantyRead] = []
        for r in records:
            is_cov = r.is_currently_covered()
            days_rem = max(0, (r.warranty_end_date - today).days) if is_cov else 0
            reads.append(
                WarrantyRead(
                    id=r.id,
                    serial_number=r.serial_number,
                    machine_model=r.machine_model,
                    product_id=r.product_id,
                    company_name=r.company_name,
                    company_id=r.company_id,
                    invoice_number=r.invoice_number,
                    invoice_date=r.invoice_date,
                    warranty_months=r.warranty_months,
                    warranty_end_date=r.warranty_end_date,
                    status=r.status if is_cov else ("OUT_OF_WARRANTY" if r.status != "VOIDED" else "VOIDED"),
                    contact_person=r.contact_person,
                    contact_phone=r.contact_phone,
                    installation_city=r.installation_city,
                    notes=r.notes,
                    created_at=r.created_at,
                    is_currently_covered=is_cov,
                    days_remaining=days_rem,
                )
            )

        return reads, total

    # -----------------------------------------------------------------------
    # Technician Spare Parts Gatepasses
    # -----------------------------------------------------------------------

    async def _generate_gatepass_number(self) -> str:
        """Generate human-readable gatepass code: GP-TECH-YYYY-NNNN."""
        year = date.today().year
        count_stmt = select(func.count(TechnicianGatepass.id))
        res = await self.session.execute(count_stmt)
        count = (res.scalar() or 0) + 1
        return f"GP-TECH-{year}-{count:04d}"

    async def create_gatepass(self, payload: GatepassCreate) -> TechnicianGatepass:
        """Create an Outward Spare Parts Gatepass for a service technician."""
        gp_num = await self._generate_gatepass_number()

        # Check warranty if machine serial is provided
        is_warranty = False
        if payload.machine_serial_number:
            val = await self.validate_serial(payload.machine_serial_number)
            is_warranty = val.is_covered

        gatepass = TechnicianGatepass(
            gatepass_number=gp_num,
            technician_id=payload.technician_id,
            technician_name=payload.technician_name.strip(),
            technician_mobile=payload.technician_mobile.strip() if payload.technician_mobile else None,
            technical_task_id=payload.technical_task_id,
            customer_name=payload.customer_name.strip() if payload.customer_name else None,
            machine_serial_number=payload.machine_serial_number.strip().upper() if payload.machine_serial_number else None,
            is_warranty_service=is_warranty,
            issue_date=payload.issue_date,
            issued_by_name=payload.issued_by_name.strip(),
            purpose=payload.purpose,
            status="ISSUED",
            notes=payload.notes,
        )
        self.session.add(gatepass)
        await self.session.flush()

        for item in payload.items:
            gp_item = TechnicianGatepassItem(
                gatepass_id=gatepass.id,
                product_id=item.product_id,
                product_code=item.product_code,
                product_name=item.product_name.strip(),
                uom=item.uom,
                quantity_issued=item.quantity_issued,
                quantity_consumed=0.0,
                quantity_returned=0.0,
                unit_rate=item.unit_rate,
                is_warranty_covered=is_warranty,
                item_status="ISSUED",
                remarks=item.remarks,
            )
            self.session.add(gp_item)

        await self.session.flush()
        return gatepass

    async def get_gatepass_by_id(self, gatepass_id: uuid.UUID) -> TechnicianGatepass | None:
        """Fetch gatepass with eager loaded line items."""
        stmt = (
            select(TechnicianGatepass)
            .options(selectinload(TechnicianGatepass.items))
            .where(TechnicianGatepass.id == gatepass_id, TechnicianGatepass.deleted_at.is_(None))
        )
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def list_gatepasses(
        self,
        *,
        technician_name: str | None = None,
        status: str | None = None,
        search: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[GatepassRead], int]:
        """List paginated gatepasses with computed reconciliation summaries."""
        page = max(1, page)
        page_size = max(1, min(200, page_size))
        offset = (page - 1) * page_size

        stmt = select(TechnicianGatepass).where(TechnicianGatepass.deleted_at.is_(None))

        if technician_name:
            stmt = stmt.where(TechnicianGatepass.technician_name.ilike(f"%{technician_name.strip()}%"))

        if status:
            stmt = stmt.where(TechnicianGatepass.status == status)

        if search and search.strip():
            term = f"%{search.strip()}%"
            stmt = stmt.where(
                or_(
                    TechnicianGatepass.gatepass_number.ilike(term),
                    TechnicianGatepass.technician_name.ilike(term),
                    TechnicianGatepass.customer_name.ilike(term),
                    TechnicianGatepass.machine_serial_number.ilike(term),
                    TechnicianGatepass.so_number.ilike(term),
                )
            )

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await self.session.execute(count_stmt)).scalar() or 0

        stmt = (
            stmt.options(selectinload(TechnicianGatepass.items))
            .order_by(TechnicianGatepass.issue_date.desc(), TechnicianGatepass.created_at.desc())
            .limit(page_size)
            .offset(offset)
        )
        res = await self.session.execute(stmt)
        records = res.scalars().all()

        reads: list[GatepassRead] = []
        for gp in records:
            reads.append(self._to_gatepass_read(gp))

        return reads, total

    def _to_gatepass_read(self, gp: TechnicianGatepass) -> GatepassRead:
        """Compute reconciliation totals and status messages for a gatepass."""
        total_issued = sum(item.quantity_issued for item in gp.items)
        total_consumed = sum(item.quantity_consumed for item in gp.items)
        total_returned = sum(item.quantity_returned for item in gp.items)
        pending = max(0.0, total_issued - (total_consumed + total_returned))

        # Determine reconciliation message
        if gp.status == "CLOSED":
            reconcile_msg = "Gatepass fully closed and reconciled."
        elif gp.status == "RECONCILED":
            reconcile_msg = "Reconciled with Sales Order & warehouse return."
        elif gp.so_required and not gp.so_created:
            reconcile_msg = f"ACTION REQUIRED: Salesperson must create Sales Order for {total_consumed} consumed part(s)."
        elif pending > 0:
            reconcile_msg = f"Pending Return: {pending} part(s) still in field with technician."
        else:
            reconcile_msg = "Parts returned. Ready for final review."

        return GatepassRead(
            id=gp.id,
            gatepass_number=gp.gatepass_number,
            technician_id=gp.technician_id,
            technician_name=gp.technician_name,
            technician_mobile=gp.technician_mobile,
            technical_task_id=gp.technical_task_id,
            customer_name=gp.customer_name,
            machine_serial_number=gp.machine_serial_number,
            is_warranty_service=gp.is_warranty_service,
            issue_date=gp.issue_date,
            issued_by_name=gp.issued_by_name,
            purpose=gp.purpose,
            status=gp.status,
            so_required=gp.so_required,
            so_number=gp.so_number,
            so_created=gp.so_created,
            return_gatepass_number=gp.return_gatepass_number,
            notes=gp.notes,
            created_at=gp.created_at,
            items=[item for item in gp.items],
            total_issued=round(total_issued, 2),
            total_consumed=round(total_consumed, 2),
            total_returned=round(total_returned, 2),
            pending_return=round(pending, 2),
            reconciliation_message=reconcile_msg,
        )

    async def record_parts_return(
        self,
        gatepass_id: uuid.UUID,
        payload: GatepassReturnPayload,
    ) -> GatepassRead:
        """
        Record return of unused spare parts from technician back to warehouse.
        Verifies consumed parts:
        - If parts were consumed and NOT covered by warranty, flags SO required.
        - Updates return gatepass reference and sets status accordingly.
        """
        gp = await self.get_gatepass_by_id(gatepass_id)
        if gp is None:
            raise NotFoundException("Technician gatepass not found")

        item_map = {item.id: item for item in gp.items}
        has_chargeable_consumed_parts = False

        for ret_item in payload.items:
            if ret_item.item_id not in item_map:
                continue
            item = item_map[ret_item.item_id]

            item.quantity_returned = ret_item.quantity_returned
            item.quantity_consumed = ret_item.quantity_consumed
            item.is_warranty_covered = ret_item.is_warranty_covered
            item.item_status = ret_item.item_status
            if ret_item.remarks:
                item.remarks = ret_item.remarks

            # If part was consumed and not under warranty -> must be billed via SO!
            if item.quantity_consumed > 0 and not item.is_warranty_covered:
                has_chargeable_consumed_parts = True

        # Generate return gatepass number if not supplied
        if payload.return_gatepass_number:
            gp.return_gatepass_number = payload.return_gatepass_number.strip()
        elif not gp.return_gatepass_number:
            year = date.today().year
            gp.return_gatepass_number = f"RGP-TECH-{year}-{gp.gatepass_number.split('-')[-1]}"

        if payload.notes:
            gp.notes = (gp.notes or "") + f"\nReturn Notes: {payload.notes}"

        # Reconciliation check
        total_issued = sum(i.quantity_issued for i in gp.items)
        total_accounted = sum(i.quantity_consumed + i.quantity_returned for i in gp.items)

        if has_chargeable_consumed_parts and not gp.so_created:
            gp.so_required = True
            gp.status = "PARTIALLY_RETURNED"
        elif total_accounted >= total_issued:
            gp.status = "RECONCILED" if (gp.so_required and gp.so_created) or not gp.so_required else "PARTIALLY_RETURNED"
        else:
            gp.status = "PARTIALLY_RETURNED"

        await self.session.flush()
        return self._to_gatepass_read(gp)

    async def link_sales_order(
        self,
        gatepass_id: uuid.UUID,
        payload: GatepassLinkSOPayload,
    ) -> GatepassRead:
        """Link a Sales Order number created for consumed parts to close reconciliation."""
        gp = await self.get_gatepass_by_id(gatepass_id)
        if gp is None:
            raise NotFoundException("Technician gatepass not found")

        gp.so_number = payload.sales_order_number.strip()
        gp.so_created = True

        for item in gp.items:
            if item.quantity_consumed > 0 and not item.is_warranty_covered:
                item.sales_order_number = gp.so_number
                item.item_status = "CONSUMED_BILLED"

        if payload.notes:
            gp.notes = (gp.notes or "") + f"\nSO Linked: {payload.notes}"

        # Recheck if all items are fully returned or billed
        total_issued = sum(i.quantity_issued for i in gp.items)
        total_accounted = sum(i.quantity_consumed + i.quantity_returned for i in gp.items)

        if total_accounted >= total_issued:
            gp.status = "CLOSED"
        else:
            gp.status = "RECONCILED"

        await self.session.flush()
        return self._to_gatepass_read(gp)

    # -----------------------------------------------------------------------
    # Technician Payment & Wallet Management
    # -----------------------------------------------------------------------

    async def _generate_wallet_txn_number(self) -> str:
        """Generate human-readable transaction code: TXN-TECH-YYYY-NNNN."""
        year = date.today().year
        count_stmt = select(func.count(TechnicianWalletTransaction.id))
        res = await self.session.execute(count_stmt)
        count = (res.scalar() or 0) + 1
        return f"TXN-TECH-{year}-{count:04d}"

    async def record_wallet_transaction(self, payload: WalletTransactionCreate) -> TechnicianWalletTransaction:
        """Record money collected on field visit, cash handover, or field expense."""
        txn_num = await self._generate_wallet_txn_number()

        txn = TechnicianWalletTransaction(
            transaction_number=txn_num,
            technician_id=payload.technician_id,
            technician_name=payload.technician_name.strip(),
            technical_task_id=payload.technical_task_id,
            customer_name=payload.customer_name.strip() if payload.customer_name else None,
            transaction_type=payload.transaction_type,
            amount=payload.amount,
            payment_mode=payload.payment_mode,
            reference_no=payload.reference_no.strip() if payload.reference_no else None,
            transaction_date=payload.transaction_date,
            receipt_url=payload.receipt_url,
            status="VERIFIED",
            notes=payload.notes,
        )
        self.session.add(txn)
        await self.session.flush()
        return txn

    async def list_wallet_transactions(
        self,
        *,
        technician_name: str | None = None,
        transaction_type: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[TechnicianWalletTransaction], int]:
        """List paginated wallet transactions with search and filter."""
        page = max(1, page)
        page_size = max(1, min(200, page_size))
        offset = (page - 1) * page_size

        stmt = select(TechnicianWalletTransaction).where(TechnicianWalletTransaction.deleted_at.is_(None))

        if technician_name:
            stmt = stmt.where(TechnicianWalletTransaction.technician_name.ilike(f"%{technician_name.strip()}%"))

        if transaction_type:
            stmt = stmt.where(TechnicianWalletTransaction.transaction_type == transaction_type)

        if date_from:
            stmt = stmt.where(TechnicianWalletTransaction.transaction_date >= date_from)

        if date_to:
            stmt = stmt.where(TechnicianWalletTransaction.transaction_date <= date_to)

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await self.session.execute(count_stmt)).scalar() or 0

        stmt = stmt.order_by(TechnicianWalletTransaction.transaction_date.desc(), TechnicianWalletTransaction.created_at.desc()).limit(page_size).offset(offset)
        res = await self.session.execute(stmt)
        return list(res.scalars().all()), total

    async def get_technician_wallet_summaries(self) -> list[TechnicianWalletSummary]:
        """Calculate live wallet cash balances across all service technicians."""
        # 1. Fetch distinct technicians from master
        tech_stmt = select(Technician).where(Technician.deleted_at.is_(None)).order_by(Technician.name.asc())
        tech_res = await self.session.execute(tech_stmt)
        technicians = tech_res.scalars().all()

        # 2. Aggregate transactions grouped by technician_name
        agg_stmt = (
            select(
                TechnicianWalletTransaction.technician_name,
                func.sum(
                    case((TechnicianWalletTransaction.transaction_type == "COLLECTION", TechnicianWalletTransaction.amount), else_=0.0)
                ).label("total_collected"),
                func.sum(
                    case((TechnicianWalletTransaction.transaction_type == "HANDOVER_DEPOSIT", TechnicianWalletTransaction.amount), else_=0.0)
                ).label("total_deposited"),
                func.sum(
                    case((TechnicianWalletTransaction.transaction_type == "FIELD_EXPENSE", TechnicianWalletTransaction.amount), else_=0.0)
                ).label("total_expenses"),
                func.max(TechnicianWalletTransaction.transaction_date).label("last_date"),
            )
            .where(
                TechnicianWalletTransaction.deleted_at.is_(None),
                TechnicianWalletTransaction.status == "VERIFIED",
            )
            .group_by(TechnicianWalletTransaction.technician_name)
        )
        agg_res = await self.session.execute(agg_stmt)
        agg_rows = {row.technician_name.strip().lower(): row for row in agg_res.all()}

        summaries: list[TechnicianWalletSummary] = []
        for t in technicians:
            key = t.name.strip().lower()
            agg = agg_rows.pop(key, None)

            coll = float(agg.total_collected or 0.0) if agg else 0.0
            dep = float(agg.total_deposited or 0.0) if agg else 0.0
            exp = float(agg.total_expenses or 0.0) if agg else 0.0
            balance = round(coll - dep - exp, 2)
            last_dt = agg.last_date if agg else None

            status = "CLEAR"
            if balance > 0:
                status = "PENDING_DEPOSIT"
            elif balance < 0:
                status = "REIMBURSEMENT_DUE"

            summaries.append(
                TechnicianWalletSummary(
                    technician_id=t.id,
                    technician_name=t.name,
                    technician_mobile=t.mobile,
                    total_collected=coll,
                    total_deposited=dep,
                    total_expenses=exp,
                    net_wallet_balance=balance,
                    status=status,
                    last_transaction_date=last_dt,
                )
            )

        # Include any technicians in transactions not in master
        for key, agg in agg_rows.items():
            coll = float(agg.total_collected or 0.0)
            dep = float(agg.total_deposited or 0.0)
            exp = float(agg.total_expenses or 0.0)
            balance = round(coll - dep - exp, 2)

            status = "CLEAR"
            if balance > 0:
                status = "PENDING_DEPOSIT"
            elif balance < 0:
                status = "REIMBURSEMENT_DUE"

            summaries.append(
                TechnicianWalletSummary(
                    technician_id=None,
                    technician_name=agg.technician_name,
                    technician_mobile=None,
                    total_collected=coll,
                    total_deposited=dep,
                    total_expenses=exp,
                    net_wallet_balance=balance,
                    status=status,
                    last_transaction_date=agg.last_date,
                )
            )

        return summaries

    async def get_metrics(self) -> TechnicianOperationsMetrics:
        """Calculate high level operations KPI metrics."""
        # Active gatepasses
        active_gp = (
            await self.session.execute(
                select(func.count(TechnicianGatepass.id)).where(
                    TechnicianGatepass.status.in_(["ISSUED", "PARTIALLY_RETURNED"]),
                    TechnicianGatepass.deleted_at.is_(None),
                )
            )
        ).scalar() or 0

        # Pending reconciliations
        pending_rec = (
            await self.session.execute(
                select(func.count(TechnicianGatepass.id)).where(
                    TechnicianGatepass.so_required.is_(True),
                    TechnicianGatepass.so_created.is_(False),
                    TechnicianGatepass.deleted_at.is_(None),
                )
            )
        ).scalar() or 0

        # Active warranties
        active_warr = (
            await self.session.execute(
                select(func.count(MachineWarranty.id)).where(
                    MachineWarranty.warranty_end_date >= date.today(),
                    MachineWarranty.status.in_(["UNDER_WARRANTY", "EXTENDED_AMC"]),
                    MachineWarranty.deleted_at.is_(None),
                )
            )
        ).scalar() or 0

        # Total wallet cash held across all technicians
        summaries = await self.get_technician_wallet_summaries()
        total_cash = sum(s.net_wallet_balance for s in summaries if s.net_wallet_balance > 0)

        return TechnicianOperationsMetrics(
            active_gatepasses=active_gp,
            pending_reconciliations=pending_rec,
            pending_sales_orders=pending_rec,
            total_wallet_cash_held=round(total_cash, 2),
            total_warranties_active=active_warr,
        )
