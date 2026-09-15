"""Social Media Row Validators for bulk import."""

from __future__ import annotations

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException


def validate_social_media_row(row: dict, row_num: int) -> dict:
    """Validate and normalize a raw CSV/Excel row for Social Media import."""
    raw_name = str(row.get("Name") or row.get("name") or "").strip()
    raw_status = str(row.get("Status") or row.get("status") or "active").strip().upper()

    if not raw_name:
        raise BadRequestException(f"Row {row_num}: Name is required.")

    if len(raw_name) > 100:
        raise BadRequestException(f"Row {row_num}: Name cannot exceed 100 characters.")

    status = RecordStatus.ACTIVE if raw_status in ("ACTIVE", "1", "TRUE") else RecordStatus.INACTIVE

    return {
        "name": raw_name,
        "status": status,
    }
