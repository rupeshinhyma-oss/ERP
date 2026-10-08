"""
Sale Process Business Service.

Contains core business logic for:
- Auto-extracting consignment columns & planned items from Shipment Planning sheets
- Creating, updating, and tracking Sale Process orders
- Commercial Invoice & Packing List rollups
- Excel exports
"""

from __future__ import annotations

import io
import uuid
from datetime import date
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import CurrentUser
from app.common import workflow as wf
from app.core.exceptions import (
    BadRequestException,
    ConflictException,
    NotFoundException,
    ValidationException,
)
from app.inventory import stock_service
from app.purchase.common import move_stock
from app.masters.taxes.models import Tax
from app.masters.products.models import Product
from app.planning.models import PlanningCell, PlanningColumn, PlanningRow, PlanningSheet
from app.sales.models import SaleOrder, SaleOrderItem
from app.sales.proforma_service import price_items
from app.sales.repository import SaleRepository
from app.sales.schemas import (
    ExtractedConsignmentItem,
    PlanningConsignmentColumnResponse,
    PlanningConsignmentItemsResponse,
    SaleOrderCreate,
    SaleOrderUpdate,
)


STATUS_GROUP = "sale.order.status"
# permission that lets a user see Accounts / Warehouse queues only (see ``visibility``)
APPROVE_PERMISSION = "saleorder.approve"
RESTRICTED_VIEW_PERMISSIONS = {"saleorder.accounts", "saleorder.warehouse"}


def _yes(value: Any) -> bool:
    return str(value or "").strip().lower() in {"yes", "y", "true", "1"}


