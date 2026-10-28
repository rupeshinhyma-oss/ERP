"""
Local Purchase Service.

Business logic for:
- Value-Based (VB) Landing Expense calculation & proportional unit distribution
- Bill file extraction (Excel & PDF via pypdf / OpenAI / regex)
- Supplier & Product Master auto-matching
- Excel export with corporate styling
"""

from __future__ import annotations

import base64
import csv
import io
import json
import logging
import os
import re
import time
import uuid
from datetime import date, datetime
from typing import Any

import httpx
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from pypdf import PdfReader
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestException, NotFoundException
from app.masters.company_list.models import MasterCompany
from app.masters.hsn.models import HsnCode
from app.masters.products.models import Product
from app.planning.models import PlanningCell, PlanningColumn, PlanningRow, PlanningSheet
from app.purchases.local.models import LocalPurchase, LocalPurchaseItem
from app.purchases.local.repository import LocalPurchaseRepository
from app.purchases.local.schemas import (
    BillExtractionItem,
    BillExtractionResponse,
    ConsignmentColumnInfo,
    ConsignmentProductItem,
    LocalPurchaseCreate,
    LocalPurchaseItemCreate,
    LocalPurchaseItemUpdate,
    LocalPurchaseUpdate,
    SheetConsignmentLookup,
)
from app.suppliers.models import Supplier

logger = logging.getLogger(__name__)

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()

_CONSIGNMENTS_LOOKUP_CACHE: dict[str, Any] = {
    "data": None,
    "timestamp": 0.0,
}
_CONSIGNMENTS_CACHE_TTL_SECONDS = 30.0


