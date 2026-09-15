"""
Row validator for Billing Company CSV/Excel import.
"""

from __future__ import annotations

from typing import Any

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException


def validate_billing_company_row(row: dict[str, Any], row_num: int) -> dict[str, Any]:
    """Validate and normalize a single row of imported billing company data."""
    raw_name = str(row.get("Billing Company Name") or row.get("name") or "").strip()
    if not raw_name:
        raise BadRequestException(f"Row {row_num}: Billing Company Name is required.")
    if len(raw_name) > 150:
        raise BadRequestException(f"Row {row_num}: Billing Company Name cannot exceed 150 characters.")

    raw_email = str(row.get("Email") or row.get("email") or "").strip() or None
    raw_mobile = str(row.get("Mobile") or row.get("mobile") or "").strip() or None
    raw_address = str(row.get("Address") or row.get("address") or "").strip() or None

    raw_city = str(row.get("City") or row.get("city") or "").strip()
    if not raw_city:
        raise BadRequestException(f"Row {row_num}: City is required.")

    raw_zip = str(row.get("Zip Code") or row.get("zip_code") or "").strip() or None
    raw_gst = str(row.get("GST No") or row.get("gst_no") or "").strip() or None
    raw_pan = str(row.get("Pancard") or row.get("pan_no") or "").strip() or None

    raw_so_prefix = str(row.get("Sale Order Prefix") or row.get("so_prefix") or "").strip()
    if not raw_so_prefix:
        raise BadRequestException(f"Row {row_num}: Sale Order Prefix is required.")

    raw_pi_prefix = str(row.get("Proforma Invoice Prefix") or row.get("pi_prefix") or "").strip()
    if not raw_pi_prefix:
        raise BadRequestException(f"Row {row_num}: Proforma Invoice Prefix is required.")

    raw_bank_name = str(row.get("Select Bank") or row.get("Bank Name") or row.get("bank_name") or "").strip()
    if not raw_bank_name:
        raise BadRequestException(f"Row {row_num}: Select Bank is required.")

    raw_terms = str(row.get("Sale Order Term And Condition") or row.get("terms_and_conditions") or "").strip() or None

    raw_status = str(row.get("Status") or row.get("status") or "ACTIVE").strip().upper()
    status = RecordStatus.INACTIVE if raw_status == "INACTIVE" else RecordStatus.ACTIVE

    return {
        "name": raw_name,
        "email": raw_email,
        "mobile": raw_mobile,
        "address": raw_address,
        "city": raw_city,
        "zip_code": raw_zip,
        "gst_no": raw_gst,
        "pan_no": raw_pan,
        "so_prefix": raw_so_prefix,
        "pi_prefix": raw_pi_prefix,
        "bank_name": raw_bank_name,
        "terms_and_conditions": raw_terms,
        "status": status,
    }
