"""Supplier Constants."""

from __future__ import annotations

MODULE_NAME = "suppliers"

# Document: "Calling Number (with Country Code & number of Digits based on
# country selected) - Also, maximum 11 digit restriction to give. (7 to 11
# digit allowed)". Applied to calling/WhatsApp/WeChat numbers alike ("same
# as above" for each, per the document). Deliberately separate from the
# generic app.core.constants.Regex.PHONE (7-15 digits, used elsewhere in
# the app) since this module's rule is specifically 7-11 digits.
PHONE_MIN_DIGITS = 7
PHONE_MAX_DIGITS = 15

DEFAULT_SALUTATIONS = ("Mr.", "Mrs.", "Ms.")

IMPORT_HEADERS = [
    "company_name",
    "supplier_type",
    "brand_description",
    "country_code",
    "state_name",
    "city_name",
    "contact_salutation",
    "contact_full_name",
    "contact_designation",
    "contact_calling_number",
    "contact_whatsapp_number",
    "contact_wechat_number",
    "contact_full_name_2",
    "contact_designation_2",
    "contact_calling_number_2",
    "contact_whatsapp_number_2",
    "contact_wechat_number_2",
    "email",
    "tax_id_number",
    "address",
    "primary_website",
    "secondary_website",
    "supplier_grade",
    "current_status",
    "potential",
    "potential_reason",
    "secondary_products_description",
    "visited_factory_office",
    "visit_remarks",
    "overall_remarks",
    "is_active",
]

EXPORT_HEADERS = [
    "Company Name",
    "Product Categories",
    "Key Strength Sub-Categories",
    "Products Supplied",
    "Secondary Products",
    "Country",
    "State / Province",
    "City",
    "Address",
    "Brand Description",
    "Supplier Type",
    "Current Status",
    "Supplier Grade",
    "Potential",
    "Potential Reason",
    "Contact Person",
    "Designation",
    "Calling Number",
    "WhatsApp Number",
    "WeChat Number",
    "Contact Person 2",
    "Designation 2",
    "Calling Number 2",
    "WhatsApp Number 2",
    "WeChat Number 2",
    "Emails",
    "Tax ID / GST Number",
    "Primary Website",
    "Secondary Website",
    "Visited Factory/Office",
    "Visit Remarks",
    "Overall Remarks",
    "Status",
]
