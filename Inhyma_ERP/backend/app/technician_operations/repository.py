"""Database repository for Technician Operations, Spare Parts Gatepass, Wallet & Warranty."""

from __future__ import annotations

import calendar
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload, selectinload

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException, NotFoundException
from app.inventory import stock_service
from app.inventory.models import ProductStock
from app.masters.products.models import Product, ProductMachineSpare
from app.masters.taxes.models import Tax
from app.masters.technicians.models import Technician
from app.masters.uom.models import UnitOfMeasurement
from app.masters.warehouses.models import Warehouse
from app.sales.models import SaleOrder, SaleOrderItem
from app.technical_tasks.models import TechnicalTask
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
    TechnicianOpsLookupsResponse,
    TechnicianWalletSummary,
    WalletTransactionCreate,
    WarrantyRead,
    WarrantyRegisterPayload,
    WarrantyValidationResult,
)


def _add_months(orig_date: date, months: int) -> date:
    """Add integer months to a date, preserving day of month or clipping to month end."""
    new_year = orig_date.year + (orig_date.month + months - 1) // 12
    new_month = (orig_date.month + months - 1) % 12 + 1
    max_day = calendar.monthrange(new_year, new_month)[1]
    new_day = min(orig_date.day, max_day)
    return date(new_year, new_month, new_day)


def _parse_date_flexible(raw: Any) -> date | None:
    """Parse DD-MM-YYYY, YYYY-MM-DD, or DD/MM/YYYY strings safely."""
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    txt = str(raw).strip()
    if not txt:
        return None
    for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(txt[:10], fmt).date()
        except ValueError:
            continue
    return None


