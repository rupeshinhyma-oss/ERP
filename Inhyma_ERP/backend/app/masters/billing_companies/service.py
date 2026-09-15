"""Billing Company Service. Business logic for Billing Company CRUD, cache invalidation, and import/export."""

from __future__ import annotations

import uuid
from typing import Any

from app.cache.manager import CacheManager
from app.common.list_query import ListQueryParams
from app.core.constants import RecordStatus
from app.core.exceptions import ConflictException, NotFoundException
from app.masters.billing_companies.constants import DROPDOWN_CACHE_NAME, EXPORT_HEADERS
from app.masters.billing_companies.models import BillingCompany
from app.masters.billing_companies.repository import BillingCompanyRepository
from app.masters.billing_companies.validators import validate_billing_company_row
from app.masters.import_export import (
    ImportSummary,
    build_csv_export,
    build_excel_export,
    model_to_dict,
    parse_rows_from_file,
    run_import,
)


class BillingCompanyService:
    """Orchestrates billing company management on top of :class:`BillingCompanyRepository`."""

    not_found_message = "Billing company record not found."

    def __init__(self, repository: BillingCompanyRepository, cache_manager: CacheManager) -> None:
        """Bind this service to its repository and the cache manager."""
        self.repository = repository
        self.cache_manager = cache_manager

    async def get_by_id_or_raise(self, company_id: uuid.UUID) -> BillingCompany:
        """Fetch a billing company record by ID or raise :class:`NotFoundException`."""
        item = await self.repository.get_by_id(company_id)
        if item is None:
            raise NotFoundException(self.not_found_message)
        return item

    async def list_paginated(self, query: ListQueryParams) -> tuple[list[BillingCompany], int]:
        """Return a page of billing companies matching search/sort/filter parameters."""
        return await self.repository.paginated_list(query)

    async def list_all_cached(self) -> list[BillingCompany]:
        """Return every active billing company record, using the shared dropdown cache."""
        cached = await self.cache_manager.get_dropdown(DROPDOWN_CACHE_NAME)
        if cached is not None:
            return cached
        items = await self.repository.list_all()
        await self.cache_manager.set_dropdown(DROPDOWN_CACHE_NAME, items)
        return items

    async def _invalidate_cache(self) -> None:
        """Invalidate the billing company dropdown cache after mutation."""
        await self.cache_manager.invalidate_dropdown(DROPDOWN_CACHE_NAME)

    async def create(self, **field_values: Any) -> BillingCompany:
        """Create a new billing company entry, validating name uniqueness."""
        name = field_values.get("name")
        if name:
            existing = await self.repository.get_by_name(name)
            if existing is not None:
                raise ConflictException(
                    f"Billing company name {name!r} is already in use.", details={"existing": model_to_dict(existing)}
                )

        item = await self.repository.create(**field_values)
        await self._invalidate_cache()
        return item

    async def update(self, company_id: uuid.UUID, **field_values: Any) -> BillingCompany:
        """Update an existing billing company entry, validating name uniqueness."""
        item = await self.get_by_id_or_raise(company_id)
        name = field_values.get("name")
        if name:
            existing = await self.repository.get_by_name(name)
            if existing is not None and existing.id != company_id:
                raise ConflictException(
                    f"Billing company name {name!r} is already in use.", details={"existing": model_to_dict(existing)}
                )

        changes = {k: v for k, v in field_values.items() if v is not None}
        if changes:
            await self.repository.update(item, **changes)
        await self._invalidate_cache()
        return item

    async def activate(self, company_id: uuid.UUID) -> BillingCompany:
        """Set billing company status to ACTIVE."""
        return await self.update(company_id, status=RecordStatus.ACTIVE)

    async def deactivate(self, company_id: uuid.UUID) -> BillingCompany:
        """Set billing company status to INACTIVE."""
        return await self.update(company_id, status=RecordStatus.INACTIVE)

    async def delete(self, company_id: uuid.UUID) -> None:
        """Soft-delete a billing company record."""
        item = await self.get_by_id_or_raise(company_id)
        await self.repository.delete(item)
        await self._invalidate_cache()

    # ------------------------------------------------------------------
    # Import / Export
    # ------------------------------------------------------------------

    async def import_file(self, filename: str, raw_bytes: bytes) -> ImportSummary:
        """Validate and import billing companies from an uploaded CSV/XLSX file."""
        rows = parse_rows_from_file(filename, raw_bytes)

        async def _create(field_values: dict[str, Any]) -> BillingCompany:
            name = field_values["name"]
            existing = await self.repository.get_by_name(name)
            if existing is not None:
                raise ConflictException(
                    f"Billing company {name!r} already exists.", details={"existing": model_to_dict(existing)}
                )
            return await self.repository.create(**field_values)

        summary = await run_import(
            rows,
            row_validator=validate_billing_company_row,
            row_creator=_create,
            dedupe_keys=("name",),
        )
        await self._invalidate_cache()
        return summary

    async def export_file(self, file_format: str) -> bytes:
        """Export every billing company record to CSV or XLSX bytes."""
        items = await self.repository.list_all()
        rows = [
            {
                "Billing Company Name": i.name,
                "Email": i.email or "",
                "Mobile": i.mobile or "",
                "Address": i.address or "",
                "City": i.city,
                "Zip Code": i.zip_code or "",
                "GST No": i.gst_no or "",
                "Pancard": i.pan_no or "",
                "Sale Order Prefix": i.so_prefix,
                "Proforma Invoice Prefix": i.pi_prefix,
                "Select Bank": i.bank_name,
                "Sale Order Term And Condition": i.terms_and_conditions or "",
                "Status": i.status.value,
                "Register On": i.created_at.strftime("%d-%m-%Y %I:%M %p") if i.created_at else "",
            }
            for i in items
        ]
        if file_format == "csv":
            return build_csv_export(EXPORT_HEADERS, rows)
        return build_excel_export(EXPORT_HEADERS, rows, sheet_title="Billing Companies")
