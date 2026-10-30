"""
Company Validators.

Phone-number digit-count validation (the document's "7 to 11 digit
allowed" rule) and row-level validation for CSV/Excel import.
"""

from __future__ import annotations

import re
from typing import Any

from app.core.exceptions import BadRequestException
from app.companies.constants import PHONE_MAX_DIGITS, PHONE_MIN_DIGITS
from app.companies.models import CompanyCurrentStatus, CompanyGrade, CompanyPotential, CompanyType

_DIGITS_ONLY = re.compile(r"\D+")
_SCI_NOTATION_RE = re.compile(r"^\s*[+-]?\d+(?:\.\d+)?[eE][+-]?\d+\s*$")


def is_scientific_notation_phone(value: str | None) -> bool:
    """Return True if Excel converted a phone number into scientific notation (e.g. '9.19877E+11')."""
    if not value or not value.strip():
        return False
    return bool(_SCI_NOTATION_RE.match(value.strip()))


def validate_phone_number(value: str | None, *, field_label: str) -> str | None:
    """
    Validate a phone/WhatsApp/WeChat number against the digit-count rule.

    Accepts an optional leading "+" and country code; only the digit count
    (ignoring separators like spaces, dashes, or parentheses) is checked.
    Returns the value unchanged (not reformatted) so the country-code prefix
    the user entered is preserved.
    """
    if value is None or not value.strip():
        return None
    if is_scientific_notation_phone(value):
        raise BadRequestException(
            f"{field_label} '{value.strip()}' was converted to scientific notation by Excel. "
            "Please format phone columns as Text or use the exported format."
        )
    digit_count = len(_DIGITS_ONLY.sub("", value))
    if digit_count < PHONE_MIN_DIGITS or digit_count > PHONE_MAX_DIGITS:
        raise BadRequestException(
            f"{field_label} must have between {PHONE_MIN_DIGITS} and {PHONE_MAX_DIGITS} digits "
            f"(including country code); got {digit_count}."
        )
    return value.strip()


def validate_email_format(value: str) -> str:
    """Minimal, dependency-free email shape check."""
    value = value.strip()
    if "@" not in value or value.startswith("@") or value.endswith("@"):
        raise BadRequestException(f"{value!r} is not a valid email address.")
    return value


def _get_field(row: dict[str, Any], *aliases: str, default: str = "") -> str:
    """Retrieve a value by trying exact keys, lowercase keys, and normalized keys."""
    for a in aliases:
        if a in row and row[a] is not None:
            v = str(row[a]).strip()
            if v:
                return v
        norm_a = a.lower().replace(" ", "_").replace("-", "_").replace("/", "_").replace("?", "")
        for k, v in row.items():
            if v is not None and str(k).strip().lower().replace(" ", "_").replace("-", "_").replace("/", "_").replace("?", "") == norm_a:
                if str(v).strip():
                    return str(v).strip()
    return default


