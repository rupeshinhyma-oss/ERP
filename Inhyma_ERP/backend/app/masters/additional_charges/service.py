"""Additional Charges Service. Business logic for Additional Charges CRUD, cache invalidation, and import/export."""

from __future__ import annotations

import uuid
from typing import Any

from app.cache.manager import CacheManager
from app.common.list_query import ListQueryParams
from app.core.constants import RecordStatus
from app.core.exceptions import ConflictException, NotFoundException
from app.masters.additional_charges.constants import DROPDOWN_CACHE_NAME, EXPORT_HEADERS
from app.masters.additional_charges.models import AdditionalCharge
from app.masters.additional_charges.repository import AdditionalChargeRepository
from app.masters.additional_charges.validators import validate_additional_charge_row
from app.masters.import_export import (
    ImportSummary,
    build_csv_export,
    build_excel_export,
    model_to_dict,
    parse_rows_from_file,
    run_import,
)


class AdditionalChargeService:
    """Orchestrates additional charges management on top of :class:`AdditionalChargeRepository`."""

    not_found_message = "Additional charge record not found."

    def __init__(self, repository: AdditionalChargeRepository, cache_manager: CacheManager) -> None:
        """Bind this service to its repository and the cache manager."""
        self.repository = repository
        self.cache_manager = cache_manager

    async def get_by_id_or_raise(self, charge_id: uuid.UUID) -> AdditionalCharge:
        """Fetch an additional charge record by ID or raise :class:`NotFoundException`."""
        charge = await self.repository.get_by_id(charge_id)
        if charge is None:
            raise NotFoundException(self.not_found_message)
        return charge

    async def list_paginated(self, query: ListQueryParams) -> tuple[list[AdditionalCharge], int]:
        """Return a page of additional charges matching search/sort/filter parameters."""
        return await self.repository.paginated_list(query)

    async def list_all_cached(self) -> list[AdditionalCharge]:
        """Return every active additional charge record, using the shared dropdown cache."""
        cached = await self.cache_manager.get_dropdown(DROPDOWN_CACHE_NAME)
        if cached is not None:
            return cached
        charges = await self.repository.list_all()
        await self.cache_manager.set_dropdown(DROPDOWN_CACHE_NAME, charges)
        return charges

    async def _invalidate_cache(self) -> None:
        """Invalidate the additional charges dropdown cache after mutation."""
        await self.cache_manager.invalidate_dropdown(DROPDOWN_CACHE_NAME)

    async def create(self, **field_values: Any) -> AdditionalCharge:
        """Create a new additional charge entry, validating name uniqueness."""
        name = field_values.get("name")
        if name:
            existing = await self.repository.get_by_name(name)
            if existing is not None:
                raise ConflictException(
                    f"Additional charge name {name!r} is already in use.", details={"existing": model_to_dict(existing)}
                )

        charge = await self.repository.create(**field_values)
        await self._invalidate_cache()
        return charge

    async def update(self, charge_id: uuid.UUID, **field_values: Any) -> AdditionalCharge:
        """Update an existing additional charge entry, validating name uniqueness."""
        charge = await self.get_by_id_or_raise(charge_id)
        name = field_values.get("name")
        if name:
            existing = await self.repository.get_by_name(name)
            if existing is not None and existing.id != charge_id:
                raise ConflictException(
                    f"Additional charge name {name!r} is already in use.", details={"existing": model_to_dict(existing)}
                )

        changes = {k: v for k, v in field_values.items() if v is not None}
        if changes:
            await self.repository.update(charge, **changes)
        await self._invalidate_cache()
        return charge

    async def activate(self, charge_id: uuid.UUID) -> AdditionalCharge:
        """Set charge status to ACTIVE."""
        return await self.update(charge_id, status=RecordStatus.ACTIVE)

    async def deactivate(self, charge_id: uuid.UUID) -> AdditionalCharge:
        """Set charge status to INACTIVE."""
        return await self.update(charge_id, status=RecordStatus.INACTIVE)

    async def delete(self, charge_id: uuid.UUID) -> None:
        """Soft-delete an additional charge record."""
        charge = await self.get_by_id_or_raise(charge_id)
        await self.repository.delete(charge)
        await self._invalidate_cache()

    # ------------------------------------------------------------------
    # Import / Export
    # ------------------------------------------------------------------

    async def import_file(self, filename: str, raw_bytes: bytes) -> ImportSummary:
        """Validate and import additional charges from an uploaded CSV/XLSX file."""
        rows = parse_rows_from_file(filename, raw_bytes)

        async def _create(field_values: dict[str, Any]) -> AdditionalCharge:
            name = field_values["name"]
            existing = await self.repository.get_by_name(name)
            if existing is not None:
                raise ConflictException(
                    f"Additional charge {name!r} already exists.", details={"existing": model_to_dict(existing)}
                )
            return await self.repository.create(**field_values)

        summary = await run_import(
            rows,
            row_validator=validate_additional_charge_row,
            row_creator=_create,
            dedupe_keys=("name",),
        )
        await self._invalidate_cache()
        return summary

    async def export_file(self, file_format: str) -> bytes:
        """Export every additional charge record to CSV or XLSX bytes."""
        charges = await self.repository.list_all()
        rows = [
            {
                "id": str(c.id),
                "name": c.name,
                "hsn_number": c.hsn_number or "",
                "gst_percent": float(c.gst_percent),
                "description": c.description or "",
                "status": c.status.value,
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat(),
            }
            for c in charges
        ]
        if file_format == "csv":
            return build_csv_export(EXPORT_HEADERS, rows)
        return build_excel_export(EXPORT_HEADERS, rows, sheet_title="Additional Charges")
