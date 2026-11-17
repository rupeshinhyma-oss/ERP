"""Constants for Cargo Overview document gallery slots, shipment checklist items, and storage."""

from __future__ import annotations

CARGO_STORAGE_BUCKET = "cargo-overview"
CARGO_LOCAL_SUBFOLDER = "cargo_overview"

# 22 document slots matching Consignment Gallery layout (4-column grid)
CARGO_DOC_SLOTS: list[tuple[str, str]] = [
    ("proforma_invoice", "Proforma Invoices File"),
    ("sales_contract", "Sales Contract File"),
    ("swift_tt_advance", "Swift T.T 1 - Advance"),
    ("goodlist_marketing", "Goodlist For Marketing"),
    ("draft_bl", "Draft Approved Bill of Lading"),
    ("commercial_invoice", "Commercial Invoice"),
    ("packing_list", "Packing List"),
    ("insurance", "Insurance"),
    ("shipping_bill", "Shipping Bill"),
    ("certificate_of_origin", "Certificate of Origin (COO)"),
    ("final_bl", "Final Bill of Lading"),
    ("inspection_coc", "PVOC / Inspection Certificate (COC)"),
    ("swift_tt_balance", "Swift T.T 2 - Balance"),
    ("coa_primary", "COAs Primary / Lab"),
    ("coa_others", "COAs Others"),
    ("msds", "MSDS"),
    ("tax_assessment", "Bill of Entry / Tax Assessment"),
    ("customs_entry", "Customs Entry"),
    ("costing_sheet", "Import Costing Sheet"),
    ("final_landing_cost_sheet", "Final Landing Cost Sheet"),
    ("transport_invoice", "Transport Invoice"),
    ("clearing_invoice", "Clearing Invoice"),
]

# 12 shipment checklist items (3-column Yes/No toggle grid)
CARGO_CHECKLIST_ITEMS: list[tuple[str, str]] = [
    ("draft_bl_received", "Draft Approved BL Received"),
    ("insurance_mail_sent", "Insurance Mail Sent"),
    ("insurance_certificate_received", "Insurance Certificate Received"),
    ("listed_with_forwarder", "Listed with Forwarder"),
    ("shipping_bill_shared_to_agent", "Shipping Bill Shared to Clearing Agent"),
    ("final_bl_received", "Final BL Received"),
    ("final_coc_received", "Final COC Received"),
    ("coo_received", "COO Received"),
    ("telex_done", "Telex Done"),
    ("rest_all_docs_checked", "Rest All Docs Received and Checked"),
    ("all_docs_shared_to_agent", "All Docs Shared to Clearing Agent"),
    ("customs_boe_cleared", "Customs / BOE Cleared"),
]