class TechnicianOperationsRepository:
    """Repository managing Gatepass, Wallet transactions, and Warranty lifecycle."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # -----------------------------------------------------------------------
    # Master Lookups
    # -----------------------------------------------------------------------

    async def get_lookups(self) -> TechnicianOpsLookupsResponse:
        """Fetch master-driven dropdown options and live physical stock balances."""
        technicians_out: list[dict[str, Any]] = []
        companies_out: list[dict[str, Any]] = []
        warehouses_out: list[dict[str, Any]] = []
        machines_out: list[dict[str, Any]] = []
        spare_parts_out: list[dict[str, Any]] = []
        cities_out: list[dict[str, Any]] = []
        tasks_out: list[dict[str, Any]] = []
        sale_orders_out: list[dict[str, Any]] = []
        serial_registry_out: list[dict[str, Any]] = []

        # 1. Technicians Master
        try:
            async with self.session.begin_nested():
                t_res = await self.session.execute(
                    select(Technician)
                    .where(Technician.deleted_at.is_(None), Technician.status == RecordStatus.ACTIVE)
                    .order_by(Technician.name.asc())
                )
                for t in t_res.scalars().all():
                    technicians_out.append({
                        "id": str(t.id),
                        "name": t.name,
                        "mobile": t.mobile,
                        "city": t.city,
                    })
        except Exception:
            pass

        # 2. Cities & States Maps + Companies Master
        city_map: dict[uuid.UUID, tuple[str, uuid.UUID | None]] = {}
        state_map: dict[uuid.UUID, str] = {}
        try:
            from app.masters.cities.models import City
            from app.masters.states.models import State

            async with self.session.begin_nested():
                st_res = await self.session.execute(select(State).where(State.deleted_at.is_(None)))
                for st in st_res.scalars().all():
                    state_map[st.id] = st.name

                ct_res = await self.session.execute(
                    select(City)
                    .where(City.deleted_at.is_(None), City.status == RecordStatus.ACTIVE)
                    .order_by(City.name.asc())
                )
                for ct in ct_res.scalars().all():
                    city_map[ct.id] = (ct.name, ct.state_id)
                    cities_out.append({
                        "id": str(ct.id),
                        "name": ct.name,
                        "state": state_map.get(ct.state_id),
                    })
        except Exception:
            pass

        try:
            from app.companies.models import Company

            async with self.session.begin_nested():
                c_res = await self.session.execute(
                    select(Company)
                    .options(noload("*"))
                    .where(Company.deleted_at.is_(None), Company.is_active.is_(True))
                    .order_by(Company.company_name.asc())
                    .limit(500)
                )
                for c in c_res.scalars().all():
                    c_city = None
                    c_state = None
                    if c.city_id and c.city_id in city_map:
                        c_city, st_id = city_map[c.city_id]
                        if st_id and st_id in state_map:
                            c_state = state_map[st_id]
                    if not c_state and c.state_id and c.state_id in state_map:
                        c_state = state_map[c.state_id]
                    if not c_city and c.town:
                        c_city = c.town
                    phone = (c.contact_calling_number or c.contact_whatsapp_number or "").strip() or None
                    companies_out.append({
                        "id": str(c.id),
                        "company_name": c.company_name,
                        "city": c_city,
                        "state": c_state,
                        "address": c.address,
                        "contact_person": c.contact_full_name,
                        "contact_phone": phone,
                        "gst_no": c.tax_id_number,
                    })
        except Exception:
            pass

        # 3. Physical Warehouses
        physical_wh_cols: list[tuple[str, str]] = []  # (warehouse_name, stock_col)
        try:
            async with self.session.begin_nested():
                wh_res = await self.session.execute(
                    select(Warehouse)
                    .options(noload("*"))
                    .where(Warehouse.deleted_at.is_(None), Warehouse.status == RecordStatus.ACTIVE)
                    .order_by(Warehouse.is_primary.desc(), Warehouse.name.asc())
                )
                for wh in wh_res.scalars().all():
                    if not stock_service.is_physical(wh):
                        continue
                    try:
                        col = stock_service.warehouse_column(wh.name)
                    except Exception:
                        continue
                    physical_wh_cols.append((wh.name, col))
                    warehouses_out.append({
                        "id": str(wh.id),
                        "name": wh.name,
                        "address": wh.address,
                        "billing_company": wh.billing_company,
                        "is_primary": bool(wh.is_primary),
                    })
        except Exception:
            pass

        # 4. Products (Machines & Spare Parts + Machine Mapping + Live Stock)
        try:
            async with self.session.begin_nested():
                uom_map: dict[uuid.UUID, str] = {}
                uom_res = await self.session.execute(select(UnitOfMeasurement))
                for u in uom_res.scalars().all():
                    uom_map[u.id] = (u.short_name or u.code or u.name or "NOS").strip()

                tax_map: dict[uuid.UUID, tuple[str, float]] = {}
                tax_res = await self.session.execute(select(Tax))
                for tx in tax_res.scalars().all():
                    tax_map[tx.id] = (tx.hsn_number, float(tx.gst_percent or 0.0))

                spare_to_machines: dict[uuid.UUID, set[str]] = {}
                pms_res = await self.session.execute(select(ProductMachineSpare))
                for link in pms_res.scalars().all():
                    spare_to_machines.setdefault(link.spare_part_id, set()).add(str(link.machine_id))

                stock_by_prod_id: dict[uuid.UUID, ProductStock] = {}
                stock_by_name: dict[str, ProductStock] = {}
                ps_res = await self.session.execute(
                    select(ProductStock).where(ProductStock.deleted_at.is_(None))
                )
                for ps in ps_res.scalars().all():
                    if ps.product_id:
                        stock_by_prod_id[ps.product_id] = ps
                    if ps.product_name_tally:
                        stock_by_name[ps.product_name_tally.strip().lower()] = ps

                p_res = await self.session.execute(
                    select(Product)
                    .options(noload("*"))
                    .where(Product.deleted_at.is_(None), Product.status == RecordStatus.ACTIVE)
                    .order_by(Product.product_name.asc())
                )
                all_active_products = list(p_res.scalars().all())

                for p in all_active_products:
                    uom_label = uom_map.get(p.uom_id, "NOS")
                    hsn_code, gst_pct = tax_map.get(p.hsn_id, (None, 18.0)) if p.hsn_id else (None, 18.0)
                    rate = (
                        float(p.standard_price)
                        if p.standard_price is not None and float(p.standard_price) > 0
                        else (float(p.standard_cost) if p.standard_cost is not None else 0.0)
                    )
                    ps_row = (
                        stock_by_prod_id.get(p.id)
                        or stock_by_name.get((p.product_name_tally or "").strip().lower())
                        or stock_by_name.get((p.product_name or "").strip().lower())
                    )
                    wh_stocks: dict[str, float] = {}
                    for wh_name, wh_col in physical_wh_cols:
                        wh_stocks[wh_name] = float(getattr(ps_row, wh_col, 0.0) or 0.0) if ps_row is not None else 0.0

                    compat_ids = set(spare_to_machines.get(p.id, set()))
                    if isinstance(p.applicable_machine_ids, list):
                        for mid in p.applicable_machine_ids:
                            if mid:
                                compat_ids.add(str(mid))

                    p_type_norm = (p.product_type or "Machine").strip().lower()
                    is_spare = ("spare" in p_type_norm) or (p.id in spare_to_machines) or bool(compat_ids)

                    entry = {
                        "id": str(p.id),
                        "product_code": p.product_code,
                        "product_name": p.product_name,
                        "product_type": p.product_type or "Machine",
                        "is_spare_part": is_spare,
                        "uom": uom_label,
                        "unit_rate": rate,
                        "hsn_code": hsn_code,
                        "gst_percent": gst_pct,
                        "compatible_machine_ids": sorted(compat_ids),
                        "stock_by_warehouse": wh_stocks,
                    }
                    if not is_spare or p_type_norm == "machine":
                        machines_out.append(entry)
                    spare_parts_out.append(entry)

                # Sort spare parts so explicit Spare Parts appear before Machines
                spare_parts_out.sort(key=lambda x: (0 if x["is_spare_part"] else 1, x["product_name"].lower()))
        except Exception:
            pass

        # 5. Recent Active / Open Technical Tasks
        try:
            async with self.session.begin_nested():
                tt_res = await self.session.execute(
                    select(TechnicalTask)
                    .options(noload("*"))
                    .where(
                        TechnicalTask.deleted_at.is_(None),
                        func.lower(TechnicalTask.status) != "cancel",
                    )
                    .order_by(TechnicalTask.created_at.desc())
                    .limit(200)
                )
                for tt in tt_res.scalars().all():
                    tasks_out.append({
                        "id": str(tt.id),
                        "task_number": tt.task_number,
                        "company_name": tt.company_name,
                        "machine_model": tt.machine_model,
                        "serial_number": tt.serial_number,
                        "task_allotted_to": tt.task_allotted_to,
                        "service_type": tt.service_type,
                        "task_type": tt.task_type,
                        "status": tt.status,
                        "city": tt.city,
                        "contact_person": tt.contact_person_name,
                        "contact_phone": tt.contact_phone,
                        "task_description": tt.task_description,
                    })
        except Exception:
            pass

        # 6. Recent Non-Cancelled Sales Orders
        try:
            async with self.session.begin_nested():
                so_res = await self.session.execute(
                    select(SaleOrder)
                    .options(selectinload(SaleOrder.items))
                    .where(
                        SaleOrder.deleted_at.is_(None),
                        func.lower(SaleOrder.status) != "cancelled",
                    )
                    .order_by(SaleOrder.created_at.desc())
                    .limit(200)
                )
                seen_serials: set[str] = set()
                for so in so_res.scalars().all():
                    sale_orders_out.append({
                        "id": str(so.id),
                        "order_no": so.order_no,
                        "company_name": so.company_name or so.buyer_name,
                        "order_date": str(so.order_date),
                        "warehouse": so.warehouse,
                        "total_amount": float(so.total_amount or so.amount_inc_gst or 0.0),
                        "status": so.status,
                        "invoice_no": so.invoice_no,
                    })
                    inv_dt = _parse_date_flexible(so.invoice_date) or _parse_date_flexible(so.order_date) or date.today()
                    end_dt = _add_months(inv_dt, 12)
                    for item in so.items or []:
                        if isinstance(item.serial_numbers, list):
                            for raw_sn in item.serial_numbers:
                                sn = str(raw_sn or "").strip().upper()
                                if sn and sn not in seen_serials:
                                    seen_serials.add(sn)
                                    serial_registry_out.append({
                                        "serial_number": sn,
                                        "machine_model": item.product_name,
                                        "company_name": so.company_name or so.buyer_name,
                                        "invoice_number": so.invoice_no or so.order_no,
                                        "invoice_date": inv_dt.isoformat(),
                                        "warranty_end_date": end_dt.isoformat(),
                                        "is_covered": date.today() <= end_dt,
                                        "source": "SALES_ORDER",
                                    })
        except Exception:
            pass

        # 7. Registered Warranties (override SO fallback serials with explicit warranty records)
        try:
            async with self.session.begin_nested():
                w_res = await self.session.execute(
                    select(MachineWarranty)
                    .where(MachineWarranty.deleted_at.is_(None))
                    .order_by(MachineWarranty.invoice_date.desc())
                    .limit(300)
                )
                by_sn = {r["serial_number"]: r for r in serial_registry_out}
                for w in w_res.scalars().all():
                    sn = w.serial_number.strip().upper()
                    by_sn[sn] = {
                        "serial_number": sn,
                        "machine_model": w.machine_model,
                        "company_name": w.company_name,
                        "invoice_number": w.invoice_number,
                        "invoice_date": w.invoice_date.isoformat() if w.invoice_date else None,
                        "warranty_end_date": w.warranty_end_date.isoformat() if w.warranty_end_date else None,
                        "is_covered": w.is_currently_covered(),
                        "source": "WARRANTY_REGISTRY",
                    }
                serial_registry_out = sorted(by_sn.values(), key=lambda r: r["serial_number"])
        except Exception:
            pass

        return TechnicianOpsLookupsResponse(
            technicians=technicians_out,
            companies=companies_out,
            warehouses=warehouses_out,
            machines=machines_out,
            spare_parts=spare_parts_out,
            cities=cities_out,
            technical_tasks=tasks_out,
            sale_orders=sale_orders_out,
            serial_registry=serial_registry_out,
        )

    # -----------------------------------------------------------------------
    # Machine Warranty
    # -----------------------------------------------------------------------

    async def register_warranty(self, payload: WarrantyRegisterPayload) -> MachineWarranty:
        """Register a new machine warranty policy (reviving soft-deleted serial if present)."""
        clean_serial = payload.serial_number.strip().upper()
        existing = await self.get_warranty_by_serial(clean_serial)
        if existing is not None:
            raise BadRequestException(f"Machine with serial number '{clean_serial}' is already registered")

        end_date = _add_months(payload.invoice_date, payload.warranty_months)
        is_active = date.today() <= end_date
        status = "UNDER_WARRANTY" if is_active else "OUT_OF_WARRANTY"

        prod_id = payload.product_id
        if prod_id is None and payload.machine_model.strip():
            try:
                async with self.session.begin_nested():
                    p = (
                        await self.session.execute(
                            select(Product.id).where(
                                Product.deleted_at.is_(None),
                                func.lower(Product.product_name) == payload.machine_model.strip().lower(),
                            ).limit(1)
                        )
                    ).scalar_one_or_none()
                    if p:
                        prod_id = p
            except Exception:
                pass

        comp_id = payload.company_id
        if comp_id is None and payload.company_name.strip():
            try:
                from app.companies.models import Company

                async with self.session.begin_nested():
                    c = (
                        await self.session.execute(
                            select(Company.id).where(
                                Company.deleted_at.is_(None),
                                func.lower(Company.company_name) == payload.company_name.strip().lower(),
                            ).limit(1)
                        )
                    ).scalar_one_or_none()
                    if c:
                        comp_id = c
            except Exception:
                pass

        # Check if a soft-deleted row holds the unique serial_number
        soft_deleted = (
            await self.session.execute(
                select(MachineWarranty).where(
                    func.upper(MachineWarranty.serial_number) == clean_serial,
                    MachineWarranty.deleted_at.is_not(None),
                )
            )
        ).scalar_one_or_none()

        if soft_deleted is not None:
            soft_deleted.deleted_at = None
            soft_deleted.machine_model = payload.machine_model.strip()
            soft_deleted.product_id = prod_id
            soft_deleted.company_name = payload.company_name.strip()
            soft_deleted.company_id = comp_id
            soft_deleted.invoice_number = payload.invoice_number.strip() if payload.invoice_number else None
            soft_deleted.invoice_date = payload.invoice_date
            soft_deleted.warranty_months = payload.warranty_months
            soft_deleted.warranty_end_date = end_date
            soft_deleted.status = status
            soft_deleted.contact_person = payload.contact_person
            soft_deleted.contact_phone = payload.contact_phone
            soft_deleted.installation_city = payload.installation_city
            soft_deleted.notes = payload.notes
            await self.session.flush()
            return soft_deleted

        warranty = MachineWarranty(
            serial_number=clean_serial,
            machine_model=payload.machine_model.strip(),
            product_id=prod_id,
            company_name=payload.company_name.strip(),
            company_id=comp_id,
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

    async def _find_serial_in_sales_orders(self, serial: str) -> dict[str, Any] | None:
        """Fallback lookup scanning SaleOrderItem.serial_numbers for machines sold on Sales Orders."""
        clean = serial.strip().upper()
        if not clean:
            return None
        try:
            async with self.session.begin_nested():
                stmt = (
                    select(SaleOrderItem, SaleOrder)
                    .join(SaleOrder, SaleOrderItem.order_id == SaleOrder.id)
                    .where(
                        SaleOrder.deleted_at.is_(None),
                        func.lower(SaleOrder.status) != "cancelled",
                        SaleOrderItem.serial_numbers.is_not(None),
                    )
                    .order_by(SaleOrder.created_at.desc())
                )
                rows = (await self.session.execute(stmt)).all()
                for item, order in rows:
                    serials = item.serial_numbers if isinstance(item.serial_numbers, list) else []
                    if any(str(s or "").strip().upper() == clean for s in serials):
                        inv_dt = (
                            _parse_date_flexible(order.invoice_date)
                            or _parse_date_flexible(order.order_date)
                            or date.today()
                        )
                        end_dt = _add_months(inv_dt, 12)
                        return {
                            "serial_number": clean,
                            "machine_model": item.product_name,
                            "company_name": order.company_name or order.buyer_name,
                            "city": order.city,
                            "invoice_number": order.invoice_no or order.order_no,
                            "invoice_date": inv_dt,
                            "warranty_end_date": end_dt,
                        }
        except Exception:
            pass
        return None

    async def validate_serial(self, serial: str) -> WarrantyValidationResult:
        """Check if machine is currently under active warranty (MachineWarranty or Sales Order serials)."""
        clean_serial = serial.strip().upper()
        record = await self.get_warranty_by_serial(clean_serial)
        today = date.today()

        if record is not None:
            is_covered = record.is_currently_covered()
            days_rem = (record.warranty_end_date - today).days
            if is_covered:
                msg = (
                    f"Machine is UNDER WARRANTY ({days_rem} days remaining until {record.warranty_end_date}). "
                    "Eligible for FOC warranty spare parts replacement."
                )
            else:
                msg = (
                    f"Machine warranty EXPIRED on {record.warranty_end_date}. "
                    "Spare parts are Chargeable and require a Sales Order."
                )
            return WarrantyValidationResult(
                serial_number=record.serial_number,
                is_registered=True,
                is_covered=is_covered,
                status=record.status if is_covered else ("VOIDED" if record.status == "VOIDED" else "OUT_OF_WARRANTY"),
                company_name=record.company_name,
                machine_model=record.machine_model,
                invoice_date=record.invoice_date,
                warranty_end_date=record.warranty_end_date,
                message=msg,
            )

        # Fallback to Sales Order item serial numbers
        so_hit = await self._find_serial_in_sales_orders(clean_serial)
        if so_hit is not None:
            end_dt: date = so_hit["warranty_end_date"]
            is_covered = today <= end_dt
            days_rem = (end_dt - today).days
            status_val = "UNDER_WARRANTY" if is_covered else "OUT_OF_WARRANTY"
            if is_covered:
                msg = (
                    f"Found in Sales Order ({so_hit['invoice_number']}): UNDER WARRANTY "
                    f"({days_rem} days remaining until {end_dt}). Eligible for FOC warranty replacement."
                )
            else:
                msg = (
                    f"Found in Sales Order ({so_hit['invoice_number']}): Warranty EXPIRED on {end_dt}. "
                    "Spare parts are Chargeable and require a Sales Order."
                )
            return WarrantyValidationResult(
                serial_number=clean_serial,
                is_registered=True,
                is_covered=is_covered,
                status=status_val,
                company_name=so_hit["company_name"],
                machine_model=so_hit["machine_model"],
                invoice_date=so_hit["invoice_date"],
                warranty_end_date=end_dt,
                message=msg,
            )

        return WarrantyValidationResult(
            serial_number=clean_serial,
            is_registered=False,
            is_covered=False,
            status="NOT_REGISTERED",
            message=f"Serial '{clean_serial}' not found in Machine Registry or Sales Orders. Replacement spare parts will be Chargeable.",
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
            if status == "UNDER_WARRANTY":
                stmt = stmt.where(
                    MachineWarranty.status.in_(["UNDER_WARRANTY", "EXTENDED_AMC"]),
                    MachineWarranty.warranty_end_date >= date.today(),
                )
            elif status == "OUT_OF_WARRANTY":
                stmt = stmt.where(
                    or_(
                        MachineWarranty.status == "OUT_OF_WARRANTY",
                        MachineWarranty.warranty_end_date < date.today(),
                    )
                )
            else:
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

        stmt = stmt.order_by(MachineWarranty.invoice_date.desc(), MachineWarranty.created_at.desc()).limit(page_size).offset(offset)
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
        """Collision-safe gatepass code: GP-TECH-YYYY-NNNN."""
        year = date.today().year
        prefix = f"GP-TECH-{year}-"
        res = await self.session.execute(
            select(TechnicianGatepass.gatepass_number).where(
                TechnicianGatepass.gatepass_number.like(f"{prefix}%")
            )
        )
        max_seq = 0
        for code in res.scalars().all():
            if not code:
                continue
            tail = code[len(prefix):].split("-")[0]
            if tail.isdigit():
                max_seq = max(max_seq, int(tail))
        return f"{prefix}{max_seq + 1:04d}"

    async def _resolve_technician(
        self,
        technician_id: uuid.UUID | None,
        technician_name: str,
        technician_mobile: str | None = None,
    ) -> tuple[uuid.UUID | None, str, str | None]:
        """Resolve technician ID, canonical name, and mobile from Technicians Master if present."""
        clean_name = technician_name.strip()
        clean_mobile = technician_mobile.strip() if technician_mobile and technician_mobile.strip() else None
        try:
            async with self.session.begin_nested():
                tech: Technician | None = None
                if technician_id is not None:
                    tech = await self.session.get(Technician, technician_id)
                if tech is None and clean_name:
                    tech = (
                        await self.session.execute(
                            select(Technician)
                            .where(
                                Technician.deleted_at.is_(None),
                                func.lower(Technician.name) == clean_name.lower(),
                            )
                            .limit(1)
                        )
                    ).scalar_one_or_none()
                if tech is not None and tech.deleted_at is None:
                    return tech.id, tech.name, clean_mobile or tech.mobile
        except Exception:
            pass
        return technician_id, clean_name, clean_mobile

    async def create_gatepass(self, payload: GatepassCreate) -> TechnicianGatepass:
        """Create an Outward Spare Parts Gatepass and deduct physical warehouse stock when warehouse_name is set."""
        gp_num = await self._generate_gatepass_number()

        tech_id, tech_name, tech_mobile = await self._resolve_technician(
            payload.technician_id, payload.technician_name, payload.technician_mobile
        )

        customer_name = payload.customer_name.strip() if payload.customer_name and payload.customer_name.strip() else None
        machine_model = payload.machine_model.strip() if payload.machine_model and payload.machine_model.strip() else None
        serial_number = (
            payload.machine_serial_number.strip().upper()
            if payload.machine_serial_number and payload.machine_serial_number.strip()
            else None
        )

        # Backfill context from linked Technical Task if provided
        if payload.technical_task_id is not None:
            try:
                async with self.session.begin_nested():
                    task = await self.session.get(TechnicalTask, payload.technical_task_id)
                    if task is not None and task.deleted_at is None:
                        if not customer_name and task.company_name:
                            customer_name = task.company_name.strip()
                        if not machine_model and task.machine_model:
                            machine_model = task.machine_model.strip()
                        if not serial_number and task.serial_number:
                            serial_number = task.serial_number.strip().upper()
            except Exception:
                pass

        # Validate serial & auto-fill missing customer / machine model from registry
        is_warranty = False
        if serial_number:
            val = await self.validate_serial(serial_number)
            is_warranty = val.is_covered
            if not customer_name and val.company_name:
                customer_name = val.company_name
            if not machine_model and val.machine_model:
                machine_model = val.machine_model

        # Validate physical warehouse if supplied
        canonical_warehouse: str | None = None
        should_deduct_stock = False
        if payload.warehouse_name and payload.warehouse_name.strip():
            wh = await stock_service.get_warehouse(
                self.session, payload.warehouse_name.strip(), require_active=True
            )
            if not stock_service.is_physical(wh):
                raise BadRequestException(
                    f"Outward Technician Gatepasses can only be issued from a physical warehouse (got '{wh.name}')."
                )
            stock_service.warehouse_column(wh.name)
            canonical_warehouse = wh.name
            should_deduct_stock = True

        gatepass = TechnicianGatepass(
            gatepass_number=gp_num,
            technician_id=tech_id,
            technician_name=tech_name,
            technician_mobile=tech_mobile,
            technical_task_id=payload.technical_task_id,
            warehouse_name=canonical_warehouse,
            customer_name=customer_name,
            machine_model=machine_model,
            machine_serial_number=serial_number,
            is_warranty_service=is_warranty,
            issue_date=payload.issue_date,
            issued_by_name=payload.issued_by_name.strip(),
            purpose=payload.purpose,
            status="ISSUED",
            stock_deducted=should_deduct_stock,
            notes=payload.notes,
        )
        self.session.add(gatepass)
        await self.session.flush()

        for item in payload.items:
            prod: Product | None = None
            if should_deduct_stock:
                if item.product_id is not None:
                    prod = await self.session.get(Product, item.product_id)
                    if prod is None or prod.deleted_at is not None:
                        raise BadRequestException(f"Spare part '{item.product_name}' was not found in Product Master.")
                    if prod.status != RecordStatus.ACTIVE:
                        raise BadRequestException(f"Spare part '{prod.product_name}' is inactive in Product Master.")
                else:
                    prod = await stock_service.find_product(
                        self.session, item.product_name.strip(), require_active=True
                    )
            else:
                try:
                    async with self.session.begin_nested():
                        if item.product_id is not None:
                            prod = await self.session.get(Product, item.product_id)
                        if prod is None:
                            prod = (
                                await self.session.execute(
                                    select(Product)
                                    .options(noload("*"))
                                    .where(
                                        Product.deleted_at.is_(None),
                                        or_(
                                            func.lower(Product.product_name) == item.product_name.strip().lower(),
                                            func.lower(Product.product_name_tally) == item.product_name.strip().lower(),
                                        ),
                                    )
                                    .limit(1)
                                )
                            ).scalar_one_or_none()
                except Exception:
                    prod = None

            final_name = prod.product_name if prod is not None else item.product_name.strip()
            final_code = item.product_code or (prod.product_code if prod is not None else None)
            final_rate = item.unit_rate
            if final_rate is None and prod is not None:
                if prod.standard_price is not None and float(prod.standard_price) > 0:
                    final_rate = float(prod.standard_price)
                elif prod.standard_cost is not None:
                    final_rate = float(prod.standard_cost)

            if should_deduct_stock and canonical_warehouse:
                await stock_service.apply_stock_delta(
                    self.session,
                    product_name=final_name,
                    warehouse_name=canonical_warehouse,
                    delta=-float(item.quantity_issued),
                )

            gp_item = TechnicianGatepassItem(
                gatepass_id=gatepass.id,
                product_id=prod.id if prod is not None else item.product_id,
                product_code=final_code,
                product_name=final_name,
                uom=(item.uom or "NOS").strip() or "NOS",
                quantity_issued=float(item.quantity_issued),
                quantity_consumed=0.0,
                quantity_returned=0.0,
                stock_returned_qty=0.0,
                stock_billed_released_qty=0.0,
                unit_rate=final_rate,
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
                    TechnicianGatepass.machine_model.ilike(term),
                    TechnicianGatepass.machine_serial_number.ilike(term),
                    TechnicianGatepass.so_number.ilike(term),
                    TechnicianGatepass.warehouse_name.ilike(term),
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
        total_issued = sum(float(item.quantity_issued or 0.0) for item in gp.items)
        total_consumed = sum(float(item.quantity_consumed or 0.0) for item in gp.items)
        total_returned = sum(float(item.quantity_returned or 0.0) for item in gp.items)
        pending = max(0.0, total_issued - (total_consumed + total_returned))

        if gp.status == "CLOSED":
            reconcile_msg = "Gatepass fully closed and reconciled."
        elif gp.status == "RECONCILED":
            reconcile_msg = "Reconciled with warehouse return / warranty replacement."
        elif gp.so_required and not gp.so_created:
            chargeable_qty = round(
                sum(float(i.quantity_consumed or 0.0) for i in gp.items if float(i.quantity_consumed or 0.0) > 0 and not i.is_warranty_covered),
                2,
            )
            reconcile_msg = f"ACTION REQUIRED: Salesperson must create Sales Order for {chargeable_qty:g} chargeable consumed part(s)."
        elif pending > 0:
            reconcile_msg = f"Pending Return: {round(pending, 2):g} part(s) still in field with technician."
        else:
            reconcile_msg = "Parts returned. Ready for final review."

        return GatepassRead(
            id=gp.id,
            gatepass_number=gp.gatepass_number,
            technician_id=gp.technician_id,
            technician_name=gp.technician_name,
            technician_mobile=gp.technician_mobile,
            technical_task_id=gp.technical_task_id,
            warehouse_name=gp.warehouse_name,
            customer_name=gp.customer_name,
            machine_model=gp.machine_model,
            machine_serial_number=gp.machine_serial_number,
            is_warranty_service=gp.is_warranty_service,
            issue_date=gp.issue_date,
            issued_by_name=gp.issued_by_name,
            purpose=gp.purpose,
            status=gp.status,
            so_required=gp.so_required,
            sale_order_id=gp.sale_order_id,
            so_number=gp.so_number,
            so_created=gp.so_created,
            stock_deducted=bool(gp.stock_deducted),
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
        - Strictly validates `quantity_returned + quantity_consumed <= quantity_issued`.
        - Restores good-condition returned quantities into physical warehouse stock idempotently.
        - Flags `so_required = True` when chargeable parts were consumed without an SO.
        """
        gp = await self.get_gatepass_by_id(gatepass_id)
        if gp is None:
            raise NotFoundException("Technician gatepass not found")

        item_map = {item.id: item for item in gp.items}

        for ret_item in payload.items:
            if ret_item.item_id not in item_map:
                raise BadRequestException(f"Gatepass item '{ret_item.item_id}' does not belong to this gatepass.")
            item = item_map[ret_item.item_id]

            issued_qty = float(item.quantity_issued or 0.0)
            ret_qty = float(ret_item.quantity_returned or 0.0)
            cons_qty = float(ret_item.quantity_consumed or 0.0)

            if ret_qty < 0 or cons_qty < 0:
                raise BadRequestException("Returned and consumed quantities cannot be negative.")
            if round(ret_qty + cons_qty, 6) > round(issued_qty, 6) + 1e-6:
                raise BadRequestException(
                    f"Returned ({ret_qty:g}) + Consumed ({cons_qty:g}) cannot exceed Issued ({issued_qty:g}) "
                    f"for '{item.product_name}'."
                )

            # Determine item status cleanly
            explicit_status = (ret_item.item_status or "").strip().upper()
            is_defective_return = explicit_status in ("RETURNED_DEFECTIVE", "DAMAGED")

            if is_defective_return and ret_qty > 0:
                resolved_status = explicit_status
            elif cons_qty > 0:
                resolved_status = "CONSUMED_WARRANTY" if ret_item.is_warranty_covered else "CONSUMED_BILLED"
            elif ret_qty > 0:
                resolved_status = "RETURNED_GOOD"
            else:
                resolved_status = "ISSUED"

            # Sync physical warehouse stock for good returns (idempotent delta)
            if gp.stock_deducted and gp.warehouse_name:
                target_good_returned = 0.0 if is_defective_return else ret_qty
                prev_good_returned = float(item.stock_returned_qty or 0.0)
                delta = round(target_good_returned - prev_good_returned, 6)
                if abs(delta) > 1e-9:
                    await stock_service.apply_stock_delta(
                        self.session,
                        product_name=item.product_name,
                        warehouse_name=gp.warehouse_name,
                        delta=delta,
                    )
                    item.stock_returned_qty = target_good_returned

            item.quantity_returned = ret_qty
            item.quantity_consumed = cons_qty
            item.is_warranty_covered = ret_item.is_warranty_covered
            item.item_status = resolved_status
            if ret_item.remarks is not None:
                item.remarks = ret_item.remarks

        if payload.return_gatepass_number and payload.return_gatepass_number.strip():
            gp.return_gatepass_number = payload.return_gatepass_number.strip()
        elif not gp.return_gatepass_number:
            year = date.today().year
            gp.return_gatepass_number = f"RGP-TECH-{year}-{gp.gatepass_number.split('-')[-1]}"

        if payload.notes and payload.notes.strip():
            gp.notes = ((gp.notes or "") + f"\nReturn Notes: {payload.notes.strip()}").strip()

        has_chargeable_consumed_parts = any(
            float(i.quantity_consumed or 0.0) > 0 and not i.is_warranty_covered for i in gp.items
        )
        gp.so_required = has_chargeable_consumed_parts

        total_issued = sum(float(i.quantity_issued or 0.0) for i in gp.items)
        total_accounted = sum(float(i.quantity_consumed or 0.0) + float(i.quantity_returned or 0.0) for i in gp.items)
        all_accounted = total_accounted >= total_issued - 1e-6

        if gp.so_required and not gp.so_created:
            gp.status = "PARTIALLY_RETURNED"
        elif all_accounted:
            gp.status = "CLOSED" if gp.so_created else "RECONCILED"
        else:
            gp.status = "PARTIALLY_RETURNED"

        await self.session.flush()
        return self._to_gatepass_read(gp)

    async def link_sales_order(
        self,
        gatepass_id: uuid.UUID,
        payload: GatepassLinkSOPayload,
    ) -> GatepassRead:
        """Verify and link a real Sales Order created for consumed spare parts."""
        gp = await self.get_gatepass_by_id(gatepass_id)
        if gp is None:
            raise NotFoundException("Technician gatepass not found")

        clean_so_no = payload.sales_order_number.strip()
        so: SaleOrder | None = None
        if payload.sale_order_id is not None:
            so = await self.session.get(SaleOrder, payload.sale_order_id)
            if so is not None and so.deleted_at is not None:
                so = None
        if so is None:
            so = (
                await self.session.execute(
                    select(SaleOrder).where(
                        SaleOrder.deleted_at.is_(None),
                        func.upper(SaleOrder.order_no) == clean_so_no.upper(),
                    ).limit(1)
                )
            ).scalar_one_or_none()

        if so is None:
            raise BadRequestException(
                f"Sales Order '{clean_so_no}' does not exist in Sales Process. Please create the Sales Order first."
            )
        if (so.status or "").strip().lower() == "cancelled":
            raise BadRequestException(
                f"Sales Order '{so.order_no}' is Cancelled and cannot be used to reconcile consumed parts."
            )

        gp.sale_order_id = so.id
        gp.so_number = so.order_no
        gp.so_created = True

        # If the linked SO has already deducted stock from the same physical warehouse,
        # release the gatepass's hold on chargeable consumed parts so stock is never double-deducted.
        same_warehouse = (
            bool(gp.stock_deducted)
            and bool(gp.warehouse_name)
            and bool(so.warehouse)
            and gp.warehouse_name.strip().lower() == so.warehouse.strip().lower()
        )

        for item in gp.items:
            cons_qty = float(item.quantity_consumed or 0.0)
            if cons_qty > 0 and not item.is_warranty_covered:
                item.sales_order_number = so.order_no
                item.item_status = "CONSUMED_BILLED"
                if same_warehouse and so.stock_applied and gp.warehouse_name:
                    already_released = float(item.stock_billed_released_qty or 0.0)
                    delta = round(cons_qty - already_released, 6)
                    if delta > 1e-9:
                        await stock_service.apply_stock_delta(
                            self.session,
                            product_name=item.product_name,
                            warehouse_name=gp.warehouse_name,
                            delta=delta,
                        )
                        item.stock_billed_released_qty = cons_qty

        if payload.notes and payload.notes.strip():
            gp.notes = ((gp.notes or "") + f"\nSO Linked ({so.order_no}): {payload.notes.strip()}").strip()

        total_issued = sum(float(i.quantity_issued or 0.0) for i in gp.items)
        total_accounted = sum(float(i.quantity_consumed or 0.0) + float(i.quantity_returned or 0.0) for i in gp.items)

        if total_accounted >= total_issued - 1e-6:
            gp.status = "CLOSED"
        else:
            gp.status = "RECONCILED"

        await self.session.flush()
        return self._to_gatepass_read(gp)

    # -----------------------------------------------------------------------
    # Technician Payment & Wallet Management
    # -----------------------------------------------------------------------

    async def _generate_wallet_txn_number(self) -> str:
        """Collision-safe transaction code: TXN-TECH-YYYY-NNNN."""
        year = date.today().year
        prefix = f"TXN-TECH-{year}-"
        res = await self.session.execute(
            select(TechnicianWalletTransaction.transaction_number).where(
                TechnicianWalletTransaction.transaction_number.like(f"{prefix}%")
            )
        )
        max_seq = 0
        for code in res.scalars().all():
            if not code:
                continue
            tail = code[len(prefix):].split("-")[0]
            if tail.isdigit():
                max_seq = max(max_seq, int(tail))
        return f"{prefix}{max_seq + 1:04d}"

    async def record_wallet_transaction(
        self,
        payload: WalletTransactionCreate,
        verified_by: str | None = None,
    ) -> TechnicianWalletTransaction:
        """Record money collected on field visit, cash handover, or field expense."""
        txn_num = await self._generate_wallet_txn_number()
        tech_id, tech_name, _ = await self._resolve_technician(
            payload.technician_id, payload.technician_name, None
        )

        txn = TechnicianWalletTransaction(
            transaction_number=txn_num,
            technician_id=tech_id,
            technician_name=tech_name,
            technical_task_id=payload.technical_task_id,
            customer_name=payload.customer_name.strip() if payload.customer_name and payload.customer_name.strip() else None,
            transaction_type=payload.transaction_type,
            amount=payload.amount,
            payment_mode=payload.payment_mode,
            reference_no=payload.reference_no.strip() if payload.reference_no and payload.reference_no.strip() else None,
            transaction_date=payload.transaction_date,
            receipt_url=payload.receipt_url,
            status="VERIFIED",
            verified_by=verified_by,
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
            term = f"%{technician_name.strip()}%"
            stmt = stmt.where(
                or_(
                    TechnicianWalletTransaction.technician_name.ilike(term),
                    TechnicianWalletTransaction.customer_name.ilike(term),
                    TechnicianWalletTransaction.transaction_number.ilike(term),
                    TechnicianWalletTransaction.reference_no.ilike(term),
                )
            )

        if transaction_type:
            stmt = stmt.where(TechnicianWalletTransaction.transaction_type == transaction_type)

        if date_from:
            stmt = stmt.where(TechnicianWalletTransaction.transaction_date >= date_from)

        if date_to:
            stmt = stmt.where(TechnicianWalletTransaction.transaction_date <= date_to)

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await self.session.execute(count_stmt)).scalar() or 0

        stmt = (
            stmt.order_by(
                TechnicianWalletTransaction.transaction_date.desc(),
                TechnicianWalletTransaction.created_at.desc(),
            )
            .limit(page_size)
            .offset(offset)
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all()), total

    async def get_technician_wallet_summaries(self) -> list[TechnicianWalletSummary]:
        """Calculate live wallet cash balances across all service technicians."""
        tech_stmt = select(Technician).where(Technician.deleted_at.is_(None)).order_by(Technician.name.asc())
        tech_res = await self.session.execute(tech_stmt)
        technicians = tech_res.scalars().all()

        agg_stmt = (
            select(
                func.lower(func.trim(TechnicianWalletTransaction.technician_name)).label("tech_key"),
                func.max(TechnicianWalletTransaction.technician_name).label("display_name"),
                func.sum(
                    case(
                        (TechnicianWalletTransaction.transaction_type == "COLLECTION", TechnicianWalletTransaction.amount),
                        else_=0.0,
                    )
                ).label("total_collected"),
                func.sum(
                    case(
                        (TechnicianWalletTransaction.transaction_type == "HANDOVER_DEPOSIT", TechnicianWalletTransaction.amount),
                        else_=0.0,
                    )
                ).label("total_deposited"),
                func.sum(
                    case(
                        (TechnicianWalletTransaction.transaction_type == "FIELD_EXPENSE", TechnicianWalletTransaction.amount),
                        else_=0.0,
                    )
                ).label("total_expenses"),
                func.max(TechnicianWalletTransaction.transaction_date).label("last_date"),
            )
            .where(
                TechnicianWalletTransaction.deleted_at.is_(None),
                TechnicianWalletTransaction.status == "VERIFIED",
            )
            .group_by(func.lower(func.trim(TechnicianWalletTransaction.technician_name)))
        )
        agg_res = await self.session.execute(agg_stmt)
        agg_rows = {row.tech_key: row for row in agg_res.all() if row.tech_key}

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

        for _, agg in agg_rows.items():
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
                    technician_name=agg.display_name,
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
        active_gp = (
            await self.session.execute(
                select(func.count(TechnicianGatepass.id)).where(
                    TechnicianGatepass.status.in_(["ISSUED", "PARTIALLY_RETURNED"]),
                    TechnicianGatepass.deleted_at.is_(None),
                )
            )
        ).scalar() or 0

        pending_rec = (
            await self.session.execute(
                select(func.count(TechnicianGatepass.id)).where(
                    TechnicianGatepass.so_required.is_(True),
                    TechnicianGatepass.so_created.is_(False),
                    TechnicianGatepass.deleted_at.is_(None),
                )
            )
        ).scalar() or 0

        active_warr = (
            await self.session.execute(
                select(func.count(MachineWarranty.id)).where(
                    MachineWarranty.warranty_end_date >= date.today(),
                    MachineWarranty.status.in_(["UNDER_WARRANTY", "EXTENDED_AMC"]),
                    MachineWarranty.deleted_at.is_(None),
                )
            )
        ).scalar() or 0

        summaries = await self.get_technician_wallet_summaries()
        total_cash = sum(s.net_wallet_balance for s in summaries if s.net_wallet_balance > 0)

        return TechnicianOperationsMetrics(
            active_gatepasses=active_gp,
            pending_reconciliations=pending_rec,
            pending_sales_orders=pending_rec,
            total_wallet_cash_held=round(total_cash, 2),
            total_warranties_active=active_warr,
        )
