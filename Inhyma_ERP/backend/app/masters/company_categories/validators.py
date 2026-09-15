"""Company Categories Row Validators for bulk import."""

from __future__ import annotations

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException


def validate_company_category_row(row: dict, row_num: int) -> dict:
    """Validate and normalize a raw CSV/Excel row for Company Categories import."""
    raw_name = str(row.get("Name") or row.get("name") or "").strip()
    raw_btype = str(row.get("Business Type") or row.get("business_type") or row.get("BusinessType") or "B2B").strip()
    raw_desc = str(row.get("Description") or row.get("description") or "").strip()
    raw_status = str(row.get("Status") or row.get("status") or "active").strip().upper()

    if not raw_name:
        raise BadRequestException(f"Row {row_num}: Name is required.")

    if len(raw_name) > 100:
        raise BadRequestException(f"Row {row_num}: Name cannot exceed 100 characters.")

    if not raw_btype:
        raw_btype = "B2B"

    if len(raw_btype) > 50:
        raise BadRequestException(f"Row {row_num}: Business Type cannot exceed 50 characters.")

    status = RecordStatus.ACTIVE if raw_status in ("ACTIVE", "1", "TRUE") else RecordStatus.INACTIVE

    return {
        "name": raw_name,
        "business_type": raw_btype,
        "description": raw_desc or None,
        "status": status,
    }
