"""Country Constants."""

from __future__ import annotations

MODULE_NAME = "countries"
DROPDOWN_CACHE_NAME = "countries"  # key used with CacheManager.get_dropdown/set_dropdown/invalidate_dropdown

IMPORT_HEADERS = ["name", "code", "phone_code", "nationality", "currency", "status"]
EXPORT_HEADERS = ["Sr. No.", "Country Name", "Code", "Phone Code", "Currency", "Nationality", "Status"]
