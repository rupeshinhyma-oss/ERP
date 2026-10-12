"""Service layer for Price List Management Module."""

from __future__ import annotations

import io
import uuid
from typing import Any

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestException
from app.core.logging import get_logger
from app.masters.import_export import build_csv_export
from app.masters.price_list.repository import PriceListRepository
from app.masters.price_list.schemas import (
    AssignSupplierQuotePayload,
    BulkPriceUpdateRequest,
    PriceImportRowError,
    PriceImportSummary,
    PriceListItem,
    PriceListMetrics,
    PriceListUpdatePayload,
    SupplierQuoteItem,
)

logger = get_logger(__name__)


class PriceListService:
    """Service orchestrating commercial pricing, GST calculations, bulk updates, and Excel imports/exports."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = PriceListRepository(session)

    async def list_prices(
        self,
        *,
        page: int = 1,
        page_size: int = 50,
        search: str | None = None,
        category_id: uuid.UUID | None = None,
        sub_category_id: uuid.UUID | None = None,
        brand_id: uuid.UUID | None = None,
        has_price: bool | None = None,
        gst_percent: float | None = None,
        sort_by: str = "product_name_tally",
        sort_dir: str = "asc",
    ) -> tuple[list[PriceListItem], int]:
        return await self.repo.list_price_items(
            page=page,
            page_size=page_size,
            search=search,
            category_id=category_id,
            sub_category_id=sub_category_id,
            brand_id=brand_id,
            has_price=has_price,
            gst_percent=gst_percent,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )

    async def get_metrics(self) -> PriceListMetrics:
        return await self.repo.get_metrics()

    async def update_price(
        self,
        product_id: uuid.UUID,
        payload: PriceListUpdatePayload,
    ) -> PriceListItem:
        await self.repo.update_product_price(
            product_id,
            standard_price=payload.standard_price,
            minimum_price=payload.minimum_price,
            standard_cost=payload.standard_cost,
            is_inclusive=payload.is_inclusive,
        )
        await self.session.flush()

        # Fetch refreshed item
        items, _ = await self.repo.list_price_items(page=1, page_size=1)
        # Or query specific by listing filtered by search / product_id
        # Single query fallback:
        items, _ = await self.repo.list_price_items(page=1, page_size=10, search=None)
        refreshed = next((it for it in items if it.product_id == product_id), None)
        if refreshed is None:
            # Re-query directly
            items, _ = await self.repo.list_price_items(page=1, page_size=1)
            refreshed = items[0]
        return refreshed

    async def bulk_update_prices(self, payload: BulkPriceUpdateRequest) -> dict[str, int]:
        """Update multiple product prices within a single transaction."""
        updated_count = 0
        for item in payload.items:
            await self.repo.update_product_price(
                item.product_id,
                standard_price=item.standard_price,
                minimum_price=item.minimum_price,
                standard_cost=item.standard_cost,
                is_inclusive=item.is_inclusive,
            )
            updated_count += 1

        await self.session.flush()
        return {"updated_count": updated_count}

    async def get_product_suppliers(self, product_id: uuid.UUID) -> list[SupplierQuoteItem]:
        return await self.repo.get_product_suppliers(product_id)

    async def assign_supplier_quote(
        self,
        product_id: uuid.UUID,
        payload: AssignSupplierQuotePayload,
    ) -> uuid.UUID:
        link_id = await self.repo.assign_supplier_quote(product_id, payload)
        await self.session.flush()
        return link_id

    async def delete_supplier_quote(self, link_id: uuid.UUID) -> None:
        await self.repo.delete_supplier_quote(link_id)
        await self.session.flush()

    async def export_price_list(
        self,
        *,
        file_format: str = "xlsx",
        search: str | None = None,
        category_id: uuid.UUID | None = None,
        sub_category_id: uuid.UUID | None = None,
        brand_id: uuid.UUID | None = None,
        has_price: bool | None = None,
        gst_percent: float | None = None,
    ) -> tuple[bytes, str, str]:
        """Export full price list with GST breakdown into Excel or CSV."""
        items, _ = await self.repo.list_price_items(
            page=1,
            page_size=10000,
            search=search,
            category_id=category_id,
            sub_category_id=sub_category_id,
            brand_id=brand_id,
            has_price=has_price,
            gst_percent=gst_percent,
        )

        headers = [
            "Sr. No.",
            "Product Code",
            "Product Name",
            "Category",
            "Sub-Category",
            "Brand",
            "UOM",
            "HSN Number",
            "GST (%)",
            "Standard Cost (Excl. GST)",
            "Selling Price (Excl. GST)",
            "GST Amount",
            "Selling Price (Incl. GST)",
            "Min Price (Excl. GST)",
            "Min Price (Incl. GST)",
            "Stock",
            "Suppliers",
            "Status",
        ]

        if file_format.lower() == "csv":
            rows: list[dict[str, Any]] = []
            for idx, item in enumerate(items, start=1):
                rows.append(
                    {
                        "Sr. No.": idx,
                        "Product Code": item.product_code or "",
                        "Product Name": item.product_name_tally or item.product_name,
                        "Category": item.category_name or "",
                        "Sub-Category": item.sub_category_name or "",
                        "Brand": item.brand_name or "",
                        "UOM": item.uom_code or "",
                        "HSN Number": item.hsn_number or "",
                        "GST (%)": f"{item.gst_percent:.1f}%",
                        "Standard Cost (Excl. GST)": f"{item.standard_cost:.2f}" if item.standard_cost is not None else "",
                        "Selling Price (Excl. GST)": f"{item.standard_price:.2f}" if item.standard_price is not None else "",
                        "GST Amount": f"{item.standard_price_gst_amount:.2f}" if item.standard_price_gst_amount is not None else "",
                        "Selling Price (Incl. GST)": f"{item.standard_price_inc_gst:.2f}" if item.standard_price_inc_gst is not None else "",
                        "Min Price (Excl. GST)": f"{item.minimum_price:.2f}" if item.minimum_price is not None else "",
                        "Min Price (Incl. GST)": f"{item.minimum_price_inc_gst:.2f}" if item.minimum_price_inc_gst is not None else "",
                        "Stock": f"{item.current_stock:.2f}",
                        "Suppliers": item.supplier_count,
                        "Status": "Priced" if item.has_price else "Unpriced",
                    }
                )
            csv_bytes = build_csv_export(headers, rows)
            return csv_bytes, "text/csv", "price_list.csv"

        # Styled Excel Workbook
        wb = Workbook()
        ws = wb.active
        if ws is None:
            ws = wb.create_sheet(title="Price List")
        else:
            ws.title = "Price List"
        ws.views.sheetView[0].showGridLines = True

        ws.append(headers)

        header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")  # Corporate Dark Navy
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=False)
        thin_side = Side(border_style="thin", color="CBD5E1")
        border = Border(top=thin_side, bottom=thin_side, left=thin_side, right=thin_side)

        ws.row_dimensions[1].height = 26

        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = header_alignment
            cell.border = border

        even_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
        odd_fill = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
        data_font = Font(name="Calibri", size=10, color="1E293B")

        for row_idx, item in enumerate(items, start=2):
            ws.row_dimensions[row_idx].height = 20
            row_fill = even_fill if row_idx % 2 == 0 else odd_fill

            row_data = [
                row_idx - 1,
                item.product_code or "—",
                item.product_name_tally or item.product_name or "—",
                item.category_name or "—",
                item.sub_category_name or "—",
                item.brand_name or "—",
                item.uom_code or "—",
                item.hsn_number or "—",
                f"{item.gst_percent:.1f}%",
                item.standard_cost if item.standard_cost is not None else "—",
                item.standard_price if item.standard_price is not None else "—",
                item.standard_price_gst_amount if item.standard_price_gst_amount is not None else "—",
                item.standard_price_inc_gst if item.standard_price_inc_gst is not None else "—",
                item.minimum_price if item.minimum_price is not None else "—",
                item.minimum_price_inc_gst if item.minimum_price_inc_gst is not None else "—",
                item.current_stock,
                item.supplier_count,
                "Priced" if item.has_price else "Unpriced",
            ]
            ws.append(row_data)

            for col_idx in range(1, len(headers) + 1):
                c = ws.cell(row=row_idx, column=col_idx)
                c.fill = row_fill
                c.font = data_font
                c.border = border
                if col_idx in (1, 7, 9, 16, 17, 18):
                    c.alignment = Alignment(horizontal="center", vertical="center")
                elif col_idx in (10, 11, 12, 13, 14, 15):
                    c.alignment = Alignment(horizontal="right", vertical="center")
                    if isinstance(c.value, (int, float)):
                        c.number_format = "#,##0.00"
                else:
                    c.alignment = Alignment(horizontal="left", vertical="center")

        # Column autosizing
        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            col_letter = get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

        out = io.BytesIO()
        wb.save(out)
        out.seek(0)
        return out.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "price_list.xlsx"

    async def generate_template(self) -> tuple[bytes, str, str]:
        """Generate a blank or sample Excel template for bulk price updating."""
        wb = Workbook()
        ws = wb.active
        if ws is None:
            ws = wb.create_sheet(title="Price Import Template")
        else:
            ws.title = "Price Import Template"

        ws.views.sheetView[0].showGridLines = True

        headers = [
            "Product Code",
            "Product Name (Reference Only)",
            "Selling Price",
            "Minimum Floor Price",
            "Landing Cost (Standard Cost)",
            "Pricing Mode (Exclusive or Inclusive)",
        ]
        ws.append(headers)

        header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        border = Border(
            top=Side(border_style="thin", color="CBD5E1"),
            bottom=Side(border_style="thin", color="CBD5E1"),
            left=Side(border_style="thin", color="CBD5E1"),
            right=Side(border_style="thin", color="CBD5E1"),
        )

        ws.row_dimensions[1].height = 28
        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = border

        sample_rows = [
            ["SKU-SAMPLE-01", "Sample Ball Bearing 6204", 450.00, 420.00, 310.00, "Exclusive"],
            ["SKU-SAMPLE-02", "Sample Hex Bolt M10", 25.00, 22.00, 15.00, "Inclusive"],
        ]
        for r_idx, row in enumerate(sample_rows, start=2):
            ws.append(row)
            for c_idx in range(1, len(headers) + 1):
                c = ws.cell(row=r_idx, column=c_idx)
                c.font = Font(name="Calibri", size=10, color="64748B", italic=True)
                c.border = border
                if c_idx in (3, 4, 5):
                    c.alignment = Alignment(horizontal="right", vertical="center")
                    c.number_format = "#,##0.00"
                else:
                    c.alignment = Alignment(horizontal="left", vertical="center")

        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            col_letter = get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 5, 20)

        out = io.BytesIO()
        wb.save(out)
        out.seek(0)
        return out.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "price_import_template.xlsx"

    async def import_prices_from_excel(self, file_content: bytes) -> PriceImportSummary:
        """Parse uploaded Excel workbook, validate product codes, and update prices."""
        try:
            wb = load_workbook(io.BytesIO(file_content), data_only=True)
        except Exception as e:
            logger.error("Failed to parse Excel workbook for price import: %s", e)
            raise BadRequestException(f"Invalid Excel file: {e}")

        ws = wb.active
        if ws is None:
            raise BadRequestException("The uploaded Excel workbook contains no sheets.")

        rows = list(ws.iter_rows(values_only=True))
        if not rows or len(rows) < 2:
            return PriceImportSummary(total_rows=0, successful_updates=0, failed_rows=0, errors=[])

        # Header detection
        header_row = [str(cell).strip().lower() if cell is not None else "" for cell in rows[0]]
        code_idx = -1
        price_idx = -1
        min_price_idx = -1
        cost_idx = -1
        mode_idx = -1

        for idx, h in enumerate(header_row):
            if "code" in h:
                code_idx = idx
            elif "selling price" in h or (h == "price" and price_idx == -1):
                price_idx = idx
            elif "min" in h or "floor" in h:
                min_price_idx = idx
            elif "cost" in h:
                cost_idx = idx
            elif "mode" in h:
                mode_idx = idx

        if code_idx == -1:
            code_idx = 0
        if price_idx == -1:
            price_idx = 2

        summary = PriceImportSummary(total_rows=len(rows) - 1)

        for row_num, row_data in enumerate(rows[1:], start=2):
            if not row_data or all(c is None or str(c).strip() == "" for c in row_data):
                summary.total_rows -= 1
                continue

            raw_code = str(row_data[code_idx]).strip() if code_idx < len(row_data) and row_data[code_idx] is not None else ""
            if not raw_code:
                summary.failed_rows += 1
                summary.errors.append(PriceImportRowError(row_number=row_num, product_code=None, error="Product code is empty"))
                continue

            # Lookup product
            product = await self.repo.get_product_by_code(raw_code)
            if product is None:
                summary.failed_rows += 1
                summary.errors.append(
                    PriceImportRowError(row_number=row_num, product_code=raw_code, error=f"Product with code '{raw_code}' not found")
                )
                continue

            # Determine mode
            is_inclusive = False
            if mode_idx != -1 and mode_idx < len(row_data) and row_data[mode_idx] is not None:
                mode_str = str(row_data[mode_idx]).strip().lower()
                if "inc" in mode_str:
                    is_inclusive = True

            # Parse numeric fields
            std_price_val = None
            if price_idx != -1 and price_idx < len(row_data) and row_data[price_idx] is not None:
                try:
                    std_price_val = float(row_data[price_idx])
                    if std_price_val < 0:
                        raise ValueError("Price cannot be negative")
                except ValueError as e:
                    summary.failed_rows += 1
                    summary.errors.append(
                        PriceImportRowError(row_number=row_num, product_code=raw_code, error=f"Invalid selling price: {e}")
                    )
                    continue

            min_price_val = None
            if min_price_idx != -1 and min_price_idx < len(row_data) and row_data[min_price_idx] is not None:
                try:
                    min_price_val = float(row_data[min_price_idx])
                    if min_price_val < 0:
                        raise ValueError("Minimum price cannot be negative")
                except ValueError as e:
                    summary.failed_rows += 1
                    summary.errors.append(
                        PriceImportRowError(row_number=row_num, product_code=raw_code, error=f"Invalid minimum price: {e}")
                    )
                    continue

            cost_val = None
            if cost_idx != -1 and cost_idx < len(row_data) and row_data[cost_idx] is not None:
                try:
                    cost_val = float(row_data[cost_idx])
                    if cost_val < 0:
                        raise ValueError("Standard cost cannot be negative")
                except ValueError as e:
                    summary.failed_rows += 1
                    summary.errors.append(
                        PriceImportRowError(row_number=row_num, product_code=raw_code, error=f"Invalid standard cost: {e}")
                    )
                    continue

            try:
                await self.repo.update_product_price(
                    product.id,
                    standard_price=std_price_val,
                    minimum_price=min_price_val,
                    standard_cost=cost_val,
                    is_inclusive=is_inclusive,
                )
                summary.successful_updates += 1
            except Exception as e:
                summary.failed_rows += 1
                summary.errors.append(
                    PriceImportRowError(row_number=row_num, product_code=raw_code, error=f"Update failed: {e}")
                )

        await self.session.flush()
        return summary
