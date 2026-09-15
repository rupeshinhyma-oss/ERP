"""Transport Service. Business logic for Transport CRUD, cache invalidation, and import/export."""

from __future__ import annotations

import uuid
from typing import Any

from app.cache.manager import CacheManager
from app.common.list_query import ListQueryParams
from app.core.constants import RecordStatus
from app.core.exceptions import ConflictException, NotFoundException
from app.masters.transports.constants import DROPDOWN_CACHE_NAME, EXPORT_HEADERS
from app.masters.transports.models import Transport
from app.masters.transports.repository import TransportRepository
from app.masters.transports.validators import validate_transport_row
from app.masters.import_export import (
    ImportSummary,
    build_csv_export,
    build_excel_export,
    model_to_dict,
    parse_rows_from_file,
    run_import,
)


class TransportService:
    """Orchestrates transport carrier management on top of :class:`TransportRepository`."""

    not_found_message = "Transport record not found."

    def __init__(self, repository: TransportRepository, cache_manager: CacheManager) -> None:
        """Bind this service to its repository and the cache manager."""
        self.repository = repository
        self.cache_manager = cache_manager

    async def get_by_id_or_raise(self, transport_id: uuid.UUID) -> Transport:
        """Fetch a transport record by ID or raise :class:`NotFoundException`."""
        item = await self.repository.get_by_id(transport_id)
        if item is None:
            raise NotFoundException(self.not_found_message)
        return item

    async def list_paginated(self, query: ListQueryParams) -> tuple[list[Transport], int]:
        """Return a page of transports matching search/sort/filter parameters."""
        return await self.repository.paginated_list(query)

    async def list_all_cached(self) -> list[Transport]:
        """Return every active transport record, using the shared dropdown cache."""
        cached = await self.cache_manager.get_dropdown(DROPDOWN_CACHE_NAME)
        if cached is not None:
            return cached
        items = await self.repository.list_all()
        await self.cache_manager.set_dropdown(DROPDOWN_CACHE_NAME, items)
        return items

    async def _invalidate_cache(self) -> None:
        """Invalidate the transport dropdown cache after mutation."""
        await self.cache_manager.invalidate_dropdown(DROPDOWN_CACHE_NAME)

    async def create(self, **field_values: Any) -> Transport:
        """Create a new transport entry, validating name uniqueness."""
        name = field_values.get("name")
        if name:
            existing = await self.repository.get_by_name(name)
            if existing is not None:
                raise ConflictException(
                    f"Transport with name {name!r} is already in use.",
                    details={"existing": model_to_dict(existing)},
                )

        item = await self.repository.create(**field_values)
        await self._invalidate_cache()
        return item

    async def update(self, transport_id: uuid.UUID, **field_values: Any) -> Transport:
        """Update an existing transport entry, validating name uniqueness."""
        item = await self.get_by_id_or_raise(transport_id)
        name = field_values.get("name")
        if name:
            existing = await self.repository.get_by_name(name)
            if existing is not None and existing.id != transport_id:
                raise ConflictException(
                    f"Transport with name {name!r} is already in use.",
                    details={"existing": model_to_dict(existing)},
                )

        changes = {k: v for k, v in field_values.items() if v is not None}
        if changes:
            await self.repository.update(item, **changes)
        await self._invalidate_cache()
        return item

    async def activate(self, transport_id: uuid.UUID) -> Transport:
        """Set transport status to ACTIVE."""
        return await self.update(transport_id, status=RecordStatus.ACTIVE)

    async def deactivate(self, transport_id: uuid.UUID) -> Transport:
        """Set transport status to INACTIVE."""
        return await self.update(transport_id, status=RecordStatus.INACTIVE)

    async def delete(self, transport_id: uuid.UUID) -> None:
        """Soft-delete a transport record."""
        item = await self.get_by_id_or_raise(transport_id)
        await self.repository.delete(item)
        await self._invalidate_cache()

    # ------------------------------------------------------------------
    # Import / Export
    # ------------------------------------------------------------------

    async def import_file(self, filename: str, raw_bytes: bytes) -> ImportSummary:
        """Validate and import transport records from an uploaded CSV/XLSX file."""
        rows = parse_rows_from_file(filename, raw_bytes)

        async def _create(field_values: dict[str, Any]) -> Transport:
            name = field_values["name"]
            existing = await self.repository.get_by_name(name)
            if existing is not None:
                raise ConflictException(
                    f"Transport with name {name!r} already exists.",
                    details={"existing": model_to_dict(existing)},
                )
            return await self.repository.create(**field_values)

        summary = await run_import(
            rows,
            row_validator=validate_transport_row,
            row_creator=_create,
            dedupe_keys=("name",),
        )
        await self._invalidate_cache()
        return summary

    async def export_file(self, file_format: str) -> bytes:
        """Export every transport record to CSV or XLSX bytes."""
        items = await self.repository.list_all()
        rows = [
            {
                "Name": i.name,
                "GST Number": i.gst_number,
                "Mobile": i.mobile or "",
                "Status": i.status.value,
                "Created At": i.created_at.strftime("%d-%m-%Y %I:%M %p") if i.created_at else "",
            }
            for i in items
        ]
        if file_format == "csv":
            return build_csv_export(EXPORT_HEADERS, rows)
        return build_excel_export(EXPORT_HEADERS, rows, sheet_title="Transports")
