"""Warehouse row validation logic for bulk import."""

from __future__ import annotations

from typing import Any

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException


def validate_warehouse_row(row: dict[str, Any], row_number: int = 1) -> dict[str, Any]:
    """Validate and clean a single raw row from CSV/Excel import."""
    cleaned: dict[str, Any] = {}

    name = str(row.get("name") or row.get("Warehouse Name") or row.get("warehouse") or "").strip()
    if not name:
        raise BadRequestException(f"Row {row_number}: 'name' (Warehouse Name) is required.")
    cleaned["name"] = name

    code = str(row.get("code") or row.get("Code") or row.get("warehouse_code") or "").strip()
    if not code:
        clean_name = "".join(c.upper() for c in name if c.isalnum())[:15]
        code = f"WH-{clean_name}" if clean_name else "WH-GEN"
    cleaned["code"] = code

    location = str(row.get("location") or row.get("Location") or "").strip()
    if location:
        cleaned["location"] = location

    desc = str(row.get("description") or row.get("Description") or "").strip()
    if desc:
        cleaned["description"] = desc

    raw_status = str(row.get("status") or row.get("Status") or "").strip().lower()
    if raw_status in ("inactive", "0", "disabled"):
        cleaned["status"] = RecordStatus.INACTIVE
    else:
        cleaned["status"] = RecordStatus.ACTIVE

    return cleaned

