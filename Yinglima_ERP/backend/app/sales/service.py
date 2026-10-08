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
import math
import os
import uuid
from datetime import date
from typing import Any

from openpyxl import Workbook
from openpyxl.drawing.image import Image as XLImage
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.buyers.models import Buyer
from app.common.currency import get_active_rates
from app.core.exceptions import NotFoundException, ValidationException
from app.masters.hsn.models import HsnCode
from app.masters.products.models import Product
from app.masters.uom.models import UnitOfMeasurement
from app.planning.models import PlanningCell, PlanningColumn, PlanningRow, PlanningSheet
from app.purchases.local.models import LocalPurchase, LocalPurchaseItem
from app.sales.models import SaleOrder, SaleOrderItem
from app.sales.repository import SaleRepository
from app.suppliers.models import Supplier, SupplierProductLink
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

        # Filter sheets if buyer_name is given (e.g. Inhyma Mumbai, Darsh Impex, etc.)
        matched_sheets: list[PlanningSheet] = []
        if buyer_name and buyer_name.strip():
            clean_b = buyer_name.strip().lower()

            # 1. Match by Organization Link (e.g. Planning sheets created under 'Darsh Impex' organization)
            from app.masters.company_list.models import MasterCompany
            q_orgs = await self.session.execute(
                select(MasterCompany.id, MasterCompany.name).where(
                    MasterCompany.deleted_at.is_(None)
                )
            )
            matched_org_ids: set[uuid.UUID] = set()
            for org_id, org_name in q_orgs.all():
                if not org_name:
                    continue
                o_clean = org_name.strip().lower()
                if clean_b in o_clean or o_clean in clean_b or any(w in o_clean for w in clean_b.split() if len(w) >= 3):
                    matched_org_ids.add(org_id)

            for s in sheets:
                # Primary: Sheet belongs to the buyer's organization (e.g. Chennai, Mumbai under Darsh Impex)
                if s.organization_id and s.organization_id in matched_org_ids:
                    matched_sheets.append(s)
                    continue

                # Secondary: Sheet name itself mentions the buyer/branch
                s_name = s.name.strip().lower()
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

        # Map organization IDs to names for rich consignment badges
        from app.masters.company_list.models import MasterCompany
        q_org_all = await self.session.execute(
            select(MasterCompany.id, MasterCompany.name).where(
                MasterCompany.deleted_at.is_(None)
            )
        )
        org_names_map: dict[uuid.UUID, str] = {row[0]: row[1] for row in q_org_all.all() if row[1]}

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
                        organization_id=sheet.organization_id,
                        organization_name=org_names_map.get(sheet.organization_id) if sheet.organization_id else None,
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

        # Cache UOM names
        uom_ids = [p.uom_id for p in prod_map.values() if p.uom_id]
        uom_map: dict[uuid.UUID, str] = {}
        if uom_ids:
            q_uom = await self.session.execute(
                select(UnitOfMeasurement).where(UnitOfMeasurement.id.in_(uom_ids))
            )
            for u in q_uom.scalars().all():
                uom_map[u.id] = u.short_name or u.code or u.name or "NOS"

        # Fetch suppliers & purchase rates from confirmed Local Purchase (Primary Source of Truth)
        # NOTE: Local Purchase Unit Rate is the BASIC price (excluding VAT); VAT is added on top there.
        # So the CI "Unit Price(RMB) Including VAT" = unit_rate x (1 + LP vat_rate / 100).
        lp_supplier_map: dict[uuid.UUID, tuple[uuid.UUID, str, float]] = {}
        lp_vat_map: dict[uuid.UUID, float] = {}
        if prod_ids:
            q_lp = await self.session.execute(
                select(
                    LocalPurchaseItem.product_id,
                    LocalPurchase.supplier_id,
                    LocalPurchase.supplier_name,
                    LocalPurchaseItem.unit_rate,
                    LocalPurchaseItem.vat_rate,
                )
                .join(LocalPurchase, LocalPurchaseItem.purchase_id == LocalPurchase.id)
                .where(
                    LocalPurchaseItem.product_id.in_(prod_ids),
                    LocalPurchase.status == "Confirmed",
                    LocalPurchase.deleted_at.is_(None),
                )
                .order_by(LocalPurchase.invoice_date.desc(), LocalPurchaseItem.created_at.desc())
            )
            for pid, s_id, s_name, u_rate, lp_vat in q_lp.all():
                if pid not in lp_supplier_map:
                    vat_pct = float(lp_vat) if lp_vat is not None else 13.0
                    rate_with_vat = round(float(u_rate or 0.0) * (1.0 + vat_pct / 100.0), 2)
                    lp_supplier_map[pid] = (s_id, s_name, rate_with_vat)
                    lp_vat_map[pid] = vat_pct

            # Fallback to Product Prices (supplier_product_links) for any products not in local purchase
            missing_spl_ids = [pid for pid in prod_ids if pid not in lp_supplier_map]
            if missing_spl_ids:
                q_spl = await self.session.execute(
                    select(
                        SupplierProductLink.product_id,
                        SupplierProductLink.supplier_id,
                        Supplier.company_name,
                        SupplierProductLink.unit_price,
                    )
                    .join(Supplier, SupplierProductLink.supplier_id == Supplier.id)
                    .where(
                        SupplierProductLink.product_id.in_(missing_spl_ids),
                        Supplier.deleted_at.is_(None),
                    )
                    .order_by(SupplierProductLink.unit_price.asc())
                )
                for pid, s_id, s_name, u_rate in q_spl.all():
                    if pid not in lp_supplier_map:
                        lp_supplier_map[pid] = (s_id, s_name, float(u_rate or 0.0))

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
            uom_name = uom_map.get(prod.uom_id, "NOS") if (prod and prod.uom_id) else "NOS"

            # Supplier & RMB Unit Price with VAT from Local Purchase
            sup_info = lp_supplier_map.get(prod.id) if prod else None
            sup_id = sup_info[0] if sup_info else None
            sup_name = sup_info[1] if sup_info else None
            unit_price_rmb_with_vat = (
                sup_info[2]
                if sup_info
                else (float(prod.standard_cost) if prod and prod.standard_cost else 0.0)
            )

            # Refund VAT rate (use the Local Purchase VAT % when the price came from LP,
            # so "Excluding VAT" equals the LP basic Unit Rate exactly)
            if prod and prod.id in lp_vat_map:
                vat_rate = lp_vat_map[prod.id]
            else:
                vat_rate = float(prod.refund_vat_percent) if (prod and prod.refund_vat_percent is not None) else 13.0
            divisor = 1.0 + (vat_rate / 100.0)
            unit_price_rmb_ex_vat = round(unit_price_rmb_with_vat / divisor, 2) if divisor > 0 else unit_price_rmb_with_vat

            # Profit %
            profit_pct = 3.0
            price_with_profit_rmb = round(unit_price_rmb_ex_vat * (1.0 + profit_pct / 100.0), 2)
            fob_price_usd = round(price_with_profit_rmb / 6.70, 4) if price_with_profit_rmb > 0 else 0.0

            # CBM
            cbm_unit = float(prod.packaging_unit_cbm) if (prod and prod.packaging_unit_cbm) else 0.0
            if cbm_unit == 0.0 and prod and prod.length and prod.width and prod.height:
                cbm_unit = round((float(prod.length) * float(prod.width) * float(prod.height)) / 1_000_000.0, 6)
            pack_qty = float(prod.packaging_quantity) if (prod and prod.packaging_quantity and prod.packaging_quantity > 0) else 1.0
            boxes = math.ceil(qty / pack_qty) if pack_qty > 0 else qty
            total_cbm = round(cbm_unit * boxes, 4)
            total_sup_amt_rmb = round(unit_price_rmb_with_vat * qty, 2)

            rmk_val = cell_val_map.get((r.id, remarks_col.id)) if remarks_col else None

            extracted_items.append(
                ExtractedConsignmentItem(
                    product_id=prod.id if prod else None,
                    product_name=prod_name,
                    product_code=prod_code,
                    hsn_code=hsn,
                    uom=uom_name,
                    quantity=qty,
                    unit_rate=fob_price_usd,
                    vat_rate=vat_rate,
                    planning_row_id=r.id,
                    remarks=rmk_val,
                    supplier_id=sup_id,
                    supplier_name=sup_name,
                    unit_price_rmb_with_vat=unit_price_rmb_with_vat,
                    unit_price_rmb_ex_vat=unit_price_rmb_ex_vat,
                    profit_percent=profit_pct,
                    fob_price_usd=fob_price_usd,
                    freight_unit_usd=0.0,
                    cfr_price_usd=fob_price_usd,
                    cbm_per_unit=cbm_unit,
                    total_cbm=total_cbm,
                    total_supplier_amount_rmb=total_sup_amt_rmb,
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

    async def get_product_costing_info(
        self,
        product_id: uuid.UUID,
        quantity: float = 1.0,
    ) -> dict[str, Any]:
        """
        Fetch supplier, factory purchase price (with VAT in RMB), CBM, and HSN refund VAT.
        Primary source of truth is the latest confirmed Local Purchase invoice!
        Fallback is Product Prices preferred quotation.
        """
        prod = await self.session.get(Product, product_id)
        if not prod:
            raise NotFoundException(f"Product {product_id} not found.")

        # 1. Primary Source of Truth: Confirmed Local Purchase
        q_lp = await self.session.execute(
            select(
                LocalPurchaseItem,
                LocalPurchase.supplier_id,
                LocalPurchase.supplier_name,
            )
            .join(LocalPurchase, LocalPurchaseItem.purchase_id == LocalPurchase.id)
            .where(
                LocalPurchaseItem.product_id == product_id,
                LocalPurchase.status == "Confirmed",
                LocalPurchase.deleted_at.is_(None),
            )
            .order_by(LocalPurchase.invoice_date.desc(), LocalPurchaseItem.created_at.desc())
            .limit(1)
        )
        lp_row = q_lp.first()

        supplier_id = None
        supplier_name = None
        unit_price_rmb_with_vat = 0.0
        lp_vat_pct: float | None = None

        if lp_row:
            supplier_id = lp_row[1]
            supplier_name = lp_row[2]
            # LP Unit Rate is BASIC (excl. VAT) -> gross up to get "Including VAT"
            lp_vat_pct = float(lp_row[0].vat_rate) if lp_row[0].vat_rate is not None else 13.0
            unit_price_rmb_with_vat = round(float(lp_row[0].unit_rate or 0.0) * (1.0 + lp_vat_pct / 100.0), 2)
        else:
            # Strict Local Purchase enforcement: NO fallback to quotes or standard cost
            supplier_id = None
            supplier_name = None
            unit_price_rmb_with_vat = 0.0

        # 2. HSN and Refund VAT %
        refund_vat_percent = float(prod.refund_vat_percent) if prod.refund_vat_percent is not None else 13.0
        hsn_code_str = None
        if prod.hsn_id:
            hsn_obj = await self.session.get(HsnCode, prod.hsn_id)
            if hsn_obj:
                hsn_code_str = hsn_obj.code
                if hsn_obj.refund_vat_percent is not None and hsn_obj.refund_vat_percent > 0:
                    refund_vat_percent = float(hsn_obj.refund_vat_percent)
        if lp_vat_pct is not None:
            # Price came from Local Purchase: divide by the same VAT % it was grossed up with
            refund_vat_percent = lp_vat_pct

        # UOM
        uom_str = "NOS"
        if prod.uom_id:
            uom_obj = await self.session.get(UnitOfMeasurement, prod.uom_id)
            if uom_obj:
                uom_str = uom_obj.short_name or uom_obj.code or uom_obj.name or "NOS"

        # 3. Price Excluding VAT
        divisor = 1.0 + (refund_vat_percent / 100.0)
        unit_price_rmb_ex_vat = round(unit_price_rmb_with_vat / divisor, 2) if divisor > 0 else unit_price_rmb_with_vat

        # 4. Packaging CBM
        cbm_unit = float(prod.packaging_unit_cbm) if prod.packaging_unit_cbm else 0.0
        if cbm_unit == 0.0 and prod.length and prod.width and prod.height:
            cbm_unit = round((float(prod.length) * float(prod.width) * float(prod.height)) / 1_000_000.0, 6)

        pack_qty = float(prod.packaging_quantity) if (prod.packaging_quantity and prod.packaging_quantity > 0) else 1.0
        boxes = math.ceil(quantity / pack_qty) if pack_qty > 0 else quantity
        total_cbm = round(cbm_unit * boxes, 4)

        # 5. Default profit % and price with profit
        profit_percent = 3.0
        price_with_profit_rmb = round(unit_price_rmb_ex_vat * (1.0 + (profit_percent / 100.0)), 2)
        fob_price_usd = round(price_with_profit_rmb / 6.70, 4) if price_with_profit_rmb > 0 else 0.0
        total_supplier_amount_rmb = round(unit_price_rmb_with_vat * quantity, 2)

        return {
            "product_id": str(prod.id),
            "product_name": prod.product_name,
            "product_code": prod.product_code,
            "hsn_code": hsn_code_str,
            "uom": uom_str,
            "supplier_id": str(supplier_id) if supplier_id else None,
            "supplier_name": supplier_name,
            "unit_price_rmb_with_vat": unit_price_rmb_with_vat,
            "unit_price_rmb_ex_vat": unit_price_rmb_ex_vat,
            "refund_vat_percent": refund_vat_percent,
            "profit_percent": profit_percent,
            "price_with_profit_rmb": price_with_profit_rmb,
            "fob_price_usd": fob_price_usd,
            "freight_unit_usd": 0.0,
            "cfr_price_usd": fob_price_usd,
            "cbm_per_unit": cbm_unit,
            "total_cbm": total_cbm,
            "total_supplier_amount_rmb": total_supplier_amount_rmb,
        }

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
                    supplier_id=it.supplier_id,
                    supplier_name=it.supplier_name,
                    unit_price_rmb_with_vat=float(it.unit_price_rmb_with_vat or 0.0),
                    unit_price_rmb_ex_vat=float(it.unit_price_rmb_ex_vat or 0.0),
                    profit_percent=float(it.profit_percent if it.profit_percent is not None else 3.0),
                    fob_price_usd=float(it.fob_price_usd or 0.0),
                    freight_unit_usd=float(it.freight_unit_usd or 0.0),
                    cfr_price_usd=float(it.cfr_price_usd or 0.0),
                    cbm_per_unit=float(it.cbm_per_unit or 0.0),
                    total_cbm=float(it.total_cbm or 0.0),
                    total_supplier_amount_rmb=float(it.total_supplier_amount_rmb or 0.0),
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
            ocean_freight_usd=float(payload.ocean_freight_usd or 0.0),
            local_charges_coc_usd=float(payload.local_charges_coc_usd or 0.0),
            usd_exchange_rate=float(payload.usd_exchange_rate or 6.70),
            profit_percent=float(payload.profit_percent if payload.profit_percent is not None else 3.0),
            total_container_cbm=float(payload.total_container_cbm or 0.0),
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

        if payload.ocean_freight_usd is not None:
            order.ocean_freight_usd = float(payload.ocean_freight_usd)
        if payload.local_charges_coc_usd is not None:
            order.local_charges_coc_usd = float(payload.local_charges_coc_usd)
        if payload.usd_exchange_rate is not None:
            order.usd_exchange_rate = float(payload.usd_exchange_rate)
        if payload.profit_percent is not None:
            order.profit_percent = float(payload.profit_percent)
        if payload.total_container_cbm is not None:
            order.total_container_cbm = float(payload.total_container_cbm)

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
                        supplier_id=it.supplier_id,
                        supplier_name=it.supplier_name,
                        unit_price_rmb_with_vat=float(it.unit_price_rmb_with_vat or 0.0),
                        unit_price_rmb_ex_vat=float(it.unit_price_rmb_ex_vat or 0.0),
                        profit_percent=float(it.profit_percent if it.profit_percent is not None else 3.0),
                        fob_price_usd=float(it.fob_price_usd or 0.0),
                        freight_unit_usd=float(it.freight_unit_usd or 0.0),
                        cfr_price_usd=float(it.cfr_price_usd or 0.0),
                        cbm_per_unit=float(it.cbm_per_unit or 0.0),
                        total_cbm=float(it.total_cbm or 0.0),
                        total_supplier_amount_rmb=float(it.total_supplier_amount_rmb or 0.0),
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

    async def get_trade_document_details(self, order_id: uuid.UUID) -> dict[str, Any]:
        """
        Extract complete enriched data required to render professional export trade documents:
        Commercial Invoice (CI) and Packing List (PL).
        """
        order = await self.repo.get_by_id(order_id)
        if not order:
            raise NotFoundException(f"Sale order {order_id} not found.")

        # Buyer info
        buyer: Buyer | None = None
        if order.buyer_id:
            buyer = await self.session.get(Buyer, order.buyer_id)

        # Exchange rates for conversion
        rates = await get_active_rates()
        cny_rate = float(rates.get("CNY", 7.14) or 7.14)

        items_data = []
        tot_qty = 0.0
        tot_pkg = 0
        tot_usd = 0.0
        tot_rmb = 0.0
        tot_net_wt = 0.0
        tot_gr_wt = 0.0
        tot_cbm = 0.0

        # Batch pre-fetch all products & UOMs in 2 single queries instead of 2 * N sequential network roundtrips
        product_ids = {it.product_id for it in order.items if it.product_id}
        products_by_id: dict[uuid.UUID, Product] = {}
        uoms_by_id: dict[uuid.UUID, UnitOfMeasurement] = {}

        if product_ids:
            prod_stmt = select(Product).where(Product.id.in_(product_ids))
            prod_res = await self.session.execute(prod_stmt)
            for p in prod_res.scalars().all():
                products_by_id[p.id] = p

            uom_ids = {p.uom_id for p in products_by_id.values() if p.uom_id}
            if uom_ids:
                uom_stmt = select(UnitOfMeasurement).where(UnitOfMeasurement.id.in_(uom_ids))
                uom_res = await self.session.execute(uom_stmt)
                for u in uom_res.scalars().all():
                    uoms_by_id[u.id] = u

        for idx, item in enumerate(order.items, start=1):
            product = products_by_id.get(item.product_id) if item.product_id else None

            uom_str = "NOS"
            if product and product.uom_id:
                uom_obj = uoms_by_id.get(product.uom_id)
                if uom_obj and uom_obj.code:
                    uom_str = uom_obj.code

            qty = float(item.quantity)
            tot_qty += qty

            # Currency calculation
            if order.currency.upper() in ("RMB", "CNY"):
                unit_rmb = float(item.unit_rate)
                unit_usd = round(unit_rmb / cny_rate, 2)
            else:
                unit_usd = float(item.unit_rate)
                unit_rmb = round(unit_usd * cny_rate, 2)

            amt_usd = round(unit_usd * qty, 2)
            amt_rmb = round(unit_rmb * qty, 2)
            tot_usd += amt_usd
            tot_rmb += amt_rmb

            # Packing & Weight calculation
            pack_qty = float(product.packaging_quantity or 1.0) if product and product.packaging_quantity else 1.0
            packages = max(1, math.ceil(qty / pack_qty)) if pack_qty > 0 else int(qty)
            tot_pkg += packages

            unit_net = float(product.packaging_net_weight or product.weight or 0.0) if product else 0.0
            unit_gr = float(product.packaging_gross_weight or product.weight or 0.0) if product else 0.0

            line_net_wt = round(qty * unit_net, 2) if unit_net > 0 else 0.0
            line_gr_wt = round(qty * unit_gr, 2) if unit_gr > 0 else 0.0
            tot_net_wt += line_net_wt
            tot_gr_wt += line_gr_wt

            line_cbm = round(float(product.packaging_unit_cbm or 0.0) * packages, 4) if product and product.packaging_unit_cbm else 0.0
            tot_cbm += line_cbm

            hs_code = item.hsn_code or (product.barcode if product else None) or ""

            items_data.append({
                "sr_no": idx,
                "product_id": str(item.product_id) if item.product_id else None,
                "description": product.product_name_invoice if (product and product.product_name_invoice) else item.product_name,
                "product_code": item.product_code or (product.product_code if product else None),
                "hs_code": hs_code,
                "uom": uom_str,
                "quantity": qty,
                "unit_price_usd": unit_usd,
                "total_amount_usd": amt_usd,
                "unit_price_rmb": unit_rmb,
                "total_amount_rmb": amt_rmb,
                "packages": packages,
                "net_weight": line_net_wt,
                "gross_weight": line_gr_wt,
                "cbm": line_cbm,
                # CI Costing Engine details
                "supplier_id": str(item.supplier_id) if item.supplier_id else None,
                "supplier_name": item.supplier_name or (product.supplier_name if product else None) or "—",
                "unit_price_rmb_with_vat": float(item.unit_price_rmb_with_vat or unit_rmb),
                "unit_price_rmb_ex_vat": float(item.unit_price_rmb_ex_vat or round(unit_rmb / 1.13, 2)),
                "profit_percent": float(item.profit_percent if item.profit_percent is not None else 3.0),
                "fob_price_usd": float(item.fob_price_usd or 0.0),
                "freight_unit_usd": float(item.freight_unit_usd or 0.0),
                "cfr_price_usd": float(item.cfr_price_usd or unit_usd),
                "cbm_per_unit": float(item.cbm_per_unit or 0.0),
                "total_cbm": float(item.total_cbm or line_cbm),
                "total_supplier_amount_rmb": float(item.total_supplier_amount_rmb or (float(item.unit_price_rmb_with_vat or unit_rmb) * qty)),
            })

        # Recipient address resolution (No hardcoded "Maharashtra, India" dummy fallback)
        buyer_address = ""
        if buyer and buyer.address and buyer.address.strip():
            buyer_address = buyer.address.strip()
        elif order.buyer_branch_name and order.buyer_branch_name.strip():
            buyer_address = order.buyer_branch_name.strip()
        elif buyer and buyer.city and buyer.city.strip():
            buyer_address = buyer.city.strip()

        if buyer and buyer.tax_id_number:
            if buyer_address:
                buyer_address += f"\nGSTIN/UIN: {buyer.tax_id_number}"
            else:
                buyer_address = f"GSTIN/UIN: {buyer.tax_id_number}"

        # Contact person: primary or secondary contacts
        buyer_contact = ""
        if buyer:
            if buyer.contact_full_name and buyer.contact_full_name.strip():
                buyer_contact = buyer.contact_full_name.strip()
            elif buyer.contacts:
                for c in buyer.contacts:
                    c_name = getattr(c, "person_name", None) or getattr(c, "contact_person_name", None)
                    if c_name and c_name.strip():
                        salutation = getattr(c, "salutation", "") or ""
                        buyer_contact = f"{salutation} {c_name}".strip()
                        break

        # Phone: primary or secondary contacts
        buyer_phone = ""
        if buyer:
            if buyer.contact_calling_number and buyer.contact_calling_number.strip():
                buyer_phone = buyer.contact_calling_number.strip()
            elif buyer.contacts:
                for c in buyer.contacts:
                    c_phone = getattr(c, "calling_number", None) or getattr(c, "whatsapp_number", None)
                    if c_phone and c_phone.strip():
                        buyer_phone = c_phone.strip()
                        break

        # Email: primary emails or contact emails
        buyer_email = ""
        if buyer:
            if buyer.emails:
                for em in buyer.emails:
                    if em.email and em.email.strip():
                        buyer_email = em.email.strip()
                        break
            if not buyer_email and buyer.contacts:
                for c in buyer.contacts:
                    if getattr(c, "email", None) and c.email.strip():
                        buyer_email = c.email.strip()
                        break

        invoice_no = order.consignment_code or f"YL-EXP{order.order_date.year}-{order.order_no.split('/')[-1]}"

        return {
            "order_id": str(order.id),
            "order_no": order.order_no,
            "consignment_code": invoice_no,
            "order_date": str(order.order_date),
            "status": order.status,
            "currency": order.currency,
            "payment_terms": "Full Payment After Documents",
            "shipping_terms": "CIF INDIA",
            "delivery_time": "Within 25 Working Days",
            "shipper": {
                "company_name": "YINGLIMA IMPORT&EXPORT (WENZHOU) CO., LTD.",
                "address": "Room 602, Sixth floor, Jinyu Business Building, Wenzhou Avenue, Nanhui Street, Lucheng District, Wenzhou City, Zhejiang Province",
                "contact_person": "Mr. Pawan Parulekar",
                "phone": "150-6827-0160",
                "wechat": "+91 8108294930",
                "email": "sales.yinglima@gmail.com",
            },
            "recipient": {
                "company_name": (buyer.company_name if buyer else order.buyer_name) or "",
                "address": buyer_address,
                "contact_person": buyer_contact,
                "phone": buyer_phone,
                "email": buyer_email,
                "tax_id": buyer.tax_id_number if buyer else None,
            },
            "bank_details": {
                "bank_name": "INDUSTRIAL AND COMMERCIAL BANK OF CHINA, ZHEJIANG BRANCH",
                "swift_bic": "ICBKCNBJZJP",
                "beneficiary_name": "YINGLIMA IMPORT&EXPORT (WENZHOU) CO., LTD.",
                "address": "ROOM 1106 18, BUILDING 4, DEVELOPMENT BUILDING, NO.66, LINGRONG STREET, LINGKUN STREET, OUJIANGKOU INDUSTRIAL CLUSTER, WENZHOU, ZHEJIANG",
                "account_no": "1203202009814645910",
            },
            "declaration": "We hereby declare that above information is true and correct.",
            "items": items_data,
            "totals": {
                "quantity": tot_qty,
                "packages": tot_pkg,
                "total_amount_usd": round(tot_usd, 2),
                "total_amount_rmb": round(tot_rmb, 2),
                "net_weight": round(tot_net_wt, 2),
                "gross_weight": round(tot_gr_wt, 2),
                "cbm": round(tot_cbm, 4),
                "costing": {
                    "ocean_freight_usd": float(order.ocean_freight_usd or 0.0),
                    "local_charges_coc_usd": float(order.local_charges_coc_usd or 0.0),
                    "usd_exchange_rate": float(order.usd_exchange_rate or 6.70),
                    "profit_percent": float(order.profit_percent if order.profit_percent is not None else 3.0),
                    "total_container_cbm": float(order.total_container_cbm or tot_cbm),
                },
            },
        }

    async def export_trade_documents_excel(self, order_id: uuid.UUID, mode: str = "internal") -> io.BytesIO:
        """
        Generate official dual-sheet export workbook (CI + Packing List).
        mode="internal": full 16-column costing sheet + Packing List.
        mode="customer": clean 7-column customer commercial invoice + Packing List.
        """
        if mode not in ("internal", "customer"):
            mode = "internal"

        data = await self.get_trade_document_details(order_id)

        wb = Workbook()

        # Styles
        f_title = Font(name="Segoe UI", size=14, bold=True, color="0F172A")
        f_header = Font(name="Segoe UI", size=10, bold=True, color="0F172A")
        f_header_white = Font(name="Segoe UI", size=10, bold=True, color="FFFFFF")
        f_bold = Font(name="Segoe UI", size=9, bold=True, color="0F172A")
        f_regular = Font(name="Segoe UI", size=9, color="1E293B")
        f_bank = Font(name="Segoe UI", size=8.5, bold=True, color="1E293B")

        fill_title = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
        fill_head = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")
        fill_blue_head = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
        fill_yellow = PatternFill(start_color="FEF08A", end_color="FEF08A", fill_type="solid")

        thin = Side(style="thin", color="94A3B8")
        b_all = Border(left=thin, right=thin, top=thin, bottom=thin)

        al_center = Alignment(horizontal="center", vertical="center", wrap_text=True)
        al_left = Alignment(horizontal="left", vertical="center", wrap_text=True)
        al_right = Alignment(horizontal="right", vertical="center")

        assets_dir = os.path.join(os.path.dirname(__file__), "assets")
        stamp_path = os.path.join(assets_dir, "stamp.jpeg")
        sig_path = os.path.join(assets_dir, "signature.png")

        # -------------------------------------------------------------
        # SHEET 1: CI (Commercial Invoice)
        # -------------------------------------------------------------
        ws_ci = wb.active
        assert ws_ci is not None, "Failed to get active sheet from workbook"
        ws_ci.title = "CI"
        ws_ci.views.sheetView[0].showGridLines = True

        max_c = 16 if mode == "internal" else 7
        max_col_letter = "P" if mode == "internal" else "G"

        # Row 1: Letterhead
        ws_ci.merge_cells(f"A1:{max_col_letter}1")
        ws_ci["A1"] = (
            f"{data['shipper']['company_name']}\n"
            f"Email: {data['shipper']['email']} | Mobile: {data['shipper']['phone']} | WeChat: {data['shipper']['wechat']}\n"
            f"Address: {data['shipper']['address']}"
        )
        ws_ci["A1"].font = Font(name="Segoe UI", size=9, bold=True, color="1E3A8A")
        ws_ci["A1"].alignment = al_center
        ws_ci.row_dimensions[1].height = 45

        # Row 2: Title
        ws_ci.merge_cells(f"A2:{max_col_letter}2")
        ws_ci["A2"] = "COMMERCIAL INVOICE"
        ws_ci["A2"].font = f_title
        ws_ci["A2"].alignment = al_center
        ws_ci["A2"].fill = fill_title
        ws_ci.row_dimensions[2].height = 26

        # Row 3: Invoice No & Date
        if mode == "internal":
            ws_ci.merge_cells("A3:C3")
            ws_ci["A3"] = "Commercial Invoice No"
            ws_ci["A3"].font = f_bold
            ws_ci.merge_cells("D3:H3")
            ws_ci["D3"] = data["consignment_code"]
            ws_ci["D3"].font = f_bold
            ws_ci.merge_cells("I3:K3")
            ws_ci["I3"] = "Date"
            ws_ci["I3"].font = f_bold
            ws_ci["I3"].alignment = al_center
            ws_ci.merge_cells("L3:P3")
            ws_ci["L3"] = data["order_date"]
            ws_ci["L3"].font = f_bold
            ws_ci["L3"].alignment = al_right
        else:
            ws_ci["A3"] = "Commercial Invoice No"
            ws_ci["A3"].font = f_bold
            ws_ci["B3"] = data["consignment_code"]
            ws_ci["B3"].font = f_bold
            ws_ci["F3"] = "Date"
            ws_ci["F3"].font = f_bold
            ws_ci["G3"] = data["order_date"]
            ws_ci["G3"].font = f_bold
            ws_ci["G3"].alignment = al_right

        for c in range(1, max_c + 1):
            ws_ci.cell(3, c).border = b_all

        # Row 4: Section Headers
        if mode == "internal":
            ws_ci.merge_cells("A4:H4")
            ws_ci["A4"] = "Shipper's Information"
            ws_ci["A4"].font = f_bold
            ws_ci["A4"].fill = fill_head

            ws_ci.merge_cells("I4:P4")
            ws_ci["I4"] = "Recipient's Information"
            ws_ci["I4"].font = f_bold
            ws_ci["I4"].fill = fill_head
        else:
            ws_ci.merge_cells("A4:D4")
            ws_ci["A4"] = "Shipper's Information"
            ws_ci["A4"].font = f_bold
            ws_ci["A4"].fill = fill_head

            ws_ci.merge_cells("E4:G4")
            ws_ci["E4"] = "Recipient's Information"
            ws_ci["E4"].font = f_bold
            ws_ci["E4"].fill = fill_head

        for c in range(1, max_c + 1):
            ws_ci.cell(4, c).border = b_all

        # Rows 5 to 9: Details
        details = [
            ("Company Name", data["shipper"]["company_name"], "Company Name", data["recipient"]["company_name"]),
            ("Address", data["shipper"]["address"], "Address", data["recipient"]["address"]),
            ("Contact Person", data["shipper"]["contact_person"], "Contact Person", data["recipient"]["contact_person"]),
            ("Phone Number", data["shipper"]["phone"], "Phone Number", data["recipient"]["phone"]),
            ("Email", data["shipper"]["email"], "Email ID", data["recipient"]["email"]),
        ]

        for idx, (lbl_s, val_s, lbl_r, val_r) in enumerate(details, start=5):
            ws_ci.cell(idx, 1, lbl_s).font = f_bold
            ws_ci.cell(idx, 1).border = b_all

            if mode == "internal":
                ws_ci.merge_cells(start_row=idx, start_column=2, end_row=idx, end_column=8)
                ws_ci.cell(idx, 2, val_s).font = f_regular
                ws_ci.cell(idx, 2).alignment = al_left
                for c in range(2, 9):
                    ws_ci.cell(idx, c).border = b_all

                ws_ci.cell(idx, 9, lbl_r).font = f_bold
                ws_ci.cell(idx, 9).border = b_all
                ws_ci.merge_cells(start_row=idx, start_column=10, end_row=idx, end_column=16)
                ws_ci.cell(idx, 10, val_r).font = f_regular
                ws_ci.cell(idx, 10).alignment = al_left
                for c in range(10, 17):
                    ws_ci.cell(idx, c).border = b_all
            else:
                ws_ci.merge_cells(start_row=idx, start_column=2, end_row=idx, end_column=4)
                ws_ci.cell(idx, 2, val_s).font = f_regular
                ws_ci.cell(idx, 2).alignment = al_left
                for c in range(2, 5):
                    ws_ci.cell(idx, c).border = b_all

                ws_ci.cell(idx, 5, lbl_r).font = f_bold
                ws_ci.cell(idx, 5).border = b_all
                ws_ci.merge_cells(start_row=idx, start_column=6, end_row=idx, end_column=7)
                ws_ci.cell(idx, 6, val_r).font = f_regular
                ws_ci.cell(idx, 6).alignment = al_left
                for c in range(6, 8):
                    ws_ci.cell(idx, c).border = b_all

            ws_ci.row_dimensions[idx].height = 28 if idx == 6 else 20

        # Terms
        terms = [
            (10, f"Terms of Payment: {data['payment_terms']}"),
            (11, f"Shipping Terms: {data['shipping_terms']}"),
            (12, f"Delivery Time: {data['delivery_time']}"),
        ]
        for r_num, term_txt in terms:
            ws_ci.merge_cells(f"A{r_num}:{max_col_letter}{r_num}")
            ws_ci[f"A{r_num}"] = term_txt
            ws_ci[f"A{r_num}"].font = f_bold
            ws_ci[f"A{r_num}"].alignment = al_left
            for c in range(1, max_c + 1):
                ws_ci.cell(r_num, c).border = b_all

        # Row 13: Shipment Information Bar
        costing_params = data.get("totals", {}).get("costing", {})
        ocean_fr = float(costing_params.get("ocean_freight_usd") or 0.0)
        local_coc = float(costing_params.get("local_charges_coc_usd") or 0.0)
        usd_rate = float(costing_params.get("usd_exchange_rate") or 6.70)
        profit_pct = float(costing_params.get("profit_percent") if costing_params.get("profit_percent") is not None else 3.0)

        if mode == "internal":
            ws_ci.merge_cells("A13:K13")
            ws_ci["A13"] = "Shipment Information"
            ws_ci["A13"].font = f_bold
            ws_ci["A13"].fill = fill_head
            for c in range(1, 12):
                ws_ci.cell(13, c).border = b_all
        else:
            ws_ci.merge_cells("A13:G13")
            ws_ci["A13"] = "Shipment Information"
            ws_ci["A13"].font = f_bold
            ws_ci["A13"].fill = fill_head
            for c in range(1, 8):
                ws_ci.cell(13, c).border = b_all

        # Row 14: Table Headers
        if mode == "internal":
            ci_headers = [
                "Sr.No",
                "Description ",
                "HS CODE AS PER CHINA",
                "UOM",
                "Quantity",
                "Unit Price\n(USD)",
                "Total Amount\n(USD)",
                "Unit Price(RMB)\nIncluding VAT",
                "Unit Price(RMB)\nExcluding VAT",
                f"Including Profit\n{int(profit_pct) if profit_pct.is_integer() else profit_pct}%",
                f"FOB PRICE\n(@{usd_rate})",
                "Freight, Local\ncharges, COC",
                "CFR Price/Unit",
                "Supplier",
                "Total CBM",
                "Total Supplier Amount",
            ]
        else:
            ci_headers = [
                "Sr.No",
                "Description ",
                "HS CODE AS PER CHINA",
                "UOM",
                "Quantity",
                "Unit Price\n(USD)",
                "Total Amount\n(USD)",
            ]

        for c_idx, h in enumerate(ci_headers, start=1):
            cell = ws_ci.cell(14, c_idx, h)
            cell.font = f_header_white
            cell.fill = fill_blue_head
            cell.alignment = al_center
            cell.border = b_all
        ws_ci.row_dimensions[14].height = 32

        curr_row = 15
        start_data_row = 15
        for item in data["items"]:
            # Col 1: Sr.No
            ws_ci.cell(curr_row, 1, item["sr_no"]).alignment = al_center
            # Col 2: Description
            ws_ci.cell(curr_row, 2, item["description"]).alignment = al_left
            # Col 3: HS Code
            ws_ci.cell(curr_row, 3, item["hs_code"]).alignment = al_center
            # Col 4: UOM
            ws_ci.cell(curr_row, 4, item["uom"]).alignment = al_center

            # Col 5: Quantity
            c_qty = ws_ci.cell(curr_row, 5, item["quantity"])
            c_qty.alignment = al_right
            c_qty.number_format = "#,##0"

            if mode == "internal":
                # Col 6: Unit Price (USD) = M{curr_row}
                c_rate = ws_ci.cell(curr_row, 6, f"=M{curr_row}")
                c_rate.alignment = al_right
                c_rate.number_format = "$#,##0.00"

                # Col 7: Total Amount (USD) = F{curr_row}*E{curr_row}
                c_tot = ws_ci.cell(curr_row, 7, f"=F{curr_row}*E{curr_row}")
                c_tot.alignment = al_right
                c_tot.number_format = "$#,##0.00"

                # Col 8: Unit Price(RMB) Including VAT
                c_rmb_vat = ws_ci.cell(curr_row, 8, item.get("unit_price_rmb_with_vat", item.get("unit_price_rmb", 0.0)))
                c_rmb_vat.alignment = al_right
                c_rmb_vat.number_format = "#,##0.00"

                # Col 9: Unit Price(RMB) Excluding VAT = H{curr_row}/1.13
                c_rmb_ex = ws_ci.cell(curr_row, 9, f"=H{curr_row}/1.13")
                c_rmb_ex.alignment = al_right
                c_rmb_ex.number_format = "#,##0.00"

                # Col 10: Including Profit = (I{curr_row} * (1 + profit_pct/100))
                p_mult = round(1.0 + (profit_pct / 100.0), 4)
                c_profit = ws_ci.cell(curr_row, 10, f"=(I{curr_row}*{p_mult})")
                c_profit.alignment = al_right
                c_profit.number_format = "#,##0.00"

                # Col 11: FOB Price USD = J{curr_row} / usd_rate
                c_fob = ws_ci.cell(curr_row, 11, f"=J{curr_row}/{usd_rate}")
                c_fob.alignment = al_right
                c_fob.number_format = "$#,##0.000"

                # Col 12: Freight, Local charges, COC = ($L$13*O{curr_row})/E{curr_row}
                c_fr = ws_ci.cell(curr_row, 12, f"=($L$13*O{curr_row})/E{curr_row}")
                c_fr.alignment = al_right
                c_fr.number_format = "$#,##0.000"

                # Col 13: CFR Price/Unit = ROUNDUP(L{curr_row}+K{curr_row},2)
                c_cfr = ws_ci.cell(curr_row, 13, f"=ROUNDUP(L{curr_row}+K{curr_row},2)")
                c_cfr.alignment = al_right
                c_cfr.number_format = "$#,##0.00"

                # Col 14: Supplier
                c_sup = ws_ci.cell(curr_row, 14, item.get("supplier_name", "—"))
                c_sup.alignment = al_center

                # Col 15: Total CBM
                c_cbm = ws_ci.cell(curr_row, 15, item.get("total_cbm", item.get("cbm", 0.0)))
                c_cbm.alignment = al_right
                c_cbm.number_format = "#,##0.000"

                # Col 16: Total Supplier Amount = H{curr_row}*E{curr_row}
                c_sup_amt = ws_ci.cell(curr_row, 16, f"=H{curr_row}*E{curr_row}")
                c_sup_amt.alignment = al_right
                c_sup_amt.number_format = "#,##0.00"
            else:
                # Customer Mode: Col 6 & 7 only
                unit_price = float(item.get("cfr_price_usd") or item.get("unit_price_usd", 0.0))
                c_rate = ws_ci.cell(curr_row, 6, unit_price)
                c_rate.alignment = al_right
                c_rate.number_format = "$#,##0.00"

                c_tot = ws_ci.cell(curr_row, 7, f"=F{curr_row}*E{curr_row}")
                c_tot.alignment = al_right
                c_tot.number_format = "$#,##0.00"

            for c in range(1, max_c + 1):
                cell = ws_ci.cell(curr_row, c)
                cell.font = f_regular
                cell.border = b_all

            curr_row += 1

        end_data_row = curr_row - 1
        total_row = curr_row

        if mode == "internal":
            # Set cell L13 formula with total container CBM cell reference:
            ws_ci["L13"] = f"=({ocean_fr}+{local_coc})/O{total_row}"
            ws_ci["L13"].font = f_bold
            ws_ci["L13"].alignment = al_right
            ws_ci["L13"].border = b_all

        # Total Row
        ws_ci.merge_cells(f"A{curr_row}:D{curr_row}")
        ws_ci[f"A{curr_row}"] = "Total Price CIF INDIA"
        ws_ci[f"A{curr_row}"].font = f_header
        ws_ci[f"A{curr_row}"].alignment = Alignment(horizontal="right", vertical="center")

        c_sum_qty = ws_ci.cell(curr_row, 5, f"=SUM(E{start_data_row}:E{end_data_row})")
        c_sum_qty.font = f_header
        c_sum_qty.alignment = al_right
        c_sum_qty.number_format = "#,##0"

        ws_ci.cell(curr_row, 6).border = b_all

        c_sum_tot = ws_ci.cell(curr_row, 7, f"=SUM(G{start_data_row}:G{end_data_row})")
        c_sum_tot.font = f_header
        c_sum_tot.alignment = al_right
        c_sum_tot.number_format = "$#,##0.00"

        if mode == "internal":
            for c in range(8, 15):
                ws_ci.cell(curr_row, c).border = b_all

            # Total CBM in Col 15
            c_sum_cbm = ws_ci.cell(curr_row, 15, f"=SUM(O{start_data_row}:O{end_data_row})")
            c_sum_cbm.font = f_header
            c_sum_cbm.alignment = al_right
            c_sum_cbm.number_format = "#,##0.000"

            # Total Supplier Amount in Col 16
            c_sum_sup = ws_ci.cell(curr_row, 16, f"=SUM(P{start_data_row}:P{end_data_row})")
            c_sum_sup.font = f_header
            c_sum_sup.alignment = al_right
            c_sum_sup.number_format = "#,##0.00"

        for c in range(1, max_c + 1):
            cell = ws_ci.cell(curr_row, c)
            cell.fill = fill_yellow
            cell.border = b_all

        curr_row += 1

        # Bank Details Block
        ws_ci.cell(curr_row, 1, "BANK ACCOUNT DETAILS FOR INWARD REMITTANCE (USD)").font = f_bold
        ws_ci.merge_cells(f"A{curr_row}:B{curr_row+4}")
        ws_ci.cell(curr_row, 1).alignment = al_center
        ws_ci.cell(curr_row, 1).fill = fill_head

        b = data["bank_details"]
        bank_info = (
            f"RECEIVING BANK: {b['bank_name']}\n"
            f"SWIFT BIC: {b['swift_bic']}\n"
            f"BENEFICIARY NAME: {b['beneficiary_name']}\n"
            f"ADDRESS: {b['address']}\n"
            f"A/C NO: {b['account_no']}"
        )
        ws_ci.merge_cells(f"C{curr_row}:{max_col_letter}{curr_row+4}")
        ws_ci.cell(curr_row, 3, bank_info).font = f_bank
        ws_ci.cell(curr_row, 3).alignment = al_left

        for r in range(curr_row, curr_row + 5):
            for c in range(1, max_c + 1):
                ws_ci.cell(r, c).border = b_all

        curr_row += 5

        # Stamp & Signature Block (Clean Box Layout matching Image 3)
        # Left Box (Cols A & B): Text ONLY
        ws_ci.merge_cells(f"A{curr_row}:B{curr_row+1}")
        ws_ci.cell(curr_row, 1, "Shipper's Signature and Stamp :").font = f_bold
        ws_ci.cell(curr_row, 1).alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

        # Right Box: Dedicated signature & stamp area
        ws_ci.merge_cells(f"C{curr_row}:{max_col_letter}{curr_row+1}")

        # Set row heights so images fit cleanly with zero overlap
        ws_ci.row_dimensions[curr_row].height = 42
        ws_ci.row_dimensions[curr_row + 1].height = 48

        for r in range(curr_row, curr_row + 2):
            for c in range(1, max_c + 1):
                ws_ci.cell(r, c).border = b_all

        # Place Signature in top half (centered in Column D)
        if os.path.exists(sig_path):
            sig = XLImage(sig_path)
            sig.width = 65
            sig.height = 36
            ws_ci.add_image(sig, f"D{curr_row}")

        # Place Blue Stamp below signature on row curr_row+1
        if os.path.exists(stamp_path):
            img = XLImage(stamp_path)
            img.width = 175
            img.height = 46
            ws_ci.add_image(img, f"C{curr_row+1}")

        curr_row += 2

        # Declaration
        ws_ci.merge_cells(f"A{curr_row}:{max_col_letter}{curr_row}")
        ws_ci[f"A{curr_row}"] = data["declaration"]
        ws_ci[f"A{curr_row}"].font = f_bold
        ws_ci[f"A{curr_row}"].alignment = al_center
        for c in range(1, max_c + 1):
            ws_ci.cell(curr_row, c).border = b_all

        # Widths
        ws_ci.column_dimensions["A"].width = 8
        ws_ci.column_dimensions["B"].width = 38
        ws_ci.column_dimensions["C"].width = 16
        ws_ci.column_dimensions["D"].width = 8
        ws_ci.column_dimensions["E"].width = 12
        ws_ci.column_dimensions["F"].width = 16
        ws_ci.column_dimensions["G"].width = 20

        if mode == "internal":
            ws_ci.column_dimensions["H"].width = 18
            ws_ci.column_dimensions["I"].width = 18
            ws_ci.column_dimensions["J"].width = 16
            ws_ci.column_dimensions["K"].width = 18
            ws_ci.column_dimensions["L"].width = 18
            ws_ci.column_dimensions["M"].width = 16
            ws_ci.column_dimensions["N"].width = 22
            ws_ci.column_dimensions["O"].width = 14
            ws_ci.column_dimensions["P"].width = 20

        # -------------------------------------------------------------
        # SHEET 2: PACKING LIST
        # -------------------------------------------------------------
        ws_pl = wb.create_sheet("Packing List")
        ws_pl.views.sheetView[0].showGridLines = True

        # Row 1: Letterhead
        ws_pl.merge_cells("A1:G1")
        ws_pl["A1"] = (
            f"{data['shipper']['company_name']}\n"
            f"Email: {data['shipper']['email']} | Mobile: {data['shipper']['phone']} | WeChat: {data['shipper']['wechat']}\n"
            f"Address: {data['shipper']['address']}"
        )
        ws_pl["A1"].font = Font(name="Segoe UI", size=9, bold=True, color="1E3A8A")
        ws_pl["A1"].alignment = al_center
        ws_pl.row_dimensions[1].height = 45

        # Row 2: Title
        ws_pl.merge_cells("A2:G2")
        ws_pl["A2"] = "PACKING LIST"
        ws_pl["A2"].font = f_title
        ws_pl["A2"].alignment = al_center
        ws_pl["A2"].fill = fill_title
        ws_pl.row_dimensions[2].height = 26

        # Row 3: Packing List No & Date
        ws_pl["A3"] = "Packing List No"
        ws_pl["A3"].font = f_bold
        ws_pl["B3"] = data["consignment_code"]
        ws_pl["B3"].font = f_bold
        ws_pl["F3"] = "Date"
        ws_pl["F3"].font = f_bold
        ws_pl["G3"] = data["order_date"]
        ws_pl["G3"].font = f_bold
        ws_pl["G3"].alignment = al_right

        for col in ["A", "B", "C", "D", "E", "F", "G"]:
            ws_pl[f"{col}3"].border = b_all

        # Row 4: Section Headers
        ws_pl.merge_cells("A4:D4")
        ws_pl["A4"] = "Shipper's Information"
        ws_pl["A4"].font = f_bold
        ws_pl["A4"].fill = fill_head

        ws_pl.merge_cells("E4:G4")
        ws_pl["E4"] = "Recipient's Information"
        ws_pl["E4"].font = f_bold
        ws_pl["E4"].fill = fill_head

        for c in range(1, 8):
            ws_pl.cell(4, c).border = b_all

        # Rows 5 to 9: Details
        for idx, (lbl_s, val_s, lbl_r, val_r) in enumerate(details, start=5):
            ws_pl.cell(idx, 1, lbl_s).font = f_bold
            ws_pl.cell(idx, 1).border = b_all
            ws_pl.merge_cells(start_row=idx, start_column=2, end_row=idx, end_column=4)
            ws_pl.cell(idx, 2, val_s).font = f_regular
            ws_pl.cell(idx, 2).alignment = al_left
            for c in range(2, 5):
                ws_pl.cell(idx, c).border = b_all

            ws_pl.cell(idx, 5, lbl_r).font = f_bold
            ws_pl.cell(idx, 5).border = b_all
            ws_pl.merge_cells(start_row=idx, start_column=6, end_row=idx, end_column=7)
            ws_pl.cell(idx, 6, val_r).font = f_regular
            ws_pl.cell(idx, 6).alignment = al_left
            for c in range(6, 8):
                ws_pl.cell(idx, c).border = b_all

            ws_pl.row_dimensions[idx].height = 28 if idx == 6 else 20

        # Terms
        ws_pl.merge_cells("A10:G10")
        ws_pl["A10"] = f"Shipping Terms: {data['shipping_terms']}"
        ws_pl["A10"].font = f_bold
        ws_pl["A10"].alignment = al_left
        for c in range(1, 8):
            ws_pl.cell(10, c).border = b_all

        # Row 11: Header
        ws_pl.merge_cells("A11:G11")
        ws_pl["A11"] = "PACKING INFORMATION"
        ws_pl["A11"].font = f_bold
        ws_pl["A11"].fill = fill_head
        for c in range(1, 8):
            ws_pl.cell(11, c).border = b_all

        # Row 12-13: Table Headers
        ws_pl.cell(12, 1, "Sr.No").border = b_all
        ws_pl.cell(12, 2, "Description").border = b_all
        ws_pl.cell(12, 3, "Quantity in KGS/PCS").border = b_all
        ws_pl.cell(12, 4, "PACKAGE").border = b_all
        ws_pl.cell(12, 5, "UNIT OF MEASUREMENT").border = b_all
        ws_pl.merge_cells("F12:G12")
        ws_pl.cell(12, 6, "Total in KG").border = b_all
        ws_pl.cell(12, 7).border = b_all

        ws_pl.cell(13, 1, "").border = b_all
        ws_pl.cell(13, 2, "").border = b_all
        ws_pl.cell(13, 3, "").border = b_all
        ws_pl.cell(13, 4, "").border = b_all
        ws_pl.cell(13, 5, "").border = b_all
        ws_pl.cell(13, 6, "Net Weight").border = b_all
        ws_pl.cell(13, 7, "Gr. Weight").border = b_all

        for c in range(1, 8):
            ws_pl.cell(12, c).font = f_header_white
            ws_pl.cell(12, c).fill = fill_blue_head
            ws_pl.cell(12, c).alignment = al_center

            ws_pl.cell(13, c).font = f_header_white
            ws_pl.cell(13, c).fill = fill_blue_head
            ws_pl.cell(13, c).alignment = al_center

        curr_row = 14
        start_pl_row = 14
        for item in data["items"]:
            ws_pl.cell(curr_row, 1, item["sr_no"]).alignment = al_center
            ws_pl.cell(curr_row, 2, item["description"]).alignment = al_left

            c_qty = ws_pl.cell(curr_row, 3, item["quantity"])
            c_qty.alignment = al_right
            c_qty.number_format = "#,##0"

            c_pkg = ws_pl.cell(curr_row, 4, item["packages"])
            c_pkg.alignment = al_right
            c_pkg.number_format = "#,##0"

            ws_pl.cell(curr_row, 5, item["uom"]).alignment = al_center

            c_net = ws_pl.cell(curr_row, 6, item["net_weight"])
            c_net.alignment = al_right
            c_net.number_format = "#,##0.00"

            c_gr = ws_pl.cell(curr_row, 7, item["gross_weight"])
            c_gr.alignment = al_right
            c_gr.number_format = "#,##0.00"

            for c in range(1, 8):
                cell = ws_pl.cell(curr_row, c)
                cell.font = f_regular
                cell.border = b_all

            curr_row += 1

        end_pl_row = curr_row - 1

        # Total Row
        ws_pl.merge_cells(f"A{curr_row}:B{curr_row}")
        ws_pl[f"A{curr_row}"] = "Total"
        ws_pl[f"A{curr_row}"].font = f_header
        ws_pl[f"A{curr_row}"].alignment = al_center

        c_sum_qty = ws_pl.cell(curr_row, 3, f"=SUM(C{start_pl_row}:C{end_pl_row})")
        c_sum_qty.font = f_header
        c_sum_qty.alignment = al_right
        c_sum_qty.number_format = "#,##0"

        c_sum_pkg = ws_pl.cell(curr_row, 4, f"=SUM(D{start_pl_row}:D{end_pl_row})")
        c_sum_pkg.font = f_header
        c_sum_pkg.alignment = al_right
        c_sum_pkg.number_format = "#,##0"

        ws_pl.cell(curr_row, 5).border = b_all

        c_sum_net = ws_pl.cell(curr_row, 6, f"=SUM(F{start_pl_row}:F{end_pl_row})")
        c_sum_net.font = f_header
        c_sum_net.alignment = al_right
        c_sum_net.number_format = "#,##0.00"

        c_sum_gr = ws_pl.cell(curr_row, 7, f"=SUM(G{start_pl_row}:G{end_pl_row})")
        c_sum_gr.font = f_header
        c_sum_gr.alignment = al_right
        c_sum_gr.number_format = "#,##0.00"

        for c in range(1, 8):
            cell = ws_pl.cell(curr_row, c)
            cell.fill = fill_yellow
            cell.border = b_all

        curr_row += 1

        # Stamp & Signature Block (Clean Box Layout matching Image 3)
        ws_pl.merge_cells(f"A{curr_row}:B{curr_row+1}")
        ws_pl.cell(curr_row, 1, "Shipper's Signature and Stamp :").font = f_bold
        ws_pl.cell(curr_row, 1).alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

        ws_pl.merge_cells(f"C{curr_row}:G{curr_row+1}")

        ws_pl.row_dimensions[curr_row].height = 42
        ws_pl.row_dimensions[curr_row + 1].height = 48

        for r in range(curr_row, curr_row + 2):
            for c in range(1, 8):
                ws_pl.cell(r, c).border = b_all

        # Place Signature in top half (centered in Column D)
        if os.path.exists(sig_path):
            sig = XLImage(sig_path)
            sig.width = 65
            sig.height = 36
            ws_pl.add_image(sig, f"D{curr_row}")

        # Place Blue Stamp below signature on row curr_row+1
        if os.path.exists(stamp_path):
            img = XLImage(stamp_path)
            img.width = 175
            img.height = 46
            ws_pl.add_image(img, f"C{curr_row+1}")

        curr_row += 2

        # Declaration
        ws_pl.merge_cells(f"A{curr_row}:G{curr_row}")
        ws_pl[f"A{curr_row}"] = data["declaration"]
        ws_pl[f"A{curr_row}"].font = f_bold
        ws_pl[f"A{curr_row}"].alignment = al_center
        for c in range(1, 8):
            ws_pl.cell(curr_row, c).border = b_all

        # Widths
        ws_pl.column_dimensions["A"].width = 8
        ws_pl.column_dimensions["B"].width = 38
        ws_pl.column_dimensions["C"].width = 18
        ws_pl.column_dimensions["D"].width = 14
        ws_pl.column_dimensions["E"].width = 24
        ws_pl.column_dimensions["F"].width = 16
        ws_pl.column_dimensions["G"].width = 16

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output

