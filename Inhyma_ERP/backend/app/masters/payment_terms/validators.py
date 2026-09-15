"""Payment Term Row Validators for CSV/Excel bulk imports."""

from __future__ import annotations

from typing import Any

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException


def validate_payment_term_row(row: dict[str, Any], row_number: int) -> dict[str, Any]:
    """
    Validate and normalize one raw dictionary row parsed from an import file.

    Expected headers:
        Name, Status
    """
    name_raw = str(row.get("name") or row.get("Name") or "").strip()
    if not name_raw:
        raise BadRequestException(f"Row {row_number}: Name is required.")

    status_raw = str(row.get("status") or row.get("Status") or "active").strip().upper()
    try:
        record_status = RecordStatus(status_raw)
    except ValueError:
        record_status = RecordStatus.ACTIVE

    return {
        "name": name_raw,
        "status": record_status,
    }
