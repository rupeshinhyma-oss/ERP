"""
Row validator for Technician CSV/Excel import.
"""

from __future__ import annotations

from typing import Any

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException


def validate_technician_row(row: dict[str, Any], row_num: int) -> dict[str, Any]:
    """Validate and normalize a single row of imported technician data."""
    raw_name = str(row.get("Name") or row.get("name") or "").strip()
    if not raw_name:
        raise BadRequestException(f"Row {row_num}: Name is required.")
    if len(raw_name) > 100:
        raise BadRequestException(f"Row {row_num}: Name cannot exceed 100 characters.")

    raw_mobile = str(row.get("Mobile") or row.get("mobile") or "").strip()
    if not raw_mobile:
        raise BadRequestException(f"Row {row_num}: Mobile is required.")
    if len(raw_mobile) > 20:
        raise BadRequestException(f"Row {row_num}: Mobile cannot exceed 20 characters.")

    raw_city = str(row.get("City") or row.get("city") or "").strip()
    if not raw_city:
        raise BadRequestException(f"Row {row_num}: City is required.")
    if len(raw_city) > 100:
        raise BadRequestException(f"Row {row_num}: City cannot exceed 100 characters.")

    raw_status = str(row.get("Status") or row.get("status") or "ACTIVE").strip().upper()
    status = RecordStatus.INACTIVE if raw_status == "INACTIVE" else RecordStatus.ACTIVE

    return {
        "name": raw_name,
        "mobile": raw_mobile,
        "city": raw_city,
        "status": status,
    }
