"""Product Validators. Row-level validation for CSV/Excel import."""

from __future__ import annotations

from typing import Any

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException


def _get_val(raw_row: dict[str, str], *keys: str) -> str:
    """Get the first non-empty value from a list of possible key aliases."""
    for k in keys:
        val = raw_row.get(k)
        if val is not None and str(val).strip():
            return str(val).strip()
    return ""


def _parse_optional_float_aliases(raw_row: dict[str, str], *keys: str, row_number: int) -> float | None:
    """Parse an optional numeric field using multiple key aliases."""
    raw_value = _get_val(raw_row, *keys)
    if not raw_value:
        return None
    # Strip commas or percent signs
    clean_val = raw_value.replace(",", "").replace("%", "").strip()
    try:
        return float(clean_val)
    except ValueError as exc:
        raise BadRequestException(f"Row {row_number}: {keys[0]!r} must be numeric, got {raw_value!r}.") from exc


def validate_product_row(raw_row: dict[str, str], row_number: int, *, allow_partial: bool = False) -> dict[str, Any]:
    """
    Validate one raw import row and return clean field kwargs, or raise on bad data.
    Supports both human-readable Excel headers and raw API keys.
    When ``allow_partial=True`` (Update / Modify Existing Records mode), only
    Product Name (or Product Code) is strictly required by the row validator;
    omitted/blank cells are returned as ``None`` so existing DB values are preserved.
    """
    product_name = _get_val(
        raw_row,
        "Product Name (As Per Tally)",
        "product_name",
        "product_name_tally",
        "Product Name",
        "Product Name (As per Tally)",
    )
    product_name_invoice = _get_val(
        raw_row,
        "Product Name (As Per Invoice)",
        "product_name_invoice",
        "Invoice Name",
    )
    product_code = _get_val(raw_row, "Product Code", "product_code", "Code")
    if product_code in ("-", "—", "N/A", "n/a", "none", "None"):
        product_code = ""

    category_code = _get_val(raw_row, "Category", "category_code", "Category Code", "category_name", "Category / Sub-Cat.")
    sub_category_code = _get_val(raw_row, "Sub Category", "Sub-Category", "Sub Cate.", "sub_category_code", "Sub-Category Code")
    brand_code = _get_val(raw_row, "Brand", "brand_code", "Brand Code", "brand_name")
    hsn_code = _get_val(raw_row, "HSN Code", "HSN", "hsn_code", "hsn_number")
    uom_code = _get_val(raw_row, "UOM", "uom_code", "Unit of Measure", "uom_name")

    if not product_name and (not allow_partial or not product_code):
        raise BadRequestException(f"Row {row_number}: Product Name (As Per Tally) is required.")
    if not allow_partial:
        if not category_code:
            raise BadRequestException(f"Row {row_number}: Category is required.")
        if not sub_category_code:
            raise BadRequestException(f"Row {row_number}: Sub Category is required.")
        if not uom_code:
            raise BadRequestException(f"Row {row_number}: UOM (Unit of Measure) is required.")

    # Auto-generate product code if omitted (marked with AUTO- so update mode never overwrites an existing code)
    if not product_code:
        import random
        product_code = f"AUTO-{random.randint(10000, 99999)}"

    status_raw = _get_val(raw_row, "Status", "status")
    if not status_raw:
        status = None if allow_partial else RecordStatus.ACTIVE
    else:
        status_lower = status_raw.lower()
        if status_lower in ("active", "true", "1", "yes", "a"):
            status = RecordStatus.ACTIVE
        elif status_lower in ("inactive", "false", "0", "no", "i"):
            status = RecordStatus.INACTIVE
        else:
            raise BadRequestException(
                f"Row {row_number}: Invalid Status {status_raw!r}. Allowed values: Active, Inactive."
            )

    pack_qty = _parse_optional_float_aliases(raw_row, "Pack. Qty", "Packaging Quantity", "packaging_quantity", "pack_qty", row_number=row_number)
    net_wt = _parse_optional_float_aliases(raw_row, "Pack. Net Weight", "Packaging Net Weight (kg)", "packaging_net_weight", "Pack.Net.Weight", row_number=row_number)
    gross_wt = _parse_optional_float_aliases(raw_row, "Pack. Gross Weight", "Packaging Gross Weight (kg)", "packaging_gross_weight", "Pack. Gross Weight", "weight", row_number=row_number)
    length = _parse_optional_float_aliases(raw_row, "Length (cm)", "Length (CM)", "length_cm", "length", row_number=row_number)
    width = _parse_optional_float_aliases(raw_row, "Width (cm)", "Width (CM)", "width_cm", "width", row_number=row_number)
    height = _parse_optional_float_aliases(raw_row, "Height (cm)", "Height (CM)", "height_cm", "height", row_number=row_number)
    cbm = _parse_optional_float_aliases(raw_row, "Pack. Unit CBM", "Packaging Unit CBM", "packaging_unit_cbm", "cbm", row_number=row_number)
    refund_vat = _parse_optional_float_aliases(raw_row, "Refund VAT %", "refund_vat_percent", "Refund VAT", row_number=row_number)
    standard_price = _parse_optional_float_aliases(
        raw_row,
        "Standard Price",
        "Min. Price Without GST",
        "standard_price",
        "minimum_price",
        row_number=row_number,
    )

    if refund_vat is not None and (refund_vat < 0 or refund_vat > 100):
        raise BadRequestException(f"Row {row_number}: Refund VAT % must be between 0 and 100, got {refund_vat}.")

    if standard_price is not None and standard_price < 0:
        raise BadRequestException(f"Row {row_number}: Standard Price cannot be negative.")

    if not allow_partial:
        if pack_qty is None or pack_qty <= 0:
            raise BadRequestException(f"Row {row_number}: Packaging Quantity (Pack. Qty) is required and must be greater than 0.")
        if gross_wt is None or gross_wt <= 0:
            raise BadRequestException(f"Row {row_number}: Packaging Gross Weight (kg) is required and must be greater than 0.")
        if cbm is None or cbm <= 0:
            if length and width and height and length > 0 and width > 0 and height > 0:
                cbm = round((length * width * height) / 1000000.0, 6)
            else:
                raise BadRequestException(
                    f"Row {row_number}: Packaging Unit CBM is required (provide Length, Width, Height in cm to calculate automatically or provide Packaging Unit CBM directly)."
                )
    else:
        if pack_qty is not None and pack_qty <= 0:
            raise BadRequestException(f"Row {row_number}: Packaging Quantity (Pack. Qty) must be greater than 0.")
        if gross_wt is not None and gross_wt <= 0:
            raise BadRequestException(f"Row {row_number}: Packaging Gross Weight (kg) must be greater than 0.")
        if (cbm is None or cbm <= 0) and length and width and height and length > 0 and width > 0 and height > 0:
            cbm = round((length * width * height) / 1000000.0, 6)
        elif cbm is not None and cbm <= 0:
            raise BadRequestException(f"Row {row_number}: Packaging Unit CBM must be greater than 0.")

    spec = _get_val(raw_row, "Specification", "specification", "Product Specification")
    desc = _get_val(raw_row, "Description", "description")
    license_req = _get_val(raw_row, "Compliance & License Requirements", "license_certificate_required")

    result: dict[str, Any] = {
        "product_code": product_code,
        "product_name": product_name or None,
        "product_name_tally": product_name or None,
        "product_name_invoice": product_name_invoice or None,
        "category_code": category_code or None,
        "sub_category_code": sub_category_code or None,
        "brand_code": brand_code or None,
        "hsn_code": hsn_code or None,
        "uom_code": uom_code or None,
        "specification": spec or None,
        "description": desc or None,
        "license_certificate_required": license_req or None,
        "packaging_quantity": pack_qty,
        "packaging_net_weight": net_wt,
        "packaging_gross_weight": gross_wt,
        "weight": gross_wt,
        "length_cm": length,
        "width_cm": width,
        "height_cm": height,
        "packaging_unit_cbm": cbm,
        "refund_vat_percent": refund_vat,
        "standard_price": standard_price,
    }
    if not allow_partial:
        result["is_purchasable"] = True
        result["is_sellable"] = True
    if status is not None:
        result["status"] = status
    return result