class LocalPurchaseService:
    """Service handling Local Purchases operations and calculations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = LocalPurchaseRepository(session)

    def calculate_landing_rates(
        self,
        *,
        packing_forwarding: float,
        transport_expense: float,
        offloading_expense: float,
        other_expense: float,
        items: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """
        Execute Value-Based (VB) Landing Cost distribution engine.

        Total Expenses = Packing + Transport + Offloading + Other
        Loading % = (Total Expenses / Items Total Basic) * 100
        Expense Per Unit = (Item Total Basic / Items Total Basic) * (Total Expenses / Qty)
        Unit Landing Rate = Unit Rate + Expense Per Unit
        Total Landing Rate = Qty * Unit Landing Rate
        """
        total_expenses = round(
            float(packing_forwarding or 0)
            + float(transport_expense or 0)
            + float(offloading_expense or 0)
            + float(other_expense or 0),
            2,
        )

        processed_items: list[dict[str, Any]] = []
        items_total_basic = 0.0
        items_total_vat = 0.0
        total_quantity = 0.0

        # Step 1: Compute basic item totals and VAT
        for item in items:
            qty = float(item.get("quantity") or 0)
            rate = float(item.get("unit_rate") or 0)
            raw_vat = item.get("vat_rate")
            vat_rate = float(raw_vat) if raw_vat is not None else 0.0

            basic_total = round(qty * rate, 2)
            vat_amount = round(basic_total * (vat_rate / 100.0), 2)

            items_total_basic += basic_total
            items_total_vat += vat_amount
            total_quantity += qty

            processed_items.append({
                **item,
                "quantity": qty,
                "unit_rate": rate,
                "vat_rate": vat_rate,
                "item_total": basic_total,
                "vat_amount": vat_amount,
            })

        items_total_basic = round(items_total_basic, 2)
        items_total_vat = round(items_total_vat, 2)
        total_quantity = round(total_quantity, 2)

        # Step 2: Compute Loading Expense %
        if items_total_basic > 0:
            loading_expense_pct = round((total_expenses / items_total_basic) * 100.0, 2)
        else:
            loading_expense_pct = 0.0

        # Step 3: Proportional allocation per item
        items_total_landing = 0.0
        for item in processed_items:
            qty = item["quantity"]
            rate = item["unit_rate"]
            basic_total = item["item_total"]

            if items_total_basic > 0 and qty > 0 and total_expenses > 0:
                # Proportional value fraction of total expenses
                allocated_expense = (basic_total / items_total_basic) * total_expenses
                expense_per_unit = round(allocated_expense / qty, 2)
            else:
                expense_per_unit = 0.0

            unit_landing_rate = round(rate + expense_per_unit, 2)
            total_landing_rate = round(qty * unit_landing_rate, 2)

            item["expense_per_unit"] = expense_per_unit
            item["unit_landing_rate"] = unit_landing_rate
            item["total_landing_rate"] = total_landing_rate

            items_total_landing += total_landing_rate

        items_total_landing = round(items_total_landing, 2)

        return {
            "total_expenses": total_expenses,
            "loading_expense_pct": loading_expense_pct,
            "items_total_basic": items_total_basic,
            "items_total_vat": items_total_vat,
            "items_total_landing": items_total_landing,
            "total_quantity": total_quantity,
            "items": processed_items,
        }

    async def create_purchase(
        self,
        payload: LocalPurchaseCreate,
        created_by_id: uuid.UUID | None = None,
        created_by_name: str | None = None,
    ) -> LocalPurchase:
        """Create a new local purchase with calculated landing rates."""
        # Validate supplier
        supplier = await self.session.get(Supplier, payload.supplier_id)
        if not supplier:
            raise NotFoundException(f"Supplier with id {payload.supplier_id} not found.")

        # Validate items
        if not payload.items:
            raise BadRequestException("Please add at least one product item.")

        for item in payload.items:
            if float(item.unit_rate or 0) <= 0:
                raise BadRequestException(f"Unit rate for product '{item.product_name}' must be greater than 0.")

        # Calculate landing rates
        calc_result = self.calculate_landing_rates(
            packing_forwarding=payload.packing_forwarding,
            transport_expense=payload.transport_expense,
            offloading_expense=payload.offloading_expense,
            other_expense=payload.other_expense,
            items=[item.model_dump() for item in payload.items],
        )

        # Enforce invoice reconciliation: strictly block if discrepancy > 0.05
        items_gross = round(calc_result["items_total_basic"] + calc_result["items_total_vat"], 2)
        diff = round(abs(float(payload.invoice_total_value) - items_gross), 2)
        if diff > 0.05:
            raise BadRequestException(
                f"Invoice reconciliation discrepancy detected: entered invoice total ({payload.invoice_total_value}) "
                f"differs from calculated items total with VAT ({items_gross}) by {diff}. "
                "Please reconcile line items and VAT before saving."
            )

        purchase = LocalPurchase(
            organization_id=payload.organization_id,
            organization_name=payload.organization_name,
            branch_id=payload.branch_id,
            branch_name=payload.branch_name,
            group_label=payload.group_label,
            consignment_code=payload.consignment_code,
            planning_sheet_id=payload.planning_sheet_id,
            planning_column_id=payload.planning_column_id,
            supplier_id=payload.supplier_id,
            supplier_name=payload.supplier_name,
            invoice_no=payload.invoice_no,
            invoice_date=payload.invoice_date,
            currency=payload.currency or "RMB",
            invoice_total_value=payload.invoice_total_value,
            bill_file_url=payload.bill_file_url,
            packing_forwarding=payload.packing_forwarding,
            transport_expense=payload.transport_expense,
            offloading_expense=payload.offloading_expense,
            other_expense=payload.other_expense,
            total_expenses=calc_result["total_expenses"],
            loading_expense_pct=calc_result["loading_expense_pct"],
            items_total_basic=calc_result["items_total_basic"],
            items_total_vat=calc_result["items_total_vat"],
            items_total_landing=calc_result["items_total_landing"],
            total_quantity=calc_result["total_quantity"],
            remarks=payload.remarks,
            status=payload.status or "Confirmed",
            created_by_id=created_by_id,
            created_by_name=created_by_name,
        )

        db_items: list[LocalPurchaseItem] = []
        for itm in calc_result["items"]:
            db_item = LocalPurchaseItem(
                product_id=itm.get("product_id"),
                product_name=itm["product_name"],
                product_code=itm.get("product_code"),
                hsn_code=itm.get("hsn_code"),
                quantity=itm["quantity"],
                unit_rate=itm["unit_rate"],
                vat_rate=itm["vat_rate"],
                item_total=itm["item_total"],
                vat_amount=itm["vat_amount"],
                expense_per_unit=itm["expense_per_unit"],
                unit_landing_rate=itm["unit_landing_rate"],
                total_landing_rate=itm["total_landing_rate"],
            )
            db_items.append(db_item)

        created = await self.repo.create_purchase(purchase, db_items)
        try:
            from app.notifications.service import NotificationService
            inv_str = created.invoice_no or "Bill"
            supp_str = created.supplier_name or "Supplier"
            val_str = f"{created.currency or 'RMB'} {created.invoice_total_value:,.2f}"
            await NotificationService.dispatch_event(
                self.session,
                event_key="local_purchase_created",
                title=f"Local Purchase Recorded: {inv_str} ({supp_str})",
                message=f"Purchase bill {inv_str} recorded for {supp_str} total {val_str}.",
                link=f"/purchase/local?search={created.invoice_no or ''}&id={created.id}",
                sender_id=created_by_id,
            )
        except Exception as e:
            logger.warning(f"Failed to dispatch local_purchase_created notification: {e}")
        return created

    async def update_purchase(
        self,
        purchase_id: uuid.UUID,
        payload: LocalPurchaseUpdate,
    ) -> LocalPurchase:
        """Update existing local purchase and recalculate rates."""
        purchase = await self.repo.get_with_items(purchase_id)
        if not purchase:
            raise NotFoundException(f"Local purchase with id {purchase_id} not found.")

        # Update scalar fields if provided
        if payload.organization_id is not None:
            purchase.organization_id = payload.organization_id
        if payload.organization_name is not None:
            purchase.organization_name = payload.organization_name
        if payload.branch_id is not None:
            purchase.branch_id = payload.branch_id
        if payload.branch_name is not None:
            purchase.branch_name = payload.branch_name
        if payload.group_label is not None:
            purchase.group_label = payload.group_label
        if payload.consignment_code is not None:
            purchase.consignment_code = payload.consignment_code
        if payload.planning_sheet_id is not None:
            purchase.planning_sheet_id = payload.planning_sheet_id
        if payload.planning_column_id is not None:
            purchase.planning_column_id = payload.planning_column_id

        if payload.supplier_id is not None:
            purchase.supplier_id = payload.supplier_id
        if payload.supplier_name is not None:
            purchase.supplier_name = payload.supplier_name
        if payload.invoice_no is not None:
            purchase.invoice_no = payload.invoice_no
        if payload.invoice_date is not None:
            purchase.invoice_date = payload.invoice_date
        if payload.currency is not None:
            purchase.currency = payload.currency
        if payload.invoice_total_value is not None:
            purchase.invoice_total_value = payload.invoice_total_value
        if payload.bill_file_url is not None:
            purchase.bill_file_url = payload.bill_file_url
        if payload.remarks is not None:
            purchase.remarks = payload.remarks
        if payload.status is not None:
            purchase.status = payload.status

        packing = payload.packing_forwarding if payload.packing_forwarding is not None else purchase.packing_forwarding
        transport = payload.transport_expense if payload.transport_expense is not None else purchase.transport_expense
        offloading = payload.offloading_expense if payload.offloading_expense is not None else purchase.offloading_expense
        other = payload.other_expense if payload.other_expense is not None else purchase.other_expense

        purchase.packing_forwarding = packing
        purchase.transport_expense = transport
        purchase.offloading_expense = offloading
        purchase.other_expense = other

        # Items update
        db_items: list[LocalPurchaseItem] | None = None
        if payload.items is not None:
            if not payload.items:
                raise BadRequestException("Please add at least one product item.")
            for item in payload.items:
                if float(item.unit_rate or 0) <= 0:
                    raise BadRequestException(f"Unit rate for product '{item.product_name}' must be greater than 0.")

            calc_result = self.calculate_landing_rates(
                packing_forwarding=packing,
                transport_expense=transport,
                offloading_expense=offloading,
                other_expense=other,
                items=[i.model_dump() for i in payload.items],
            )
            purchase.total_expenses = calc_result["total_expenses"]
            purchase.loading_expense_pct = calc_result["loading_expense_pct"]
            purchase.items_total_basic = calc_result["items_total_basic"]
            purchase.items_total_vat = calc_result["items_total_vat"]
            purchase.items_total_landing = calc_result["items_total_landing"]
            purchase.total_quantity = calc_result["total_quantity"]

            # Enforce invoice reconciliation: strictly block if discrepancy > 0.05
            items_gross = round(purchase.items_total_basic + purchase.items_total_vat, 2)
            diff = round(abs(float(purchase.invoice_total_value) - items_gross), 2)
            if diff > 0.05:
                raise BadRequestException(
                    f"Invoice reconciliation discrepancy detected: entered invoice total ({purchase.invoice_total_value}) "
                    f"differs from calculated items total with VAT ({items_gross}) by {diff}. "
                    "Please reconcile line items and VAT before saving."
                )

            db_items = []
            for itm in calc_result["items"]:
                db_item = LocalPurchaseItem(
                    product_id=itm.get("product_id"),
                    product_name=itm["product_name"],
                    product_code=itm.get("product_code"),
                    hsn_code=itm.get("hsn_code"),
                    quantity=itm["quantity"],
                    unit_rate=itm["unit_rate"],
                    vat_rate=itm["vat_rate"],
                    item_total=itm["item_total"],
                    vat_amount=itm["vat_amount"],
                    expense_per_unit=itm["expense_per_unit"],
                    unit_landing_rate=itm["unit_landing_rate"],
                    total_landing_rate=itm["total_landing_rate"],
                )
                db_items.append(db_item)
        else:
            # Recalculate with existing items if only expenses changed
            existing_dicts = [
                {
                    "product_id": i.product_id,
                    "product_name": i.product_name,
                    "product_code": i.product_code,
                    "hsn_code": i.hsn_code,
                    "quantity": i.quantity,
                    "unit_rate": i.unit_rate,
                    "vat_rate": i.vat_rate,
                }
                for i in purchase.items
            ]
            calc_result = self.calculate_landing_rates(
                packing_forwarding=packing,
                transport_expense=transport,
                offloading_expense=offloading,
                other_expense=other,
                items=existing_dicts,
            )
            purchase.total_expenses = calc_result["total_expenses"]
            purchase.loading_expense_pct = calc_result["loading_expense_pct"]
            purchase.items_total_basic = calc_result["items_total_basic"]
            purchase.items_total_vat = calc_result["items_total_vat"]
            purchase.items_total_landing = calc_result["items_total_landing"]
            purchase.total_quantity = calc_result["total_quantity"]

            # Update existing items in-place
            for idx, i in enumerate(purchase.items):
                itm = calc_result["items"][idx]
                i.expense_per_unit = itm["expense_per_unit"]
                i.unit_landing_rate = itm["unit_landing_rate"]
                i.total_landing_rate = itm["total_landing_rate"]

        updated = await self.repo.update_purchase(purchase, db_items)
        return updated

    async def get_purchase(self, purchase_id: uuid.UUID) -> LocalPurchase:
        """Fetch local purchase by ID with items."""
        purchase = await self.repo.get_with_items(purchase_id)
        if not purchase:
            raise NotFoundException(f"Local purchase with id {purchase_id} not found.")
        return purchase

    async def delete_purchase(self, purchase_id: uuid.UUID) -> None:
        """Soft delete a local purchase."""
        purchase = await self.repo.get_with_items(purchase_id)
        if not purchase:
            raise NotFoundException(f"Local purchase with id {purchase_id} not found.")
        await self.repo.delete(purchase)

    async def inward_purchase(
        self,
        purchase_id: uuid.UUID,
        inward_data: Any,
        created_by_id: uuid.UUID | None = None,
        created_by_name: str | None = None,
    ) -> LocalPurchase:
        """Inward an existing local purchase into warehouse stock ledger.
        Creates a StockMovement (INWARD), updates warehouse inventory,
        marks Local Purchase status as 'Inwarded', and links the slip number.
        """
        from app.stock.schemas import StockMovementCreate, StockMovementItemCreate
        from app.stock.service import StockMovementService

        purchase = await self.get_purchase(purchase_id)

        if purchase.stock_movement_id:
            msg = f"Purchase invoice '{purchase.invoice_no}' has already been inwarded"
            if purchase.stock_movement_number:
                msg += f" under slip {purchase.stock_movement_number}"
            raise BadRequestException(msg)

        # Build line items for StockMovement
        items_to_inward: list[StockMovementItemCreate] = []

        if hasattr(inward_data, "items") and inward_data.items and len(inward_data.items) > 0:
            for itm in inward_data.items:
                dmg = float(getattr(itm, "damaged_quantity", 0.0) or 0.0)
                qty = float(getattr(itm, "quantity", 0.0) or 0.0)
                exp = float(getattr(itm, "expected_quantity", 0.0) or 0.0)
                if dmg > 0 and qty == exp and qty > 0:
                    accepted_qty = max(0.0, qty - dmg)
                elif qty > 0:
                    accepted_qty = qty
                else:
                    accepted_qty = max(0.0, exp - dmg)

                items_to_inward.append(
                    StockMovementItemCreate(
                        product_id=itm.product_id,
                        product_name=itm.product_name,
                        product_code=itm.product_code,
                        expected_quantity=exp,
                        quantity=qty,
                        damaged_quantity=dmg,
                        accepted_quantity=accepted_qty,
                        unit_rate=itm.unit_rate,
                        remarks=itm.remarks,
                    )
                )
        else:
            # Default: inward all items from the purchase
            for p_item in purchase.items:
                items_to_inward.append(
                    StockMovementItemCreate(
                        product_id=p_item.product_id,
                        product_name=p_item.product_name,
                        product_code=p_item.product_code,
                        expected_quantity=float(p_item.quantity),
                        quantity=float(p_item.quantity),
                        damaged_quantity=0.0,
                        accepted_quantity=float(p_item.quantity),
                        unit_rate=float(p_item.unit_rate),
                    )
                )

        movement_payload = StockMovementCreate(
            movement_type="inward",
            movement_date=getattr(inward_data, "movement_date", None) or purchase.invoice_date,
            source_type="local_purchase",
            purchase_id=purchase.id,
            purchase_invoice_no=purchase.invoice_no,
            supplier_id=purchase.supplier_id,
            supplier_name=purchase.supplier_name,
            warehouse_location=getattr(inward_data, "warehouse_location", None) or "Main Godown",
            vehicle_no=getattr(inward_data, "vehicle_no", None),
            transporter_name=getattr(inward_data, "transporter_name", None),
            container_no=getattr(inward_data, "container_no", None),
            reference_no=purchase.invoice_no,
            remarks=getattr(inward_data, "remarks", None) or f"Auto-inwarded from Local Purchase {purchase.invoice_no}",
            items=items_to_inward,
        )

        stock_service = StockMovementService(self.session)
        movement = await stock_service.create_movement(
            data=movement_payload,
            created_by_id=created_by_id,
            created_by_name=created_by_name,
        )

        # Update Local Purchase status and link movement
        purchase.status = "Inwarded"
        purchase.stock_movement_id = movement.id
        purchase.stock_movement_number = movement.movement_no

        await self.session.flush()
        return purchase

    async def match_product(self, name_or_code: str) -> tuple[uuid.UUID | None, str | None, str | None, float]:
        """Fuzzy match product in Product Master to inherit ID, Code, HSN, and VAT %."""
        clean = name_or_code.strip()
        if not clean or not self.session:
            return None, None, None, 0.0

        stmt = (
            select(Product)
            .where(
                Product.deleted_at.is_(None),
                or_(
                    Product.product_name.ilike(f"%{clean}%"),
                    Product.product_code.ilike(f"%{clean}%"),
                    Product.product_name_tally.ilike(f"%{clean}%"),
                ),
            )
            .limit(1)
        )
        res = await self.session.execute(stmt)
        prod = res.scalars().first()
        if prod:
            hsn_str: str | None = None
            hsn_obj = None
            if prod.hsn_id:
                hsn_obj = await self.session.get(HsnCode, prod.hsn_id)
                if hsn_obj:
                    hsn_str = hsn_obj.code
            vat = (
                float(prod.purchase_vat_percent)
                if prod.purchase_vat_percent is not None
                else (float(hsn_obj.purchase_vat_percent) if hsn_obj and hsn_obj.purchase_vat_percent is not None else 0.0)
            )
            return prod.id, prod.product_code, hsn_str, vat
        return None, None, None, 0.0

    async def match_supplier(self, name: str) -> tuple[uuid.UUID | None, str]:
        """Fuzzy match supplier in Supplier Master."""
        clean = name.strip()
        if not clean or not self.session:
            return None, name

        stmt = (
            select(Supplier)
            .where(
                Supplier.deleted_at.is_(None),
                Supplier.company_name.ilike(f"%{clean}%"),
            )
            .limit(1)
        )
        sup = (await self.session.execute(stmt)).scalars().first()
        if sup:
            return sup.id, sup.company_name
        return None, name

    async def extract_bill(
        self,
        file_bytes: bytes,
        filename: str,
    ) -> BillExtractionResponse:
        """
        Multi-modal Bill Extraction Engine:
        - Excel (.xlsx, .xls, .csv): parsed via openpyxl / csv
        - PDF: parsed via pypdf text extraction + Vision AI fallback on scanned images
        - Images (.png, .jpg, .jpeg, .webp): parsed via GPT-4o-mini Vision
        - Files are automatically saved to Supabase Storage in 'purchase-bills' bucket
        """
        # Upload bill file directly to Supabase Storage
        bill_file_url: str | None = None
        try:
            from app.common.storage import upload_to_supabase, guess_content_type
            safe_name = f"{uuid.uuid4().hex[:12]}_{filename}"
            bill_file_url = await upload_to_supabase(
                bucket="purchase-bills",
                filename=safe_name,
                content=file_bytes,
                content_type=guess_content_type(filename),
            )
        except Exception as err:
            logger.warning("Supabase storage upload failed for bill %s: %s", filename, err)

        ext = filename.lower().split(".")[-1]

        if ext in ("xlsx", "xls", "csv"):
            result = await self._extract_from_excel(file_bytes, ext)
        elif ext == "pdf":
            result = await self._extract_from_pdf(file_bytes)
        elif ext in ("png", "jpg", "jpeg", "webp"):
            result = await self._extract_from_image(file_bytes, ext)
        else:
            raise BadRequestException(f"Unsupported bill file format '.{ext}'. Please upload PDF, Image, or Excel (.xlsx/.csv).")

        if bill_file_url:
            result.bill_file_url = bill_file_url

        return result

    async def _extract_from_excel(self, file_bytes: bytes, ext: str) -> BillExtractionResponse:
        """Extract items from an Excel or CSV invoice."""
        from openpyxl import load_workbook

        rows: list[list[Any]] = []
        if ext == "csv":
            text = file_bytes.decode("utf-8", errors="replace")
            reader = csv.reader(io.StringIO(text))
            rows = list(reader)
        else:
            wb = load_workbook(io.BytesIO(file_bytes), data_only=True)
            ws = wb.active
            if ws:
                for row in ws.iter_rows(values_only=True):
                    rows.append(list(row))

        if not rows:
            return BillExtractionResponse(notes="Excel file was empty.")

        # 1. Parse Top Metadata (Supplier, Invoice No, Date, etc.)
        sup_name: str | None = None
        inv_no: str | None = None
        inv_date: date | None = None
        currency: str = "RMB"
        inv_total_explicit: float | None = None

        for r in rows[:15]:
            if not r:
                continue
            for idx, cell in enumerate(r):
                if cell is None:
                    continue
                txt = str(cell).strip().lower()
                val = str(r[idx + 1]).strip() if idx + 1 < len(r) and r[idx + 1] is not None else None

                if any(k in txt for k in ("supplier", "vendor", "company")) and not sup_name and val:
                    sup_name = val
                elif any(k in txt for k in ("invoice no", "inv no", "bill no", "invoice #")) and not inv_no and val:
                    inv_no = val
                elif any(k in txt for k in ("invoice date", "bill date", "date:")) and not inv_date and val:
                    try:
                        inv_date = date.fromisoformat(val[:10])
                    except Exception:
                        pass
                elif "currency" in txt and val:
                    currency = val

        # 2. Find header row & map columns
        header_idx = -1
        col_map: dict[str, int] = {}
        for r_idx, row in enumerate(rows[:20]):
            for c_idx, cell in enumerate(row):
                if cell is None:
                    continue
                c_low = str(cell).lower().strip()
                if any(k in c_low for k in ("item total", "line total", "total (", "amount")):
                    col_map["item_total"] = c_idx
                elif any(k in c_low for k in ("hsn", "sac")):
                    col_map["hsn_code"] = c_idx
                elif any(k in c_low for k in ("vat %", "vat rate", "tax %", "gst")):
                    col_map["vat_rate"] = c_idx
                elif any(k in c_low for k in ("unit rate", "unit price", "rate (", "price")):
                    col_map["unit_rate"] = c_idx
                elif any(k in c_low for k in ("qty", "quantity", "count", "nos", "pcs")):
                    col_map["quantity"] = c_idx
                elif any(k in c_low for k in ("product code", "item code", "item no", "code", "model", "part no")):
                    col_map["product_code"] = c_idx
                elif any(k in c_low for k in ("product name", "description", "product", "item name")):
                    col_map["product_name"] = c_idx

            if "product_name" in col_map or "product_code" in col_map:
                header_idx = r_idx
                break

        # Match supplier in Supplier Master
        sup_id, matched_sup_name = await self.match_supplier(sup_name or "") if sup_name else (None, None)

        extracted_items: list[BillExtractionItem] = []
        if header_idx >= 0:
            for row in rows[header_idx + 1:]:
                if not row or all(c is None or str(c).strip() == "" for c in row):
                    continue

                # Skip summary / total rows
                row_str = " ".join(str(c).lower() for c in row if c is not None)
                if any(w in row_str for w in ("total", "sub total", "grand total", "vat", "basic")):
                    for c in row:
                        try:
                            f_val = float(str(c).replace(",", ""))
                            if f_val > 0:
                                inv_total_explicit = f_val
                        except Exception:
                            pass
                    continue

                name = str(row[col_map["product_name"]]).strip() if "product_name" in col_map and row[col_map["product_name"]] else ""
                code = str(row[col_map["product_code"]]).strip() if "product_code" in col_map and row[col_map["product_code"]] else None
                hsn = str(row[col_map["hsn_code"]]).strip() if "hsn_code" in col_map and row[col_map["hsn_code"]] else None

                if not name and not code:
                    continue

                # Extract quantity
                qty_raw = row[col_map["quantity"]] if "quantity" in col_map else 1
                try:
                    qty = float(re.sub(r"[^\d.]", "", str(qty_raw))) if qty_raw else 1.0
                except ValueError:
                    qty = 1.0

                # Extract unit rate
                rate_raw = row[col_map["unit_rate"]] if "unit_rate" in col_map else 0
                try:
                    rate = float(re.sub(r"[^\d.]", "", str(rate_raw))) if rate_raw else 0.0
                except ValueError:
                    rate = 0.0

                # Extract VAT %
                vat_raw = row[col_map["vat_rate"]] if "vat_rate" in col_map else 0
                try:
                    vat = float(re.sub(r"[^\d.]", "", str(vat_raw))) if vat_raw else 0.0
                except ValueError:
                    vat = 0.0

                if not name and code:
                    name = code

                # Match in product master
                p_id, p_code, p_hsn, p_vat = await self.match_product(code or name)

                extracted_items.append(
                    BillExtractionItem(
                        product_name=name,
                        product_code=code or p_code,
                        hsn_code=hsn or p_hsn,
                        quantity=qty,
                        unit_rate=rate,
                        vat_rate=vat if vat > 0 else p_vat,
                        item_total=round(qty * rate, 2),
                        matched_product_id=p_id,
                    )
                )

        calculated_invoice_val = sum(i.item_total * (1 + (i.vat_rate / 100.0)) for i in extracted_items)
        final_inv_val = inv_total_explicit or round(calculated_invoice_val, 2) if calculated_invoice_val > 0 else None

        return BillExtractionResponse(
            supplier_name=matched_sup_name or sup_name,
            supplier_id=sup_id,
            invoice_no=inv_no,
            invoice_date=inv_date,
            currency=currency,
            invoice_total_value=final_inv_val,
            items=extracted_items,
            confidence=0.95,
            notes=f"Extracted {len(extracted_items)} items from spreadsheet.",
        )

    async def _extract_from_pdf(self, file_bytes: bytes) -> BillExtractionResponse:
        """Extract invoice details and items from PDF."""
        # Read text via pypdf
        reader = PdfReader(io.BytesIO(file_bytes))
        full_text = ""
        for page in reader.pages:
            t = page.extract_text()
            if t:
                full_text += t + "\n"

        if not full_text.strip():
            # Scanned PDF: Check for embedded images in pages
            openai_key = os.getenv("OPENAI_API_KEY", "").strip() or OPENAI_API_KEY
            if openai_key:
                for page in reader.pages:
                    if getattr(page, "images", None) and len(page.images) > 0:
                        try:
                            first_img = page.images[0]
                            mime = "image/png" if first_img.name.lower().endswith(".png") else "image/jpeg"
                            return await self._extract_with_vision(first_img.data, openai_key, mime_type=mime)
                        except Exception as e:
                            logger.warning("PDF vision extraction from embedded image failed: %s", e)

            return BillExtractionResponse(
                notes="Could not extract text from PDF: The document contains no selectable digital text layer (it may be a scanned image or vector drawing). Please upload a digital text invoice, image photo, or Excel sheet (.xlsx/.csv).",
                items=[],
            )

        # Attempt AI extraction if OpenAI or Gemini key is configured
        openai_key = os.getenv("OPENAI_API_KEY", "").strip() or OPENAI_API_KEY
        if openai_key:
            try:
                return await self._extract_with_openai(full_text, openai_key)
            except Exception as e:
                logger.warning("OpenAI bill extraction failed, falling back to regex: %s", e)

        # Regex fallback parser
        return await self._extract_with_regex(full_text)

    async def _extract_from_image(self, file_bytes: bytes, ext: str) -> BillExtractionResponse:
        """Extract invoice details and items directly from an image file using GPT-4o-mini Vision."""
        openai_key = os.getenv("OPENAI_API_KEY", "").strip() or OPENAI_API_KEY
        if not openai_key:
            return BillExtractionResponse(
                notes="OpenAI API key is not configured for image bill extraction.",
                items=[],
            )
        mime_map = {
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "webp": "image/webp",
        }
        mime_type = mime_map.get(ext.lower(), "image/jpeg")
        return await self._extract_with_vision(file_bytes, openai_key, mime_type=mime_type)

    async def _extract_with_vision(self, image_bytes: bytes, api_key: str, mime_type: str = "image/jpeg") -> BillExtractionResponse:
        """Use GPT-4o-mini Vision to parse structured bill details from an invoice image."""
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        prompt = (
            "You are an expert procurement accountant. Extract invoice details from the attached invoice image.\n"
            "Return valid JSON matching this structure exactly:\n"
            "{\n"
            '  "supplier_name": "Supplier Company Name",\n'
            '  "invoice_no": "INV-12345",\n'
            '  "invoice_date": "YYYY-MM-DD",\n'
            '  "currency": "INR",\n'
            '  "invoice_total_value": 12345.67,\n'
            '  "items": [\n'
            '    {"product_name": "...", "product_code": "...", "hsn_code": "...", "quantity": 10, "unit_rate": 50.0, "vat_rate": 18.0, "item_total": 500.0}\n'
            "  ]\n"
            "}"
        )
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": "gpt-4o-mini",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{b64}",
                                "detail": "high"
                            }
                        }
                    ]
                }
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)

            # Match supplier
            sup_name = parsed.get("supplier_name") or ""
            sup_id, matched_sup_name = await self.match_supplier(sup_name) if sup_name else (None, None)

            # Match items
            items: list[BillExtractionItem] = []
            for itm in parsed.get("items", []):
                p_name = itm.get("product_name") or "Item"
                p_code = itm.get("product_code")
                p_id, match_code, match_hsn, match_vat = await self.match_product(p_code or p_name)

                items.append(
                    BillExtractionItem(
                        product_name=p_name,
                        product_code=p_code or match_code,
                        hsn_code=itm.get("hsn_code") or match_hsn,
                        quantity=float(itm.get("quantity") or 1),
                        unit_rate=float(itm.get("unit_rate") or 0),
                        vat_rate=float(itm.get("vat_rate") or match_vat),
                        item_total=float(itm.get("item_total") or 0),
                        matched_product_id=p_id,
                    )
                )

            inv_date = None
            if parsed.get("invoice_date"):
                try:
                    inv_date = date.fromisoformat(str(parsed["invoice_date"]).strip()[:10])
                except ValueError:
                    inv_date = None

            return BillExtractionResponse(
                supplier_name=matched_sup_name or sup_name,
                supplier_id=sup_id,
                invoice_no=parsed.get("invoice_no"),
                invoice_date=inv_date,
                currency=parsed.get("currency") or "RMB",
                invoice_total_value=parsed.get("invoice_total_value"),
                items=items,
                confidence=0.95,
                notes="Extracted via Vision AI bill parser.",
            )

    async def _extract_with_openai(self, text: str, api_key: str) -> BillExtractionResponse:
        """Use OpenAI to parse structured bill details."""
        prompt = (
            "You are an expert procurement accountant. Extract invoice details from the following invoice text.\n"
            "Return valid JSON matching this structure exactly:\n"
            "{\n"
            '  "supplier_name": "Supplier Company Name",\n'
            '  "invoice_no": "INV-12345",\n'
            '  "invoice_date": "YYYY-MM-DD",\n'
            '  "currency": "RMB",\n'
            '  "invoice_total_value": 12345.67,\n'
            '  "items": [\n'
            '    {"product_name": "...", "product_code": "...", "hsn_code": "...", "quantity": 10, "unit_rate": 50.0, "vat_rate": 13.0, "item_total": 500.0}\n'
            "  ]\n"
            "}\n\n"
            f"Invoice Text:\n{text[:4000]}"
        )

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": OPENAI_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
        }

        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)

            # Match supplier
            sup_name = parsed.get("supplier_name") or ""
            sup_id, matched_sup_name = await self.match_supplier(sup_name) if sup_name else (None, None)

            # Match items
            items: list[BillExtractionItem] = []
            for itm in parsed.get("items", []):
                p_name = itm.get("product_name") or "Item"
                p_code = itm.get("product_code")
                p_id, match_code, match_hsn, match_vat = await self.match_product(p_code or p_name)

                items.append(
                    BillExtractionItem(
                        product_name=p_name,
                        product_code=p_code or match_code,
                        hsn_code=itm.get("hsn_code") or match_hsn,
                        quantity=float(itm.get("quantity") or 1),
                        unit_rate=float(itm.get("unit_rate") or 0),
                        vat_rate=float(itm.get("vat_rate") or match_vat),
                        item_total=float(itm.get("item_total") or 0),
                        matched_product_id=p_id,
                    )
                )

            inv_date = None
            if parsed.get("invoice_date"):
                try:
                    inv_date = date.fromisoformat(str(parsed["invoice_date"]).strip()[:10])
                except ValueError:
                    inv_date = None

            return BillExtractionResponse(
                supplier_name=matched_sup_name or sup_name,
                supplier_id=sup_id,
                invoice_no=parsed.get("invoice_no"),
                invoice_date=inv_date,
                currency=parsed.get("currency") or "RMB",
                invoice_total_value=parsed.get("invoice_total_value"),
                items=items,
                confidence=0.95,
                notes="Extracted via AI bill parser.",
            )

    async def _extract_with_regex(self, text: str) -> BillExtractionResponse:
        """Regex-based fallback extraction for invoice number, date, and amounts."""
        # Invoice number pattern
        inv_match = re.search(r"(?:invoice\s*(?:no|number|#)|inv\s*#?)[:\s]*([A-Za-z0-9\-_/]+)", text, re.I)
        invoice_no = inv_match.group(1).strip() if inv_match else None

        # Date pattern (YYYY-MM-DD or DD/MM/YYYY or DD-MM-YYYY)
        date_match = re.search(r"(?:date|inv\s*date)[:\s]*(\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]\d{4})", text, re.I)
        inv_date = None
        if date_match:
            d_str = date_match.group(1).replace("/", "-")
            try:
                parts = d_str.split("-")
                if len(parts[0]) == 4:
                    inv_date = date(int(parts[0]), int(parts[1]), int(parts[2]))
                else:
                    inv_date = date(int(parts[2]), int(parts[1]), int(parts[0]))
            except ValueError:
                inv_date = None

        # Total amount pattern
        total_match = re.search(r"(?:total\s*(?:amount|value|inr|rmb)?|grand\s*total)[:\s]*[¥₹$]?\s*([\d,]+\.?\d*)", text, re.I)
        total_val = None
        if total_match:
            try:
                total_val = float(total_match.group(1).replace(",", ""))
            except ValueError:
                total_val = None

        return BillExtractionResponse(
            invoice_no=invoice_no,
            invoice_date=inv_date,
            currency="RMB",
            invoice_total_value=total_val,
            confidence=0.6,
            notes="Extracted via pattern matching.",
        )

    def export_excel(self, purchases: list[LocalPurchase]) -> io.BytesIO:
        """Export local purchases to corporate-styled Excel (.xlsx)."""
        wb = Workbook()
        ws: Any = wb.active or wb.create_sheet(title="Local Purchases")
        ws.title = "Local Purchases"

        # Headers
        headers = [
            "Invoice No",
            "Invoice Date",
            "Supplier",
            "Currency",
            "Invoice Total Value",
            "Total Expenses",
            "% Loading Exp",
            "Basic Items Total",
            "VAT Total",
            "Landing Items Total",
            "Quantity",
            "Status",
            "Created By",
            "Created On",
        ]
        ws.append(headers)

        # Style Header
        header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        thin_border = Border(
            left=Side(style="thin", color="CBD5E1"),
            right=Side(style="thin", color="CBD5E1"),
            top=Side(style="thin", color="CBD5E1"),
            bottom=Side(style="thin", color="CBD5E1"),
        )
        zebra_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")

        for col_num in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=col_num)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = thin_border
        ws.row_dimensions[1].height = 28

        # Populate rows
        currency_format = "#,##0.00"
        for r_idx, p in enumerate(purchases, start=2):
            row = [
                p.invoice_no,
                p.invoice_date.strftime("%Y-%m-%d") if p.invoice_date else "",
                p.supplier_name,
                p.currency,
                float(p.invoice_total_value),
                float(p.total_expenses),
                float(p.loading_expense_pct),
                float(p.items_total_basic),
                float(p.items_total_vat),
                float(p.items_total_landing),
                float(p.total_quantity),
                p.status,
                p.created_by_name or "",
                p.created_at.strftime("%Y-%m-%d %H:%M") if p.created_at else "",
            ]
            ws.append(row)
            ws.row_dimensions[r_idx].height = 20

            is_even = (r_idx % 2 == 0)
            for c_idx in range(1, len(headers) + 1):
                cell = ws.cell(row=r_idx, column=c_idx)
                cell.border = thin_border
                cell.font = Font(name="Calibri", size=10)
                if is_even:
                    cell.fill = zebra_fill

                # Number formatting
                if c_idx in (5, 6, 8, 9, 10):
                    cell.number_format = currency_format
                    cell.alignment = Alignment(horizontal="right", vertical="center")
                elif c_idx in (7, 11):
                    cell.number_format = "0.00"
                    cell.alignment = Alignment(horizontal="right", vertical="center")
                elif c_idx in (2, 4, 12, 14):
                    cell.alignment = Alignment(horizontal="center", vertical="center")
                else:
                    cell.alignment = Alignment(horizontal="left", vertical="center")

        # Auto-adjust column widths
        for c_idx in range(1, len(headers) + 1):
            col_letter = get_column_letter(c_idx)
            max_len = max(len(str(ws.cell(row=r, column=c_idx).value or "")) for r in range(1, len(purchases) + 2))
            ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

        ws.freeze_panes = "A2"
        ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{len(purchases) + 1}"

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output

    async def get_planning_items(
        self,
        organization_id: uuid.UUID | None = None,
        branch_id: str | None = None,
        branch_name: str | None = None,
        supplier_name: str | None = None,
        supplier_id: uuid.UUID | None = None,
    ) -> dict[str, Any]:
        """
        Fetch planned items from Shipment Planning for a specific Organization, Branch, and Supplier.
        """
        if not supplier_name and supplier_id:
            sup = await self.session.get(Supplier, supplier_id)
            if sup:
                supplier_name = sup.company_name

        clean_sup = (supplier_name or "").strip().lower()
        if not clean_sup:
            return {"items": [], "sheet_name": None, "count": 0, "message": "No supplier specified."}

        # 1. Query sheets
        stmt = select(PlanningSheet).where(PlanningSheet.deleted_at.is_(None))
        if organization_id:
            stmt = stmt.where(PlanningSheet.organization_id == organization_id)
        q_sheets = await self.session.execute(stmt)
        sheets = q_sheets.scalars().all()
        if not sheets:
            return {"items": [], "sheet_name": None, "count": 0, "message": "No shipment planning sheets found."}

        # 2. Match the sheet by branch_id or branch_name
        matched_sheet: PlanningSheet | None = None
        if branch_id:
            matched_sheet = next(
                (s for s in sheets if s.branch_id and s.branch_id.strip().lower() == branch_id.strip().lower()),
                None,
            )

        if not matched_sheet and branch_name:
            clean_branch = branch_name.strip().lower()
            matched_sheet = next(
                (s for s in sheets if clean_branch in s.name.lower() or (s.branch_id and clean_branch in s.branch_id.lower())),
                None,
            )

        if not matched_sheet and not branch_id and not branch_name and len(sheets) == 1:
            matched_sheet = sheets[0]

        if not matched_sheet:
            return {"items": [], "sheet_name": None, "count": 0, "message": "No matching shipment planning sheet found for this branch."}

        # 3. Query columns in this sheet
        q_cols = await self.session.execute(
            select(PlanningColumn).where(
                PlanningColumn.sheet_id == matched_sheet.id,
                PlanningColumn.deleted_at.is_(None),
            )
        )
        cols = q_cols.scalars().all()
        sup_col = next((c for c in cols if "supplier" in c.name.strip().lower()), None)
        qty_col = next((c for c in cols if "pkg qty" in c.name.strip().lower() or c.name.strip().lower() in ("qty", "quantity")), None)

        if not sup_col:
            return {"items": [], "sheet_name": matched_sheet.name, "count": 0, "message": "Sheet does not have a Supplier Name column."}

        # 4. Query active rows in this sheet
        q_rows = await self.session.execute(
            select(PlanningRow).where(
                PlanningRow.sheet_id == matched_sheet.id,
                PlanningRow.deleted_at.is_(None),
            )
        )
        rows = q_rows.scalars().all()
        if not rows:
            return {"items": [], "sheet_name": matched_sheet.name, "count": 0}

        row_ids = [r.id for r in rows]

        # 5. Query relevant cells in batch
        cols_to_fetch = [sup_col.id]
        if qty_col:
            cols_to_fetch.append(qty_col.id)

        q_cells = await self.session.execute(
            select(PlanningCell).where(
                PlanningCell.row_id.in_(row_ids),
                PlanningCell.column_id.in_(cols_to_fetch),
            )
        )
        cells = q_cells.scalars().all()
        cell_map = {(c.row_id, c.column_id): c.value for c in cells}

        # 6. Filter rows by supplier matching
        matched_rows: list[tuple[PlanningRow, float]] = []
        for r in rows:
            sup_val = cell_map.get((r.id, sup_col.id))
            if sup_val and isinstance(sup_val, str) and (clean_sup in sup_val.strip().lower() or sup_val.strip().lower() in clean_sup):
                qty_val = cell_map.get((r.id, qty_col.id)) if qty_col else None
                try:
                    qty = float(qty_val) if qty_val is not None and qty_val.strip() else 1.0
                    if qty <= 0:
                        qty = 1.0
                except (ValueError, TypeError):
                    qty = 1.0
                matched_rows.append((r, qty))

        if not matched_rows:
            return {"items": [], "sheet_name": matched_sheet.name, "count": 0}

        # 7. Resolve Product Master details
        prod_ids = [r.linked_record_id for r, _ in matched_rows if r.linked_record_id]
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
        hsn_map: dict[uuid.UUID, HsnCode] = {}
        if hsn_ids:
            q_hsn = await self.session.execute(
                select(HsnCode).where(HsnCode.id.in_(hsn_ids))
            )
            for h in q_hsn.scalars().all():
                hsn_map[h.id] = h

        items: list[dict[str, Any]] = []
        for r, qty in matched_rows:
            prod = prod_map.get(r.linked_record_id) if r.linked_record_id else None
            if not prod:
                # Fallback: search product by name/label
                q_p = await self.session.execute(
                    select(Product).where(
                        Product.deleted_at.is_(None),
                        or_(
                            Product.product_name.ilike(r.label.strip()),
                            Product.product_name_tally.ilike(r.label.strip()),
                        ),
                    )
                )
                prod = q_p.scalars().first()
                if prod and prod.hsn_id and prod.hsn_id not in hsn_map:
                    h = await self.session.get(HsnCode, prod.hsn_id)
                    if h:
                        hsn_map[prod.hsn_id] = h

            if prod:
                hsn_obj = hsn_map.get(prod.hsn_id) if prod.hsn_id else None
                hsn_code = hsn_obj.code if hsn_obj else None
                unit_rate = float(prod.standard_cost or 0.0)
                vat_rate = (
                    float(prod.purchase_vat_percent)
                    if prod.purchase_vat_percent is not None
                    else (float(hsn_obj.purchase_vat_percent) if hsn_obj and hsn_obj.purchase_vat_percent is not None else 0.0)
                )
                item_total = round(qty * unit_rate, 2)
                vat_amount = round(item_total * (vat_rate / 100.0), 2)
                items.append({
                    "product_id": str(prod.id),
                    "product_name": prod.product_name,
                    "product_code": prod.product_code,
                    "hsn_code": hsn_code,
                    "quantity": qty,
                    "unit_rate": unit_rate,
                    "vat_rate": vat_rate,
                    "item_total": item_total,
                    "vat_amount": vat_amount,
                    "expense_per_unit": 0.0,
                    "unit_landing_rate": unit_rate,
                    "total_landing_rate": item_total,
                    "planning_sheet_name": matched_sheet.name,
                    "planning_row_id": str(r.id),
                })
            else:
                items.append({
                    "product_id": str(uuid.uuid4()),
                    "product_name": r.label,
                    "product_code": None,
                    "hsn_code": None,
                    "quantity": qty,
                    "unit_rate": 0.0,
                    "vat_rate": 0.0,
                    "item_total": 0.0,
                    "vat_amount": 0.0,
                    "expense_per_unit": 0.0,
                    "unit_landing_rate": 0.0,
                    "total_landing_rate": 0.0,
                    "planning_sheet_name": matched_sheet.name,
                    "planning_row_id": str(r.id),
                })

        return {
            "items": items,
            "sheet_name": matched_sheet.name,
            "count": len(items),
        }

    async def get_consignments_lookup(self, force_refresh: bool = False) -> list[SheetConsignmentLookup]:
        """
        Fetch all active planning sheets, their organization/branch bindings,
        group labels, and all active consignment columns with planned items counts.
        Optimized single-batch query with in-memory TTL caching.
        """
        now = time.time()
        if not force_refresh and _CONSIGNMENTS_LOOKUP_CACHE["data"] is not None:
            if now - _CONSIGNMENTS_LOOKUP_CACHE["timestamp"] < _CONSIGNMENTS_CACHE_TTL_SECONDS:
                return _CONSIGNMENTS_LOOKUP_CACHE["data"]

        stmt = (
            select(PlanningSheet, MasterCompany)
            .outerjoin(MasterCompany, MasterCompany.id == PlanningSheet.organization_id)
            .where(PlanningSheet.deleted_at.is_(None))
            .order_by(PlanningSheet.name.asc())
        )
        res = await self.session.execute(stmt)
        sheets_with_companies = res.all()
        if not sheets_with_companies:
            return []

        sheet_ids = [sheet.id for sheet, _ in sheets_with_companies]

        # Single query for all columns belonging to these active sheets
        col_stmt = (
            select(PlanningColumn)
            .where(PlanningColumn.sheet_id.in_(sheet_ids), PlanningColumn.deleted_at.is_(None))
            .order_by(PlanningColumn.position.asc())
        )
        col_res = await self.session.execute(col_stmt)
        all_columns = col_res.scalars().all()

        valid_cols_by_sheet: dict[uuid.UUID, list[PlanningColumn]] = {}
        target_column_ids: list[uuid.UUID] = []

        for col in all_columns:
            cl = col.name.strip().lower()
            if any(x in cl for x in ("remark", "total", "pkg", "tally", "approval", "supplier", "city", "weight", "cbm")):
                continue
            if not re.search(r"([A-Za-z]+)[\s\-]*(\d+)", col.name):
                continue
            valid_cols_by_sheet.setdefault(col.sheet_id, []).append(col)
            target_column_ids.append(col.id)

        # Single aggregated query for planned items count across all target consignment columns
        counts_by_col: dict[uuid.UUID, int] = {}
        if target_column_ids:
            count_stmt = text("""
                SELECT pc.column_id, count(*)
                FROM planning_cells pc
                JOIN planning_rows pr ON pr.id = pc.row_id
                WHERE pc.column_id = ANY(:col_ids)
                  AND pr.deleted_at IS NULL
                  AND pc.value IS NOT NULL
                  AND pc.value ~ '^[0-9]+(\\.[0-9]+)?$'
                  AND pc.value::numeric > 0
                GROUP BY pc.column_id
            """)
            col_id_strs = [str(cid) for cid in target_column_ids]
            count_res = await self.session.execute(count_stmt, {"col_ids": col_id_strs})
            for r in count_res.fetchall():
                try:
                    counts_by_col[uuid.UUID(str(r[0]))] = int(r[1])
                except Exception:
                    pass

        results: list[SheetConsignmentLookup] = []

        for sheet, company in sheets_with_companies:
            cols = valid_cols_by_sheet.get(sheet.id, [])
            if not cols:
                continue

            org_id = sheet.organization_id
            org_name = company.name if company else None

            # Resolve branch name from company's branches JSON
            branch_id = sheet.branch_id
            branch_name = None
            if company and company.branches and branch_id:
                for b in company.branches:
                    if b.get("id") == branch_id:
                        pfx = f" ({b['code_prefix']})" if b.get("code_prefix") else ""
                        branch_name = f"{b.get('name', branch_id)}{pfx}"
                        break
            if not branch_name and branch_id:
                branch_name = branch_id

            group_label = sheet.mum_group_label or "Mum"

            consignments = [
                ConsignmentColumnInfo(
                    column_id=col.id,
                    column_name=col.name,
                    consignment_code=col.name.strip(),
                    position=col.position,
                    planned_items_count=counts_by_col.get(col.id, 0),
                )
                for col in cols
            ]

            results.append(
                SheetConsignmentLookup(
                    sheet_id=sheet.id,
                    sheet_name=sheet.name,
                    organization_id=org_id,
                    organization_name=org_name,
                    branch_id=branch_id,
                    branch_name=branch_name,
                    group_label=group_label,
                    consignments=consignments,
                )
            )

        _CONSIGNMENTS_LOOKUP_CACHE["data"] = results
        _CONSIGNMENTS_LOOKUP_CACHE["timestamp"] = now

        return results

    async def get_consignment_items(
        self, column_id: uuid.UUID, supplier_id: uuid.UUID | None = None
    ) -> list[ConsignmentProductItem]:
        """
        Extract all products from a consignment column where planned quantity > 0,
        pre-populating product master standard cost, HSN, VAT rate, and supplier info.
        If supplier_id is provided, filters strictly to items belonging to that supplier.
        """
        stmt = text("""
            SELECT pr.id as row_id,
                   pr.label as item_label,
                   pr.linked_record_id as product_id,
                   NULLIF(regexp_replace(pc.value, '[^0-9.]', '', 'g'), '')::numeric as qty
            FROM planning_cells pc
            JOIN planning_rows pr ON pr.id = pc.row_id
            WHERE pc.column_id = :col_id
              AND pr.deleted_at IS NULL
              AND NULLIF(regexp_replace(pc.value, '[^0-9.]', '', 'g'), '')::numeric > 0
            ORDER BY pr.position ASC
        """)
        res = await self.session.execute(stmt, {"col_id": str(column_id)})
        rows = res.fetchall()
        if not rows:
            return []

        # Collect product IDs
        product_ids = [r[2] for r in rows if r[2] is not None]
        products_by_id: dict[uuid.UUID, Product] = {}
        hsns_by_id: dict[uuid.UUID, HsnCode] = {}
        suppliers_by_id: dict[uuid.UUID, Supplier] = {}
        product_supplier_links: dict[uuid.UUID, list[uuid.UUID]] = {}

        if product_ids:
            p_stmt = (
                select(Product)
                .where(Product.id.in_(product_ids), Product.deleted_at.is_(None))
            )
            p_res = await self.session.execute(p_stmt)
            products = p_res.scalars().all()
            products_by_id = {p.id: p for p in products}

            from app.suppliers.models import SupplierProductLink
            spl_stmt = select(SupplierProductLink.product_id, SupplierProductLink.supplier_id).where(
                SupplierProductLink.product_id.in_(product_ids)
            )
            spl_res = await self.session.execute(spl_stmt)
            for p_id, s_id in spl_res.fetchall():
                if p_id and s_id:
                    product_supplier_links.setdefault(p_id, []).append(s_id)

            supplier_ids = [p.supplier_id for p in products if p.supplier_id is not None]
            hsn_ids = [p.hsn_id for p in products if p.hsn_id is not None]

            if supplier_ids:
                s_stmt = select(Supplier).where(Supplier.id.in_(supplier_ids))
                s_res = await self.session.execute(s_stmt)
                suppliers_by_id = {s.id: s for s in s_res.scalars().all()}

            if hsn_ids:
                h_stmt = select(HsnCode).where(HsnCode.id.in_(hsn_ids))
                h_res = await self.session.execute(h_stmt)
                hsns_by_id = {h.id: h for h in h_res.scalars().all()}

        items: list[ConsignmentProductItem] = []
        for r in rows:
            row_id, item_label, prod_id, qty = r
            qty_val = float(qty or 0)
            if qty_val <= 0:
                continue

            product = products_by_id.get(prod_id) if prod_id else None
            hsn = hsns_by_id.get(product.hsn_id) if product and product.hsn_id else None
            supplier = suppliers_by_id.get(product.supplier_id) if product and product.supplier_id else None

            p_name = product.product_name if product else item_label
            p_code = product.product_code if product else None
            hsn_code = hsn.code if hsn else None
            unit_rate = 0.0
            vat_rate = (
                float(product.purchase_vat_percent)
                if product and product.purchase_vat_percent is not None
                else (float(hsn.purchase_vat_percent) if hsn and hsn.purchase_vat_percent is not None else 0.0)
            )
            item_total = round(qty_val * unit_rate, 2)

            sup_id = supplier.id if supplier else (product.supplier_id if product else None)
            sup_name = supplier.company_name if supplier else None
            sup_brand = supplier.brand_description if supplier else None
            linked_sups = product_supplier_links.get(prod_id, []) if prod_id else []

            # If supplier_id filter is requested, verify primary supplier or secondary linked supplier
            if supplier_id:
                if sup_id != supplier_id and supplier_id not in linked_sups:
                    continue

            items.append(
                ConsignmentProductItem(
                    product_id=prod_id,
                    product_name=p_name,
                    product_code=p_code,
                    hsn_code=hsn_code,
                    quantity=qty_val,
                    unit_rate=unit_rate,
                    vat_rate=vat_rate,
                    item_total=item_total,
                    supplier_id=sup_id,
                    supplier_name=sup_name,
                    supplier_brand=sup_brand,
                    linked_supplier_ids=linked_sups,
                )
            )

        return items


