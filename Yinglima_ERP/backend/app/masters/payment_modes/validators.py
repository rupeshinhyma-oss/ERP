"""PaymentMode Validators."""

from __future__ import annotations

from typing import Any

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException


def validate_payment_mode_row(raw_row: dict[str, str], row_number: int) -> dict[str, Any]:
    """Validate one raw import row."""
    name = (
        raw_row.get("name")
        or raw_row.get("Payment Mode / Bank Account")
        or raw_row.get("Payment Mode")
        or raw_row.get("payment_mode")
        or ""
    ).strip()
    code = (raw_row.get("code") or raw_row.get("Code") or raw_row.get("payment_mode_code") or "").strip()

    if not name:
        raise BadRequestException(f"Row {row_number}: 'name' (Payment Mode / Bank Account) is required.")

    status_raw = (raw_row.get("status") or raw_row.get("Status") or "active").strip().lower()
    try:
        status = RecordStatus(status_raw)
    except ValueError as exc:
        raise BadRequestException(
            f"Row {row_number}: invalid status {status_raw!r}. Must be 'active' or 'inactive'."
        ) from exc

    account_type = (raw_row.get("account_type") or raw_row.get("Account Type") or "").strip() or None
    currency_code = (raw_row.get("currency_code") or raw_row.get("Currency") or "").strip().upper() or None
    description = (raw_row.get("description") or raw_row.get("Description") or "").strip() or None

    return {
        "name": name,
        "code": code or f"PM-{name.upper().replace(' ', '_')[:10]}",
        "account_type": account_type,
        "currency_code": currency_code,
        "description": description,
        "status": status,
    }