def validate_company_row(
    raw_row: dict[str, Any], row_number: int, *, allow_partial: bool = False
) -> dict[str, Any]:
    """
    Validate one raw import row and return clean field kwargs, or raise on bad data.

    Supports both human-readable UI table column names and backend model keys.
    When ``allow_partial=True`` (used by Update / Modify Existing Records mode),
    geography columns (Country, State / Province, City) are optional for rows
    that match an existing company by Company Name or Tax ID / GST Number.
    """
    company_name = _get_field(raw_row, "Company Name", "company_name")
    tax_id_raw = _get_field(
        raw_row,
        "Tax ID / GST Number",
        "Tax ID Number",
        "GST No Of Company",
        "GST Number",
        "GSTIN",
        "tax_id_number",
        "GST",
    )
    tax_id = tax_id_raw.strip().upper() if tax_id_raw else ""

    country_code = _get_field(raw_row, "Country", "country_code", "country_name", "Country Code")
    state_name = _get_field(raw_row, "State / Province", "State", "Province", "state_name", "province")
    city_name = _get_field(raw_row, "City", "city_name")

    if not allow_partial:
        if not company_name:
            raise BadRequestException("'Company Name' is required.")
        if not country_code:
            raise BadRequestException("'Country' is required.")
        if not state_name:
            raise BadRequestException("'State / Province' is required.")
        if not city_name:
            raise BadRequestException("'City' is required.")
    else:
        if not company_name and not tax_id:
            raise BadRequestException(
                "Either 'Company Name' or 'Tax ID / GST Number' is required to match or import a company."
            )

    company_type_raw = _get_field(raw_row, "Company Type", "Business Type", "company_type")
    if company_type_raw and company_type_raw.strip().lower() in ("select", "-- select --", "-- select type --"):
        company_type_raw = ""
    if company_type_raw and company_type_raw.strip().upper() in ("B2B", "B2C"):
        company_type = company_type_raw.strip().upper()
    else:
        company_type = company_type_raw or None

    grade_raw_orig = _get_field(raw_row, "Company Grade", "Grade", "company_grade")
    grade_raw = grade_raw_orig.upper()
    if grade_raw.startswith("GRADE "):
        grade_raw = grade_raw.replace("GRADE ", "").strip()
    grade = None
    if grade_raw and grade_raw.lower() not in ("select", "-- select --", "-- select grade --"):
        try:
            grade = CompanyGrade(grade_raw)
        except ValueError:
            raise BadRequestException(
                f"Invalid Company Grade '{grade_raw_orig}'. Allowed values are Grade A, Grade B, or Grade C (or A, B, C)."
            )

    status_raw_orig_cs = _get_field(raw_row, "Current Status", "current_status")
    status_raw = status_raw_orig_cs.lower()
    current_status = None
    if status_raw and status_raw not in ("select", "-- select --", "-- select status --"):
        try:
            current_status = CompanyCurrentStatus(status_raw)
        except ValueError:
            raise BadRequestException(
                f"Invalid Current Status '{status_raw_orig_cs}'. Allowed values are New or Existing."
            )

    potential_raw_orig = _get_field(raw_row, "Potential", "potential")
    potential_raw = potential_raw_orig.lower()
    potential = None
    if potential_raw and potential_raw not in ("select", "-- select --", "-- select potential --"):
        try:
            potential = CompanyPotential(potential_raw)
        except ValueError:
            raise BadRequestException(
                f"Invalid Potential '{potential_raw_orig}'. Allowed values are Yes or No."
            )

    visited_raw_orig = _get_field(raw_row, "Visited Factory/Office", "Visited Factory/Office?", "visited_factory_office")
    visited_raw = visited_raw_orig.lower()
    visited_factory_office = visited_raw in ("true", "yes", "1", "y")

    status_raw_orig = _get_field(raw_row, "Status", "is_active")
    status_str = (status_raw_orig or "active").lower()
    is_active = status_str in ("active", "true", "yes", "1", "y")

    calling_number_raw = _get_field(
        raw_row, "Calling Number", "Contact Calling Number", "Contact Number (Direct)", "contact_calling_number", "Phone"
    )
    whatsapp_number_raw = _get_field(
        raw_row, "WhatsApp Number", "Contact WhatsApp Number", "contact_whatsapp_number", "WhatsApp"
    )
    wechat_number_raw = _get_field(
        raw_row, "WeChat Number", "Contact WeChat Number", "contact_wechat_number", "WeChat"
    )
    indiamart_number_raw = _get_field(
        raw_row, "IndiaMART Number", "Contact IndiaMART Number", "contact_indiamart_number"
    )

    if allow_partial and is_scientific_notation_phone(calling_number_raw):
        calling_number = None
    else:
        calling_number = validate_phone_number(
            calling_number_raw, field_label="Calling Number"
        ) if calling_number_raw else None

    if allow_partial and is_scientific_notation_phone(whatsapp_number_raw):
        whatsapp_number = None
    else:
        whatsapp_number = validate_phone_number(
            whatsapp_number_raw, field_label="WhatsApp Number"
        ) if whatsapp_number_raw else None

    if allow_partial and is_scientific_notation_phone(wechat_number_raw):
        wechat_number = None
    else:
        wechat_number = validate_phone_number(
            wechat_number_raw, field_label="WeChat Number"
        ) if wechat_number_raw else None

    email_raw = _get_field(raw_row, "Emails", "Email", "email", "emails")
    emails_list: list[str] = []
    if email_raw:
        for em_part in email_raw.split(","):
            em_clean = em_part.strip()
            if em_clean:
                emails_list.append(validate_email_format(em_clean))
    email = emails_list[0] if emails_list else None

    brand_desc = _get_field(raw_row, "Brand Description", "Brand", "brand_description")
    salutation = _get_field(raw_row, "Contact Salutation", "Salutation", "contact_salutation")
    contact_name = _get_field(raw_row, "Contact Person", "Contact Person Name", "contact_full_name", "contact_person")
    designation = _get_field(raw_row, "Designation", "contact_designation")
    address = _get_field(raw_row, "Address", "address")
    area = _get_field(raw_row, "Area", "area")
    district = _get_field(raw_row, "District", "district")
    town = _get_field(raw_row, "Town", "town")
    pincode = _get_field(raw_row, "Pincode", "Pin Code", "Zip Code", "pincode")
    primary_website = _get_field(raw_row, "Primary Website", "Website", "primary_website")
    secondary_website = _get_field(raw_row, "Secondary Website", "secondary_website")
    company_category = _get_field(raw_row, "Company Category", "company_category")
    business_category = _get_field(raw_row, "Business Category", "business_category")
    sector = _get_field(raw_row, "Sector", "Company Sector", "sector")
    monthly_turnover = _get_field(raw_row, "Monthly Turnover", "monthly_turnover")
    potential_reason = _get_field(raw_row, "Potential Reason", "potential_reason")
    potential_business_per_month = _get_field(
        raw_row, "Potential Business / Month", "Potential Business per month", "potential_business_per_month"
    )
    direct_import_from_china = _get_field(raw_row, "Direct Import From China", "direct_import_from_china")
    monthly_import_volume = _get_field(raw_row, "Monthly Import Volume", "monthly_import_volume")
    products_needed_for_imports = _get_field(raw_row, "Products Needed For Imports", "products_needed_for_imports")
    product_manufacture_or_supply = _get_field(
        raw_row, "Products Manufactured / Supplied", "product_manufacture_or_supply"
    )
    machines_buying_from = _get_field(raw_row, "Machines Buying From", "machines_buying_from")
    spares_buying_from = _get_field(raw_row, "Spares Buying From", "spares_buying_from")
    products_interested = _get_field(raw_row, "Products Interested", "products_interested")
    gst_registration_date = _get_field(raw_row, "GST Registration Date", "gst_registration_date")
    secondary_products = _get_field(raw_row, "Secondary Products", "secondary_products_description")
    visit_remarks = _get_field(raw_row, "Visit Remarks", "visit_remarks")
    overall_remarks = _get_field(raw_row, "Overall Remarks", "overall_remarks")

    category_names_raw = _get_field(raw_row, "Product Categories", "Category", "Categories", "category_names")
    sub_category_names_raw = _get_field(raw_row, "Key Strength Sub-Categories", "Sub-Category", "Sub Categories", "sub_category_names")
    product_names_raw = _get_field(raw_row, "Products Supplied", "Products", "product_names")

    return {
        "company_name": company_name,
        "company_type": company_type,
        "brand_description": brand_desc or None,
        "country_code": country_code,
        "state_name": state_name,
        "city_name": city_name,
        "area": area or None,
        "district": district or None,
        "pincode": pincode or None,
        "contact_salutation": salutation or None,
        "contact_full_name": contact_name or None,
        "contact_designation": designation or None,
        "contact_calling_number": calling_number,
        "contact_whatsapp_number": whatsapp_number,
        "contact_wechat_number": wechat_number,
        "contact_indiamart_number": indiamart_number_raw or None,
        "email": email,
        "emails": emails_list if emails_list else None,
        "tax_id_number": tax_id or None,
        "address": address or None,
        "town": town or None,
        "primary_website": primary_website or None,
        "secondary_website": secondary_website or None,
        "company_category": company_category or None,
        "business_category": business_category or None,
        "sector": sector or None,
        "monthly_turnover": monthly_turnover or None,
        "product_manufacture_or_supply": product_manufacture_or_supply or None,
        "machines_buying_from": machines_buying_from or None,
        "spares_buying_from": spares_buying_from or None,
        "products_interested": products_interested or None,
        "gst_registration_date": gst_registration_date or None,
        "company_grade": grade,
        "current_status": current_status,
        "potential": potential,
        "potential_reason": potential_reason or None,
        "potential_business_per_month": potential_business_per_month or None,
        "direct_import_from_china": direct_import_from_china or None,
        "monthly_import_volume": monthly_import_volume or None,
        "products_needed_for_imports": products_needed_for_imports or None,
        "secondary_products_description": secondary_products or None,
        "visited_factory_office": visited_factory_office,
        "_visited_provided": bool(visited_raw_orig),
        "visit_remarks": visit_remarks or None,
        "overall_remarks": overall_remarks or None,
        "is_active": is_active,
        "_status_provided": bool(status_raw_orig),
        "category_names_raw": category_names_raw or None,
        "sub_category_names_raw": sub_category_names_raw or None,
        "product_names_raw": product_names_raw or None,
    }