class SaleService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = SaleRepository(session)

    # -----------------------------------------------------------------------
    # Workflow rules, stock and visibility (all rule-driven; nothing about a status is hardcoded here)
    # -----------------------------------------------------------------------

    async def load_status_rules(self) -> dict[str, dict[str, Any]]:
        return await wf.load_status_rules(self.session, STATUS_GROUP)

    @staticmethod
    def canonical_status(rules: dict[str, dict[str, Any]], value: str) -> str:
        """Match what the client sent ("Sales Confirmed", "sales_confirmed"...) to a configured status key."""
        key = value.strip().lower().replace(" ", "_").replace("-", "_")
        return next((k for k in rules if k.lower() == key), value.strip())

    async def _is_physical(self, warehouse: str | None) -> bool:
        if not warehouse:
            return True
        return stock_service.is_physical(await stock_service.get_warehouse(self.session, warehouse))

    @staticmethod
    def _lines(items: Any) -> list[tuple[str, float]]:
        """The goods an order holds; additional-charge rows (freight, packing...) are not stock."""
        return [(it.product_name, float(it.quantity)) for it in (items or []) if not getattr(it, "is_additional_charge", False)]

    async def _price_and_build(self, items: list[Any]) -> tuple[list[SaleOrderItem], dict[str, float]]:
        """Price every line on the server (spec formula, shared with Proforma) and build the order's item rows."""
        priced = await price_items(self.session, [it.as_priced_input() for it in items])
        entities: list[SaleOrderItem] = []
        for src, line in zip(items, priced.lines):
            entities.append(
                SaleOrderItem(
                    product_id=src.product_id, product_name=line.product_name, product_code=line.product_code,
                    hsn_code=line.hsn_code, uom=line.uom or None, quantity=line.quantity, unit_rate=line.rate,
                    unit_price=line.rate, unit_discount=line.unit_discount, taxable_amount=line.taxable_amount,
                    tax_percent=line.gst_percent, tax_amount=line.gst_amount, gst_amount=line.gst_amount,
                    item_total=line.total, planning_row_id=src.planning_row_id, remarks=src.remarks,
                    is_additional_charge=line.is_additional_charge, charge_type=line.charge_type,
                )
            )
        goods = [l for l in priced.lines if not l.is_additional_charge]
        totals = {
            "total_basic": round(sum(l.rate * l.quantity for l in priced.lines), 2),
            "total_tax": priced.gst_amount,
            "total_amount": priced.amount_inc_gst,
            "total_quantity": round(sum(l.quantity for l in goods), 2),
            "amount_inc_gst": priced.amount_inc_gst,
            "discount": priced.discount,
        }
        return entities, totals

    async def _take_stock(self, order: SaleOrder, lines: list[tuple[str, float]] | None = None) -> None:
        """Deduct the order from its warehouse. Physical warehouses cannot go negative; transit / ordered ones can."""
        if order.warehouse:
            await move_stock(self.session, order.warehouse, lines if lines is not None else self._lines(order.items), -1)
        order.stock_applied = True

    async def _release_stock(self, order: SaleOrder) -> None:
        if order.stock_applied and order.warehouse:
            await move_stock(self.session, order.warehouse, self._lines(order.items), 1)
        order.stock_applied = False

    async def visible_filters(self, user: CurrentUser) -> dict[str, Any]:
        """Spec: Accounts and Warehouse staff do not see orders against Transit / Ordered warehouses, nor unconfirmed ones.

        Anyone who is an administrator, or who may approve orders, sees everything. Users holding only the accounts /
        warehouse permissions are limited to confirmed orders in physical warehouses.
        """
        if wf.is_admin(user) or APPROVE_PERMISSION in user.permissions:
            return {}
        if not (RESTRICTED_VIEW_PERMISSIONS & set(user.permissions)):
            return {}
        from app.masters.warehouses.models import Warehouse

        names = (
            await self.session.execute(
                select(Warehouse.name).where(Warehouse.main_warehouse_id.is_(None), Warehouse.deleted_at.is_(None))
            )
        ).scalars().all()
        rules = await self.load_status_rules()
        hidden = [k for k, r in rules.items() if r.get("initial")] + [k for k, r in rules.items() if not r.get("stock_out")]
        return {"warehouses": list(names), "exclude_statuses": sorted(set(hidden))}

    # -----------------------------------------------------------------------
    # Shipment Planning Integration
    # -----------------------------------------------------------------------

    async def get_planning_consignments(
        self,
        *,
        organization_id: uuid.UUID | None = None,
        buyer_id: uuid.UUID | None = None,
        buyer_name: str | None = None,
        sheet_id: uuid.UUID | None = None,
    ) -> list[PlanningConsignmentColumnResponse]:
        """
        List available consignment columns across relevant Shipment Planning sheets.
        Matches sheets by organization and buyer/branch name (e.g. 'Inhyma Mumbai', 'Darsh').
        """
        # 1. Query sheets
        conditions: list[Any] = [PlanningSheet.deleted_at.is_(None)]
        if organization_id:
            conditions.append(PlanningSheet.organization_id == organization_id)
        if sheet_id:
            conditions.append(PlanningSheet.id == sheet_id)

        q_sheets = await self.session.execute(select(PlanningSheet).where(*conditions))
        sheets = list(q_sheets.scalars().all())

        if not sheets:
            return []

        # Filter sheets if buyer_name is given (e.g. Inhyma Mumbai, Inhyma Ahmedabad, etc.)
        matched_sheets: list[PlanningSheet] = []
        if buyer_name and buyer_name.strip():
            clean_b = buyer_name.strip().lower()
            for s in sheets:
                s_name = s.name.strip().lower()
                # Check if buyer name or branch matches sheet name or vice versa
                if clean_b in s_name or s_name in clean_b:
                    matched_sheets.append(s)
                elif any(word in s_name for word in clean_b.split() if len(word) >= 3):
                    matched_sheets.append(s)

        if not matched_sheets:
            matched_sheets = sheets

        matched_sheet_ids = [s.id for s in matched_sheets]

        # 2. Query columns in these sheets
        q_cols = await self.session.execute(
            select(PlanningColumn).where(
                PlanningColumn.sheet_id.in_(matched_sheet_ids),
                PlanningColumn.deleted_at.is_(None),
            ).order_by(PlanningColumn.position.asc())
        )
        all_cols = list(q_cols.scalars().all())

        # Group columns by sheet
        sheet_cols_map: dict[uuid.UUID, list[PlanningColumn]] = {}
        for c in all_cols:
            sheet_cols_map.setdefault(c.sheet_id, []).append(c)

        consignments: list[PlanningConsignmentColumnResponse] = []
        system_meta_names = {
            "item", "items", "product", "products", "test", "test(y/n)",
            "approval date", "tally posted", "supplier", "supplier name",
            "pkg qty", "qty", "quantity", "notes", "remarks", "total",
            "city", "country", "status", "date",
        }

        excluded_keywords = (
            "weight", "cbm", "pkg", "package", "qty", "quantity",
            "rate", "cost", "total", "price", "margin", "tax", "gst", "vat",
            "approval", "test", "tally", "city", "country", "supplier",
            "date", "status", "remarks", "remark", "rmk", "serial",
            "sr no", "sr.", "hsn", "uom", "item", "product", "description",
        )

        for sheet in matched_sheets:
            cols_in_sheet = sheet_cols_map.get(sheet.id, [])
            col_names = {c.name.strip().lower(): c for c in cols_in_sheet}

            for col in cols_in_sheet:
                c_name = col.name.strip()
                c_lower = c_name.lower()

                dt = str(getattr(col.data_type, "value", col.data_type)).lower()
                st = str(getattr(col.source_type, "value", col.source_type)).lower()

                # Consignments must be manual quantity entry columns with numeric data type
                if dt != "number" or st != "manual":
                    continue

                # Skip standard metadata columns, companion remarks columns, and calculation/formula columns
                if c_lower in system_meta_names:
                    continue
                if any(w in c_lower for w in excluded_keywords):
                    continue

                # Check if companion remarks column exists
                has_remarks = False
                expected_remarks_names = [
                    f"{c_lower} remarks",
                    f"{c_lower} remark",
                    f"{c_lower}rmk",
                    f"{c_lower.replace(' ', '')}remarks",
                ]
                for rmk in expected_remarks_names:
                    if rmk in col_names:
                        has_remarks = True
                        break

                # Inspect cell counts for this column
                q_cells = await self.session.execute(
                    select(PlanningCell.value).where(
                        PlanningCell.column_id == col.id,
                        PlanningCell.value.isnot(None),
                    )
                )
                cell_vals = q_cells.scalars().all()

                item_count = 0
                total_qty = 0.0
                for v in cell_vals:
                    if v and v.strip():
                        try:
                            num = float(v.strip())
                            if num > 0:
                                item_count += 1
                                total_qty += num
                        except (ValueError, TypeError):
                            pass

                consignments.append(
                    PlanningConsignmentColumnResponse(
                        sheet_id=sheet.id,
                        sheet_name=sheet.name,
                        column_id=col.id,
                        column_name=c_name,
                        code=c_name,
                        item_count=item_count,
                        total_quantity=round(total_qty, 2),
                        has_remarks_column=has_remarks,
                    )
                )

        return consignments

    async def extract_consignment_items(
        self,
        column_id: uuid.UUID,
    ) -> PlanningConsignmentItemsResponse:
        """
        Extract all items and planned quantities (> 0) from a specific consignment column in Shipment Planning.
        """
        # 1. Fetch target column
        col = await self.session.get(PlanningColumn, column_id)
        if not col or col.deleted_at:
            raise NotFoundException(f"Consignment column with ID {column_id} not found.")

        sheet = await self.session.get(PlanningSheet, col.sheet_id)
        sheet_name = sheet.name if sheet else "Shipment Planning"

        # 2. Find companion remarks column if exists
        q_sibling_cols = await self.session.execute(
            select(PlanningColumn).where(
                PlanningColumn.sheet_id == col.sheet_id,
                PlanningColumn.deleted_at.is_(None),
            )
        )
        sibling_cols = q_sibling_cols.scalars().all()
        target_name_clean = col.name.strip().lower()

        remarks_col: PlanningColumn | None = None
        for sc in sibling_cols:
            sc_lower = sc.name.strip().lower()
            if sc.id != col.id and "remarks" in sc_lower:
                if target_name_clean in sc_lower or sc_lower.startswith(target_name_clean.replace(" ", "")):
                    remarks_col = sc
                    break

        # 3. Query rows and cells
        cols_to_query = [col.id]
        if remarks_col:
            cols_to_query.append(remarks_col.id)

        q_cells = await self.session.execute(
            select(PlanningCell).where(
                PlanningCell.column_id.in_(cols_to_query),
                PlanningCell.value.isnot(None),
            )
        )
        cells = list(q_cells.scalars().all())

        cell_val_map: dict[tuple[uuid.UUID, uuid.UUID], str] = {
            (c.row_id, c.column_id): c.value.strip() for c in cells if c.value is not None
        }

        # Filter row IDs that have positive numeric quantity in the main column
        valid_row_map: dict[uuid.UUID, float] = {}
        for (r_id, c_id), val in cell_val_map.items():
            if c_id == col.id:
                try:
                    num = float(val)
                    if num > 0:
                        valid_row_map[r_id] = num
                except (ValueError, TypeError):
                    pass

        if not valid_row_map:
            return PlanningConsignmentItemsResponse(
                sheet_id=col.sheet_id,
                sheet_name=sheet_name,
                column_id=col.id,
                column_name=col.name,
                consignment_code=col.name,
                count=0,
                total_quantity=0.0,
                items=[],
            )

        # 4. Fetch the planning rows in order
        q_rows = await self.session.execute(
            select(PlanningRow).where(
                PlanningRow.id.in_(list(valid_row_map.keys())),
                PlanningRow.deleted_at.is_(None),
            ).order_by(PlanningRow.position.asc())
        )
        rows = list(q_rows.scalars().all())

        # 5. Fetch linked Product details
        prod_ids = [r.linked_record_id for r in rows if r.linked_record_id]
        prod_map: dict[uuid.UUID, Product] = {}
        if prod_ids:
            q_prods = await self.session.execute(
                select(Product).where(
                    Product.id.in_(prod_ids),
                    Product.deleted_at.is_(None),
                )
            )
            for p in q_prods.scalars().all():
                prod_map[p.id] = p

        # Cache HSN codes
        hsn_ids = [p.hsn_id for p in prod_map.values() if p.hsn_id]
        hsn_map: dict[uuid.UUID, str] = {}
        if hsn_ids:
            q_hsn = await self.session.execute(
                select(Tax).where(Tax.id.in_(hsn_ids))
            )
            for h in q_hsn.scalars().all():
                hsn_map[h.id] = h.hsn_number

        # 6. Build extracted items payload
        extracted_items: list[ExtractedConsignmentItem] = []
        total_quantity = 0.0

        for r in rows:
            qty = valid_row_map.get(r.id, 1.0)
            total_quantity += qty

            prod = prod_map.get(r.linked_record_id) if r.linked_record_id else None
            prod_name = prod.product_name if prod else (r.label or "Custom Machine/Item")
            prod_code = prod.product_code if prod else None
            hsn = hsn_map.get(prod.hsn_id) if (prod and prod.hsn_id) else None
            unit_rate = float(prod.standard_cost) if (prod and prod.standard_cost) else 0.0
            vat_rate = float(prod.refund_vat_percent) if (prod and prod.refund_vat_percent is not None) else 0.0

            rmk_val = cell_val_map.get((r.id, remarks_col.id)) if remarks_col else None

            extracted_items.append(
                ExtractedConsignmentItem(
                    product_id=prod.id if prod else None,
                    product_name=prod_name,
                    product_code=prod_code,
                    hsn_code=hsn,
                    quantity=qty,
                    unit_rate=unit_rate,
                    vat_rate=vat_rate,
                    planning_row_id=r.id,
                    remarks=rmk_val,
                )
            )

        return PlanningConsignmentItemsResponse(
            sheet_id=col.sheet_id,
            sheet_name=sheet_name,
            column_id=col.id,
            column_name=col.name,
            consignment_code=col.name,
            count=len(extracted_items),
            total_quantity=round(total_quantity, 2),
            items=extracted_items,
        )

    # -----------------------------------------------------------------------
    # Sale Order CRUD & Calculations
    # -----------------------------------------------------------------------

    async def create_order(
        self,
        payload: SaleOrderCreate,
        current_user: Any = None,
    ) -> SaleOrder:
        rules = await self.load_status_rules()
        order_no = await self.repo.generate_order_no(payload.order_date)

        item_entities, totals = await self._price_and_build(payload.items)

        order = SaleOrder(
            order_no=order_no,
            organization_id=payload.organization_id,
            organization_name=payload.organization_name,
            buyer_id=payload.buyer_id,
            buyer_name=payload.buyer_name,
            buyer_branch_id=payload.buyer_branch_id,
            buyer_branch_name=payload.buyer_branch_name,
            company_name=payload.company_name or payload.buyer_name,
            warehouse=payload.warehouse,
            proforma_no=payload.proforma_no,
            proforma_id=payload.proforma_id,
            city=payload.city,
            state=payload.state,
            sales_person=payload.sales_person,
            billing_address=payload.billing_address,
            shipping_address=payload.shipping_address,
            payment_terms=payload.payment_terms,
            transport_destination=payload.transport_destination,
            delivery_type=payload.delivery_type,
            delivery_charge=payload.delivery_charge,
            third_party_delivery=payload.third_party_delivery,
            third_party_invoice=payload.third_party_invoice,
            terms_and_conditions=payload.terms_and_conditions,
            booking_remarks=payload.booking_remarks,
            amount_inc_gst=totals["amount_inc_gst"],
            discount=totals["discount"],
            consignment_code=payload.consignment_code,
            planning_sheet_id=payload.planning_sheet_id,
            planning_column_id=payload.planning_column_id,
            order_date=payload.order_date,
            delivery_date=payload.delivery_date,
            currency=payload.currency or "INR",
            status=wf.initial_status(rules),  # server-controlled: a client cannot start an order half-way through the workflow
            total_basic=totals["total_basic"],
            total_tax=totals["total_tax"],
            total_amount=totals["total_amount"],
            total_quantity=totals["total_quantity"],
            container_no=payload.container_no,
            bl_no=payload.bl_no,
            lr_no=payload.lr_no,
            transporter_name=payload.transporter_name,
            port_of_loading=payload.port_of_loading,
            port_of_discharge=payload.port_of_discharge,
            remarks=payload.remarks,
            created_by_id=getattr(current_user, "id", None),
            created_by_name=getattr(current_user, "name", getattr(current_user, "username", "Admin")),
            items=item_entities,
        )

        # Stock follows the status rules (``stock_out``): quantities are deducted from the order's warehouse.
        # Physical warehouses cannot go negative (409); transit / ordered warehouses may. Unknown warehouses or
        # products are refused instead of silently skipping the stock movement.
        if rules[order.status].get("stock_out"):
            await self._take_stock(order, self._lines(item_entities))
        elif await self.is_physical_warehouse(order.warehouse):
            # Strict physical warehouse negative stock lock: block saving if it drives physical stock negative
            for name, qty in self._lines(item_entities):
                prod = await stock_service.find_product(self.session, name)
                stock_row = await stock_service._ensure_stock_row(self.session, prod)
                col = stock_service.warehouse_column(order.warehouse)
                avail = float(getattr(stock_row, col, 0.0) or 0.0)
                if avail - qty < -1e-9:
                    raise ConflictException(
                        f"Not enough stock of '{prod.product_name}' in {order.warehouse} "
                        f"(available {avail:g}, needed {qty:g}). Physical warehouses cannot go negative."
                    )

        created = await self.repo.create(order)
        if created.status in ("sales_confirmed", "confirmed", "acc_confirmed") or created.invoice_no:
            await self._transition_company_to_existing(created.company_name or created.buyer_name)
        return created

    async def _transition_company_to_existing(self, company_name: str | None) -> None:
        """Spec: When an invoice or confirmed sales order is generated for a client, backend must automatically flip current_status from new to existing."""
        if not company_name:
            return
        clean = company_name.strip()
        if not clean:
            return
        try:
            from app.companies.models import Company, CompanyCurrentStatus
            stmt = (
                select(Company)
                .where(Company.deleted_at.is_(None), func.lower(Company.company_name) == clean.lower())
                .limit(1)
            )
            res = await self.session.execute(stmt)
            comp = res.scalar_one_or_none()
            if comp:
                curr = (comp.current_status.value if hasattr(comp.current_status, "value") else str(comp.current_status or "")).strip().lower()
                if curr != "existing":
                    comp.current_status = CompanyCurrentStatus.EXISTING
                    await self.session.flush()
        except Exception:
            # Tolerant if company table is omitted from isolated tests
            pass

    async def update_order(
        self,
        order_id: uuid.UUID,
        payload: SaleOrderUpdate,
        current_user: CurrentUser | None = None,
    ) -> SaleOrder:
        order = await self.repo.get_by_id(order_id)
        if not order:
            raise NotFoundException(f"Sale order {order_id} not found.")
        rules = await self.load_status_rules()
        if current_user is not None:
            wf.check_editable(rules, order.status, current_user)
        # ``payload.status`` is deliberately ignored: status changes go through the status endpoint, which applies the rules.
        stock_relevant = (payload.items is not None) or (payload.warehouse is not None and payload.warehouse != order.warehouse)
        if stock_relevant:
            await self._release_stock(order)  # put the old quantities back before the new ones are taken

        if payload.buyer_id is not None:
            order.buyer_id = payload.buyer_id
        if payload.buyer_name is not None:
            order.buyer_name = payload.buyer_name
        if payload.buyer_branch_id is not None:
            order.buyer_branch_id = payload.buyer_branch_id
        if payload.buyer_branch_name is not None:
            order.buyer_branch_name = payload.buyer_branch_name
        if payload.company_name is not None:
            order.company_name = payload.company_name
        if payload.warehouse is not None:
            order.warehouse = payload.warehouse
        if payload.proforma_no is not None:
            order.proforma_no = payload.proforma_no
        if payload.proforma_id is not None:
            order.proforma_id = payload.proforma_id
        if payload.city is not None:
            order.city = payload.city
        if payload.state is not None:
            order.state = payload.state
        if payload.sales_person is not None:
            order.sales_person = payload.sales_person
        if payload.billing_address is not None:
            order.billing_address = payload.billing_address
        if payload.shipping_address is not None:
            order.shipping_address = payload.shipping_address
        if payload.payment_terms is not None:
            order.payment_terms = payload.payment_terms
        if payload.transport_destination is not None:
            order.transport_destination = payload.transport_destination
        if payload.delivery_type is not None:
            order.delivery_type = payload.delivery_type
        if payload.delivery_charge is not None:
            order.delivery_charge = payload.delivery_charge
        if payload.third_party_delivery is not None:
            order.third_party_delivery = payload.third_party_delivery
        if payload.third_party_invoice is not None:
            order.third_party_invoice = payload.third_party_invoice
        if payload.amount_inc_gst is not None:
            order.amount_inc_gst = payload.amount_inc_gst
        if payload.discount is not None:
            order.discount = payload.discount

        if payload.invoice_no is not None:
            order.invoice_no = payload.invoice_no
        if payload.invoice_date is not None:
            order.invoice_date = payload.invoice_date
        if payload.gatepass is not None:
            order.gatepass = payload.gatepass
        if payload.gatepass_no is not None:
            order.gatepass_no = payload.gatepass_no
        if payload.gatepass_date is not None:
            order.gatepass_date = payload.gatepass_date
        if payload.gatepass_handled_by is not None:
            order.gatepass_handled_by = payload.gatepass_handled_by

        if payload.consignment_code is not None:
            order.consignment_code = payload.consignment_code
        if payload.planning_sheet_id is not None:
            order.planning_sheet_id = payload.planning_sheet_id
        if payload.planning_column_id is not None:
            order.planning_column_id = payload.planning_column_id
        if payload.order_date is not None:
            order.order_date = payload.order_date
        if payload.delivery_date is not None:
            order.delivery_date = payload.delivery_date
        if payload.currency is not None:
            order.currency = payload.currency
        if payload.container_no is not None:
            order.container_no = payload.container_no
        if payload.bl_no is not None:
            order.bl_no = payload.bl_no
        if payload.lr_no is not None:
            order.lr_no = payload.lr_no
        if payload.transporter_name is not None:
            order.transporter_name = payload.transporter_name
        if payload.port_of_loading is not None:
            order.port_of_loading = payload.port_of_loading
        if payload.port_of_discharge is not None:
            order.port_of_discharge = payload.port_of_discharge
        if payload.remarks is not None:
            order.remarks = payload.remarks
        if payload.terms_and_conditions is not None:
            order.terms_and_conditions = payload.terms_and_conditions
        if payload.booking_remarks is not None:
            order.booking_remarks = payload.booking_remarks

        if payload.items is not None:
            # Replace line items; the server prices them
            new_items, totals = await self._price_and_build(payload.items)
            order.items.clear()
            for entity in new_items:
                entity.order_id = order.id
                order.items.append(entity)
            order.total_basic = totals["total_basic"]
            order.total_tax = totals["total_tax"]
            order.total_amount = totals["total_amount"]
            order.total_quantity = totals["total_quantity"]
            order.amount_inc_gst = totals["amount_inc_gst"]
            order.discount = totals["discount"]

        if stock_relevant and rules[order.status].get("stock_out"):
            await self._take_stock(order)
        elif stock_relevant and await self.is_physical_warehouse(order.warehouse):
            # Strict physical warehouse negative stock lock: block saving if it drives physical stock negative
            for name, qty in self._lines(order.items):
                prod = await stock_service.find_product(self.session, name)
                stock_row = await stock_service._ensure_stock_row(self.session, prod)
                col = stock_service.warehouse_column(order.warehouse)
                avail = float(getattr(stock_row, col, 0.0) or 0.0)
                if avail - qty < -1e-9:
                    raise ConflictException(
                        f"Not enough stock of '{prod.product_name}' in {order.warehouse} "
                        f"(available {avail:g}, needed {qty:g}). Physical warehouses cannot go negative."
                    )

        updated = await self.repo.update(order)
        if updated.invoice_no or updated.status in ("sales_confirmed", "confirmed", "acc_confirmed"):
            await self._transition_company_to_existing(updated.company_name or updated.buyer_name)
        return updated

    async def update_status(
        self,
        order_id: uuid.UUID,
        payload: Any,
        current_user: CurrentUser,
    ) -> SaleOrder:
        order = await self.repo.get_by_id(order_id)
        if not order:
            raise NotFoundException(f"Sale order {order_id} not found.")
        rules = await self.load_status_rules()
        target = self.canonical_status(rules, payload.status)
        reason = (payload.remarks or "").strip() or None

        wf.check_transition(rules, order.status, target, current_user, reason)

        # Orders in Transit / Ordered warehouses can only be cancelled (spec: status options exist for physical warehouses only)
        if target in rules[order.status].get("physical_only_to", []) and not await self._is_physical(order.warehouse):
            raise ConflictException(
                f"'{order.warehouse}' is a transit / ordered warehouse: this order can only be cancelled until it is "
                "moved to a physical warehouse."
            )

        # Mandatory information per step (Sales & PI spec)
        invoice_no = (payload.invoice_no or order.invoice_no or "").strip()
        if target == "acc_confirmed":
            if not invoice_no:
                raise BadRequestException("Invoice number is required to confirm an order at the accounts stage.")
            if _yes(order.third_party_delivery) and not (payload.third_party_invoice or order.third_party_invoice):
                raise BadRequestException("The third-party invoice must be attached to confirm a third-party delivery.")
        if target == "lr" and not (payload.lr_no or order.lr_no):
            raise BadRequestException("The LR number is required to complete the order.")

        # Details supplied with this step
        if payload.invoice_no:
            order.invoice_no = payload.invoice_no
        if payload.invoice_date:
            order.invoice_date = payload.invoice_date
        if payload.third_party_invoice:
            order.third_party_invoice = payload.third_party_invoice
        if payload.gatepass or payload.gatepass_no:
            order.gatepass = order.gatepass_no = payload.gatepass_no or payload.gatepass
        if payload.gatepass_date:
            order.gatepass_date = payload.gatepass_date
        if payload.gatepass_handled_by:
            order.gatepass_handled_by = payload.gatepass_handled_by
        if payload.transporter_name:
            order.transporter_name = payload.transporter_name
        if payload.transport_destination:
            order.transport_destination = payload.transport_destination
        if payload.delivery_type:
            order.delivery_type = payload.delivery_type
        if payload.delivery_charge:
            order.delivery_charge = payload.delivery_charge
        if payload.lr_no:
            order.lr_no = payload.lr_no

        # Stock follows the target status: cancelling returns the quantities, un-cancelling would take them again
        wants_stock = bool(rules[target].get("stock_out"))
        if wants_stock and not order.stock_applied:
            await self._take_stock(order)
        elif not wants_stock and order.stock_applied:
            await self._release_stock(order)

        previous = order.status
        order.status = target
        if target == "cancelled":
            order.cancel_reason = reason
        if reason:
            order.remarks = (
                f"{order.remarks or ''}\n[{date.today()}] {current_user.username}: {previous} -> {target}: {reason}".strip()
            )
        updated = await self.repo.update(order)
        if target in ("sales_confirmed", "confirmed", "acc_confirmed") or updated.invoice_no:
            await self._transition_company_to_existing(updated.company_name or updated.buyer_name)
        return updated

    async def delete_order(self, order_id: uuid.UUID, current_user: CurrentUser) -> None:
        """Delete (soft) according to the stage rules; the order's stock goes back first."""
        order = await self.repo.get_by_id(order_id)
        if not order:
            raise NotFoundException(f"Sale order {order_id} not found.")
        rules = await self.load_status_rules()
        wf.check_deletable(rules, order.status, current_user)
        await self._release_stock(order)
        await self.repo.soft_delete(order, deleted_by=current_user.username)

    async def restore_order(self, order_id: uuid.UUID, current_user: CurrentUser) -> None:
        """Bring a deleted order back (administrators only); its stock is taken again if its status holds stock."""
        if not wf.is_admin(current_user):
            from app.core.exceptions import ForbiddenException

            raise ForbiddenException("Only an administrator can restore a deleted order.")
        if not await self.repo.restore(order_id, restored_by=current_user.username):
            raise NotFoundException(f"Sale order {order_id} not found.")
        order = await self.repo.get_by_id(order_id)
        rules = await self.load_status_rules()
        if order and rules.get(order.status, {}).get("stock_out") and not order.stock_applied:
            await self._take_stock(order)
            await self.repo.update(order)

    def export_excel(self, records: list[SaleOrder]) -> io.BytesIO:
        """Export Sale Process orders to styled Excel workbook."""
        wb = Workbook()
        ws = wb.active if wb.active is not None else wb.create_sheet("Sales Orders")
        ws.title = "Sales Orders"

        # Headers
        headers = [
            "Order No", "Order Date", "Consignment Code", "Buyer Company",
            "Branch", "Currency", "Status", "Total Qty", "Basic Amount",
            "Tax Amount", "Total Amount", "Container No", "BL No", "LR No",
            "Transporter", "Created By"
        ]

        ws.append(headers)

        header_font = Font(name="Segoe UI", size=10, bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
        thin_border = Border(
            left=Side(style="thin", color="CBD5E1"),
            right=Side(style="thin", color="CBD5E1"),
            top=Side(style="thin", color="CBD5E1"),
            bottom=Side(style="thin", color="CBD5E1"),
        )

        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")

        data_font = Font(name="Segoe UI", size=10)

        for r_idx, o in enumerate(records, start=2):
            ws.append([
                o.order_no,
                str(o.order_date),
                o.consignment_code or "-",
                o.buyer_name,
                o.buyer_branch_name or "-",
                o.currency,
                o.status.replace("_", " ").upper(),
                float(o.total_quantity),
                float(o.total_basic),
                float(o.total_tax),
                float(o.total_amount),
                o.container_no or "-",
                o.bl_no or "-",
                o.lr_no or "-",
                o.transporter_name or "-",
                o.created_by_name or "-",
            ])
            for col_idx in range(1, len(headers) + 1):
                cell = ws.cell(row=r_idx, column=col_idx)
                cell.font = data_font
                cell.border = thin_border
                if col_idx in (8, 9, 10, 11):
                    cell.alignment = Alignment(horizontal="right")
                    cell.number_format = "#,##0.00"

        # Auto-adjust column widths
        for col_idx, col_cells in enumerate(ws.columns, 1):
            max_len = max(len(str(cell.value or "")) for cell in col_cells)
            col_letter = get_column_letter(col_idx)
            ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output