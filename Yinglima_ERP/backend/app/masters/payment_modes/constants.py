"""Payment Mode / Bank Account Constants."""

from __future__ import annotations

MODULE_NAME = "payment_modes"
DROPDOWN_CACHE_NAME = "payment_modes"

IMPORT_HEADERS = ["name", "code", "account_type", "currency_code", "description", "status"]
EXPORT_HEADERS = ["Sr. No.", "Payment Mode / Bank Account", "Code", "Account Type", "Currency", "Description", "Status"]

DEFAULT_PAYMENT_MODES = [
    ("RMB A/C", "PM-RMB-AC", "Bank Account", "RMB", "Default RMB bank account"),
    ("USD Transaction A/C", "PM-USD-TX", "Bank Account", "USD", "USD transaction bank account"),
    ("USD Capital A/C", "PM-USD-CAP", "Bank Account", "USD", "USD capital bank account"),
    ("TT / Wire Transfer", "PM-TT-WIRE", "Wire Transfer", None, "Telegraphic transfer / wire transfer"),
    ("Alipay / WeChat Pay", "PM-ALIPAY", "Digital Wallet", "RMB", "Alipay or WeChat Pay wallet"),
    ("Cash", "PM-CASH", "Cash", None, "Cash payment"),
    ("Other Bank A/C", "PM-OTHER", "Bank Account", None, "Other bank account"),
]
