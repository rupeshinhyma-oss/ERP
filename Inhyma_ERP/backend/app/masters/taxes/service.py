"""Tax Service. Business logic for Tax CRUD, cache invalidation, and import/export."""

from __future__ import annotations

import uuid
from typing import Any

from app.cache.manager import CacheManager
from app.common.list_query import ListQueryParams
from app.core.constants import RecordStatus
from app.core.exceptions import ConflictException, NotFoundException
from app.masters.import_export import (
    ImportSummary,
    build_csv_export,
    build_excel_export,
    model_to_dict,
    parse_rows_from_file,
    run_import,
)
from app.masters.taxes.constants import DROPDOWN_CACHE_NAME, EXPORT_HEADERS
from app.masters.taxes.models import Tax
from app.masters.taxes.repository import TaxRepository
from app.masters.taxes.validators import validate_tax_row


class TaxService:
    """Orchestrates tax / HSN management on top of :class:`TaxRepository`."""

    not_found_message = "Tax record not found."

    def __init__(self, repository: TaxRepository, cache_manager: CacheManager) -> None:
        """Bind this service to its repository and the cache manager."""
        self.repository = repository
        self.cache_manager = cache_manager

    async def get_by_id_or_raise(self, tax_id: uuid.UUID) -> Tax:
        """Fetch a tax record by ID or raise :class:`NotFoundException`."""
        tax = await self.repository.get_by_id(tax_id)
        if tax is None:
            raise NotFoundException(self.not_found_message)
        return tax

    async def list_paginated(self, query: ListQueryParams) -> tuple[list[Tax], int]:
        """Return a page of taxes matching search/sort/filter parameters."""
        return await self.repository.paginated_list(query)

    async def list_all_cached(self) -> list[Tax]:
        """Return every active tax record, using the shared dropdown cache."""
        cached = await self.cache_manager.get_dropdown(DROPDOWN_CACHE_NAME)
        if cached is not None:
            return cached
        taxes = await self.repository.list_all()
        await self.cache_manager.set_dropdown(DROPDOWN_CACHE_NAME, taxes)
        return taxes

    async def _invalidate_cache(self) -> None:
        """Invalidate the tax dropdown cache after mutation."""
        await self.cache_manager.invalidate_dropdown(DROPDOWN_CACHE_NAME)

    async def create(self, **field_values: Any) -> Tax:
        """Create a new tax entry, validating HSN number uniqueness."""
        hsn = field_values.get("hsn_number")
        if hsn:
            existing = await self.repository.get_by_hsn(hsn)
            if existing is not None:
                raise ConflictException(
                    f"HSN Number {hsn!r} is already in use.", details={"existing": model_to_dict(existing)}
                )

        tax = await self.repository.create(**field_values)
        await self._invalidate_cache()
        return tax

    async def update(self, tax_id: uuid.UUID, **field_values: Any) -> Tax:
        """Update an existing tax entry, validating HSN number uniqueness."""
        tax = await self.get_by_id_or_raise(tax_id)
        hsn = field_values.get("hsn_number")
        if hsn:
            existing = await self.repository.get_by_hsn(hsn)
            if existing is not None and existing.id != tax_id:
                raise ConflictException(
                    f"HSN Number {hsn!r} is already in use.", details={"existing": model_to_dict(existing)}
                )

        changes = {k: v for k, v in field_values.items() if v is not None}
        if changes:
            await self.repository.update(tax, **changes)
        await self._invalidate_cache()
        return tax

    async def activate(self, tax_id: uuid.UUID) -> Tax:
        """Set tax status to ACTIVE."""
        return await self.update(tax_id, status=RecordStatus.ACTIVE)

    async def deactivate(self, tax_id: uuid.UUID) -> Tax:
        """Set tax status to INACTIVE."""
        return await self.update(tax_id, status=RecordStatus.INACTIVE)

    async def delete(self, tax_id: uuid.UUID) -> None:
        """Soft-delete a tax record."""
        tax = await self.get_by_id_or_raise(tax_id)
        await self.repository.delete(tax)
        await self._invalidate_cache()

    # ------------------------------------------------------------------
    # Import / Export
    # ------------------------------------------------------------------

    async def import_file(self, filename: str, raw_bytes: bytes) -> ImportSummary:
        """Validate and import taxes from an uploaded CSV/XLSX file."""
        rows = parse_rows_from_file(filename, raw_bytes)

        async def _create(field_values: dict[str, Any]) -> Tax:
            hsn = field_values["hsn_number"]
            existing = await self.repository.get_by_hsn(hsn)
            if existing is not None:
                raise ConflictException(
                    f"HSN Number {hsn!r} already exists.", details={"existing": model_to_dict(existing)}
                )
            return await self.repository.create(**field_values)

        summary = await run_import(rows, row_validator=validate_tax_row, row_creator=_create, dedupe_keys=("hsn_number",))
        await self._invalidate_cache()
        return summary

    async def export_file(self, file_format: str) -> bytes:
        """Export every tax record to CSV or XLSX bytes."""
        taxes = await self.repository.list_all()
        rows = [
            {
                "id": str(t.id),
                "hsn_number": t.hsn_number,
                "gst_percent": float(t.gst_percent),
                "import_duty_percent": float(t.import_duty_percent),
                "status": t.status.value,
                "created_at": t.created_at.isoformat(),
                "updated_at": t.updated_at.isoformat(),
            }
            for t in taxes
        ]
        if file_format == "csv":
            return build_csv_export(EXPORT_HEADERS, rows)
        return build_excel_export(EXPORT_HEADERS, rows, sheet_title="Taxes")
