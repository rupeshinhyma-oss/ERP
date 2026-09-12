"""Tax Validators. Row-level validation for CSV/Excel import."""

from __future__ import annotations

from typing import Any

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException


def _get_val(row: dict[str, Any], *keys: str) -> str:
    for k in keys:
        if k in row and row[k] is not None:
            v = str(row[k]).strip()
            if v:
                return v
    return ""


def validate_tax_row(raw_row: dict[str, Any], row_number: int) -> dict[str, Any]:
    """Validate one raw import row and return clean field kwargs, or raise on bad data."""
    hsn_number = _get_val(raw_row, "hsn_number", "HSN Number", "hsn", "HSN", "hsn_code")
    if not hsn_number:
        raise BadRequestException(f"Row {row_number}: HSN Number is required.")

    gst_raw = _get_val(raw_row, "gst_percent", "GST (%)", "GST Percentage", "gst", "gst_percentage") or "0"
    try:
        gst_percent = float(gst_raw.replace("%", "").strip())
        if gst_percent < 0 or gst_percent > 100:
            raise ValueError()
    except ValueError:
        raise BadRequestException(f"Row {row_number}: GST Percentage must be a number between 0 and 100.")

    duty_raw = _get_val(raw_row, "import_duty_percent", "Import Duty (%)", "Import Duty", "import_duty", "duty") or "0"
    try:
        import_duty_percent = float(duty_raw.replace("%", "").strip())
        if import_duty_percent < 0 or import_duty_percent > 100:
            raise ValueError()
    except ValueError:
        raise BadRequestException(f"Row {row_number}: Import Duty (%) must be a number between 0 and 100.")

    status_raw = (_get_val(raw_row, "status", "Status") or "active").lower()
    if status_raw in ("active", "true", "1", "yes", "a"):
        status = RecordStatus.ACTIVE
    elif status_raw in ("inactive", "false", "0", "no", "i"):
        status = RecordStatus.INACTIVE
    else:
        status = RecordStatus.ACTIVE

    return {
        "hsn_number": hsn_number,
        "gst_percent": gst_percent,
        "import_duty_percent": import_duty_percent,
        "status": status,
    }
