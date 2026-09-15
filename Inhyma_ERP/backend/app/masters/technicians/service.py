"""Technician Service. Business logic for Technician CRUD, cache invalidation, and import/export."""

from __future__ import annotations

import uuid
from typing import Any

from app.auth.security import hash_password
from app.cache.manager import CacheManager
from app.common.list_query import ListQueryParams
from app.core.constants import RecordStatus
from app.core.exceptions import ConflictException, NotFoundException
from app.masters.technicians.constants import DROPDOWN_CACHE_NAME, EXPORT_HEADERS
from app.masters.technicians.models import Technician
from app.masters.technicians.repository import TechnicianRepository
from app.masters.technicians.validators import validate_technician_row
from app.masters.import_export import (
    ImportSummary,
    build_csv_export,
    build_excel_export,
    model_to_dict,
    parse_rows_from_file,
    run_import,
)


class TechnicianService:
    """Orchestrates technician management on top of :class:`TechnicianRepository`."""

    not_found_message = "Technician record not found."

    def __init__(self, repository: TechnicianRepository, cache_manager: CacheManager) -> None:
        """Bind this service to its repository and the cache manager."""
        self.repository = repository
        self.cache_manager = cache_manager

    async def get_by_id_or_raise(self, technician_id: uuid.UUID) -> Technician:
        """Fetch a technician record by ID or raise :class:`NotFoundException`."""
        item = await self.repository.get_by_id(technician_id)
        if item is None:
            raise NotFoundException(self.not_found_message)
        return item

    async def list_paginated(self, query: ListQueryParams) -> tuple[list[Technician], int]:
        """Return a page of technicians matching search/sort/filter parameters."""
        return await self.repository.paginated_list(query)

    async def list_all_cached(self) -> list[Technician]:
        """Return every active technician record, using the shared dropdown cache."""
        cached = await self.cache_manager.get_dropdown(DROPDOWN_CACHE_NAME)
        if cached is not None:
            return cached
        items = await self.repository.list_all()
        await self.cache_manager.set_dropdown(DROPDOWN_CACHE_NAME, items)
        return items

    async def _invalidate_cache(self) -> None:
        """Invalidate the technician dropdown cache after mutation."""
        await self.cache_manager.invalidate_dropdown(DROPDOWN_CACHE_NAME)

    async def create(self, **field_values: Any) -> Technician:
        """Create a new technician entry, validating mobile uniqueness."""
        mobile = field_values.get("mobile")
        if mobile:
            existing = await self.repository.get_by_mobile(mobile)
            if existing is not None:
                raise ConflictException(
                    f"Technician mobile {mobile!r} is already in use.", details={"existing": model_to_dict(existing)}
                )

        raw_password = field_values.pop("password", None)
        if raw_password:
            field_values["password_hash"] = hash_password(raw_password)

        item = await self.repository.create(**field_values)
        await self._invalidate_cache()
        return item

    async def update(self, technician_id: uuid.UUID, **field_values: Any) -> Technician:
        """Update an existing technician entry, validating mobile uniqueness."""
        item = await self.get_by_id_or_raise(technician_id)
        mobile = field_values.get("mobile")
        if mobile:
            existing = await self.repository.get_by_mobile(mobile)
            if existing is not None and existing.id != technician_id:
                raise ConflictException(
                    f"Technician mobile {mobile!r} is already in use.", details={"existing": model_to_dict(existing)}
                )

        raw_password = field_values.pop("password", None)
        if raw_password:
            field_values["password_hash"] = hash_password(raw_password)

        changes = {k: v for k, v in field_values.items() if v is not None}
        if changes:
            await self.repository.update(item, **changes)
        await self._invalidate_cache()
        return item

    async def activate(self, technician_id: uuid.UUID) -> Technician:
        """Set technician status to ACTIVE."""
        return await self.update(technician_id, status=RecordStatus.ACTIVE)

    async def deactivate(self, technician_id: uuid.UUID) -> Technician:
        """Set technician status to INACTIVE."""
        return await self.update(technician_id, status=RecordStatus.INACTIVE)

    async def delete(self, technician_id: uuid.UUID) -> None:
        """Soft-delete a technician record."""
        item = await self.get_by_id_or_raise(technician_id)
        await self.repository.delete(item)
        await self._invalidate_cache()

    # ------------------------------------------------------------------
    # Import / Export
    # ------------------------------------------------------------------

    async def import_file(self, filename: str, raw_bytes: bytes) -> ImportSummary:
        """Validate and import technicians from an uploaded CSV/XLSX file."""
        rows = parse_rows_from_file(filename, raw_bytes)

        async def _create(field_values: dict[str, Any]) -> Technician:
            mobile = field_values["mobile"]
            existing = await self.repository.get_by_mobile(mobile)
            if existing is not None:
                raise ConflictException(
                    f"Technician with mobile {mobile!r} already exists.", details={"existing": model_to_dict(existing)}
                )
            return await self.repository.create(**field_values)

        summary = await run_import(
            rows,
            row_validator=validate_technician_row,
            row_creator=_create,
            dedupe_keys=("mobile",),
        )
        await self._invalidate_cache()
        return summary

    async def export_file(self, file_format: str) -> bytes:
        """Export every technician record to CSV or XLSX bytes."""
        items = await self.repository.list_all()
        rows = [
            {
                "Name": i.name,
                "Mobile": i.mobile,
                "City": i.city,
                "Status": i.status.value,
                "Created At": i.created_at.strftime("%d-%m-%Y %I:%M %p") if i.created_at else "",
            }
            for i in items
        ]
        if file_format == "csv":
            return build_csv_export(EXPORT_HEADERS, rows)
        return build_excel_export(EXPORT_HEADERS, rows, sheet_title="Technicians")
