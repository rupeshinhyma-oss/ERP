"""
Row validator for Warehouse CSV/Excel import.
"""

from __future__ import annotations

from typing import Any

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException


def validate_warehouse_row(row: dict[str, Any], row_num: int) -> dict[str, Any]:
    """Validate and normalize a single row of imported warehouse data."""
    raw_name = str(row.get("Name") or row.get("name") or "").strip()
    if not raw_name:
        raise BadRequestException(f"Row {row_num}: Name is required.")
    if len(raw_name) > 100:
        raise BadRequestException(f"Row {row_num}: Name cannot exceed 100 characters.")

    raw_address = str(row.get("Address") or row.get("address") or "").strip()
    if not raw_address:
        raise BadRequestException(f"Row {row_num}: Address is required.")

    raw_billing_company = str(row.get("Billing Company") or row.get("billing_company") or "").strip()
    if not raw_billing_company:
        raw_billing_company = "INHYMA SOLUTIONS LLP"

    raw_over_selling = row.get("Over Selling") or row.get("over_selling") or "No"
    over_selling = str(raw_over_selling).strip().lower() in ("yes", "true", "1", "y")

    raw_is_primary = row.get("Is Primary") or row.get("is_primary") or "No"
    is_primary = str(raw_is_primary).strip().lower() in ("yes", "true", "1", "y")

    raw_color = str(row.get("Color") or row.get("color") or "#2563EB").strip()

    raw_status = str(row.get("Status") or row.get("status") or "ACTIVE").strip().upper()
    status = RecordStatus.INACTIVE if raw_status == "INACTIVE" else RecordStatus.ACTIVE

    return {
        "name": raw_name,
        "address": raw_address,
        "billing_company": raw_billing_company,
        "over_selling": over_selling,
        "is_primary": is_primary,
        "color": raw_color,
        "status": status,
    }
