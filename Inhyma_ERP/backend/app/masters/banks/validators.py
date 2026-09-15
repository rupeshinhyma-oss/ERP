"""Bank Validators. Row-level validation for CSV/Excel import."""

from __future__ import annotations

from typing import Any

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException


def validate_bank_row(row: dict[str, Any], row_num: int) -> dict[str, Any]:
    """Validate and clean a single bank row from CSV/Excel import."""
    raw_bank_name = str(row.get("Bank Name") or row.get("bank_name") or "").strip()
    if not raw_bank_name:
        raise BadRequestException(f"Row {row_num}: Bank Name is required.")
    if len(raw_bank_name) > 150:
        raise BadRequestException(f"Row {row_num}: Bank Name must not exceed 150 characters.")

    raw_account_number = str(row.get("Account Number") or row.get("account_number") or "").strip()
    if not raw_account_number:
        raise BadRequestException(f"Row {row_num}: Account Number is required.")
    if len(raw_account_number) > 50:
        raise BadRequestException(f"Row {row_num}: Account Number must not exceed 50 characters.")

    raw_holder_name = str(
        row.get("Account Holder Name")
        or row.get("Holder Name")
        or row.get("account_holder_name")
        or ""
    ).strip()
    if not raw_holder_name:
        raise BadRequestException(f"Row {row_num}: Account Holder Name is required.")
    if len(raw_holder_name) > 200:
        raise BadRequestException(f"Row {row_num}: Account Holder Name must not exceed 200 characters.")

    raw_ifsc = str(row.get("IFSC Code") or row.get("ifsc_code") or "").strip().upper()
    if not raw_ifsc:
        raise BadRequestException(f"Row {row_num}: IFSC Code is required.")
    if len(raw_ifsc) > 20:
        raise BadRequestException(f"Row {row_num}: IFSC Code must not exceed 20 characters.")

    raw_branch = str(row.get("Branch") or row.get("branch") or "").strip()
    if not raw_branch:
        raise BadRequestException(f"Row {row_num}: Branch is required.")
    if len(raw_branch) > 150:
        raise BadRequestException(f"Row {row_num}: Branch must not exceed 150 characters.")

    raw_status = str(row.get("Status") or row.get("status") or "ACTIVE").strip().upper()
    status = RecordStatus.INACTIVE if raw_status == "INACTIVE" else RecordStatus.ACTIVE

    return {
        "bank_name": raw_bank_name,
        "account_number": raw_account_number,
        "account_holder_name": raw_holder_name,
        "ifsc_code": raw_ifsc,
        "branch": raw_branch,
        "status": status,
    }
