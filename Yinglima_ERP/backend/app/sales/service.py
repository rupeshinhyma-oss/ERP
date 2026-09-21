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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundException, ValidationException
from app.masters.hsn.models import HsnCode
from app.masters.products.models import Product
from app.planning.models import PlanningCell, PlanningColumn, PlanningRow, PlanningSheet
from app.sales.models import SaleOrder, SaleOrderItem
from app.sales.repository import SaleRepository
from app.sales.schemas import (
    ExtractedConsignmentItem,
    PlanningConsignmentColumnResponse,
    PlanningConsignmentItemsResponse,
    SaleOrderCreate,
    SaleOrderUpdate,
)


class SaleService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = SaleRepository(session)

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
                select(HsnCode).where(HsnCode.id.in_(hsn_ids))
            )
            for h in q_hsn.scalars().all():
                hsn_map[h.id] = h.code

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
        order_no = await self.repo.generate_order_no(payload.order_date)

        total_basic = 0.0
        total_tax = 0.0
        total_amount = 0.0
        total_qty = 0.0

        item_entities: list[SaleOrderItem] = []
        for it in payload.items:
            qty = float(it.quantity)
            rate = float(it.unit_rate)
            tax_pct = float(it.tax_percent)

            basic = round(qty * rate, 2)
            tax = round((basic * tax_pct) / 100.0, 2)
            item_tot = round(basic + tax, 2)

            total_basic += basic
            total_tax += tax
            total_amount += item_tot
            total_qty += qty

            item_entities.append(
                SaleOrderItem(
                    product_id=it.product_id,
                    product_name=it.product_name,
                    product_code=it.product_code,
                    hsn_code=it.hsn_code,
                    quantity=qty,
                    unit_rate=rate,
                    tax_percent=tax_pct,
                    tax_amount=tax,
                    item_total=item_tot,
                    planning_row_id=it.planning_row_id,
                    remarks=it.remarks,
                )
            )

        order = SaleOrder(
            order_no=order_no,
            organization_id=payload.organization_id,
            organization_name=payload.organization_name,
            buyer_id=payload.buyer_id,
            buyer_name=payload.buyer_name,
            buyer_branch_id=payload.buyer_branch_id,
            buyer_branch_name=payload.buyer_branch_name,
            consignment_code=payload.consignment_code,
            planning_sheet_id=payload.planning_sheet_id,
            planning_column_id=payload.planning_column_id,
            order_date=payload.order_date,
            delivery_date=payload.delivery_date,
            currency=payload.currency or "RMB",
            status=payload.status or "pending",
            total_basic=round(total_basic, 2),
            total_tax=round(total_tax, 2),
            total_amount=round(total_amount, 2),
            total_quantity=round(total_qty, 2),
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

        return await self.repo.create(order)

    async def update_order(
        self,
        order_id: uuid.UUID,
        payload: SaleOrderUpdate,
    ) -> SaleOrder:
        order = await self.repo.get_by_id(order_id)
        if not order:
            raise NotFoundException(f"Sale order {order_id} not found.")

        if payload.buyer_id is not None:
            order.buyer_id = payload.buyer_id
        if payload.buyer_name is not None:
            order.buyer_name = payload.buyer_name
        if payload.buyer_branch_id is not None:
            order.buyer_branch_id = payload.buyer_branch_id
        if payload.buyer_branch_name is not None:
            order.buyer_branch_name = payload.buyer_branch_name
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
        if payload.status is not None:
            order.status = payload.status
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

        if payload.items is not None:
            # Replace line items
            order.items.clear()
            total_basic = 0.0
            total_tax = 0.0
            total_amount = 0.0
            total_qty = 0.0

            for it in payload.items:
                qty = float(it.quantity)
                rate = float(it.unit_rate)
                tax_pct = float(it.tax_percent)

                basic = round(qty * rate, 2)
                tax = round((basic * tax_pct) / 100.0, 2)
                item_tot = round(basic + tax, 2)

                total_basic += basic
                total_tax += tax
                total_amount += item_tot
                total_qty += qty

                order.items.append(
                    SaleOrderItem(
                        order_id=order.id,
                        product_id=it.product_id,
                        product_name=it.product_name,
                        product_code=it.product_code,
                        hsn_code=it.hsn_code,
                        quantity=qty,
                        unit_rate=rate,
                        tax_percent=tax_pct,
                        tax_amount=tax,
                        item_total=item_tot,
                        planning_row_id=it.planning_row_id,
                        remarks=it.remarks,
                    )
                )

            order.total_basic = round(total_basic, 2)
            order.total_tax = round(total_tax, 2)
            order.total_amount = round(total_amount, 2)
            order.total_quantity = round(total_qty, 2)

        return await self.repo.update(order)

    async def update_status(
        self,
        order_id: uuid.UUID,
        status: str,
        remarks: str | None = None,
    ) -> SaleOrder:
        order = await self.repo.get_by_id(order_id)
        if not order:
            raise NotFoundException(f"Sale order {order_id} not found.")

        order.status = status.strip().lower()
        if remarks:
            order.remarks = f"{order.remarks or ''}\n[{date.today()}] Status updated to {status}: {remarks}".strip()

        return await self.repo.update(order)

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
