"""Warehouse Service. Business logic for Warehouse CRUD, cache invalidation, and import/export."""

from __future__ import annotations

import uuid
from typing import Any

from app.cache.manager import CacheManager
from app.common.list_query import ListQueryParams
from app.core.constants import RecordStatus
from app.core.exceptions import ConflictException, NotFoundException
from app.masters.warehouses.constants import DROPDOWN_CACHE_NAME, EXPORT_HEADERS
from app.masters.warehouses.models import Warehouse
from app.masters.warehouses.repository import WarehouseRepository
from app.masters.warehouses.validators import validate_warehouse_row
from app.masters.import_export import (
    ImportSummary,
    build_csv_export,
    build_excel_export,
    model_to_dict,
    parse_rows_from_file,
    run_import,
)


class WarehouseService:
    """Orchestrates warehouse management on top of :class:`WarehouseRepository`."""

    not_found_message = "Warehouse record not found."

    def __init__(self, repository: WarehouseRepository, cache_manager: CacheManager) -> None:
        """Bind this service to its repository and the cache manager."""
        self.repository = repository
        self.cache_manager = cache_manager

    async def get_by_id_or_raise(self, warehouse_id: uuid.UUID) -> Warehouse:
        """Fetch a warehouse record by ID or raise :class:`NotFoundException`."""
        item = await self.repository.get_by_id(warehouse_id)
        if item is None:
            raise NotFoundException(self.not_found_message)
        return item

    async def list_paginated(self, query: ListQueryParams) -> tuple[list[Warehouse], int]:
        """Return a page of warehouses matching search/sort/filter parameters."""
        return await self.repository.paginated_list(query)

    async def list_all_cached(self) -> list[Warehouse]:
        """Return every active warehouse record, using the shared dropdown cache."""
        cached = await self.cache_manager.get_dropdown(DROPDOWN_CACHE_NAME)
        if cached is not None:
            return cached
        items = await self.repository.list_all()
        await self.cache_manager.set_dropdown(DROPDOWN_CACHE_NAME, items)
        return items

    async def _invalidate_cache(self) -> None:
        """Invalidate the warehouses dropdown cache after mutation."""
        await self.cache_manager.invalidate_dropdown(DROPDOWN_CACHE_NAME)

    async def create(self, **field_values: Any) -> Warehouse:
        """Create a new warehouse entry, validating name uniqueness."""
        name = field_values.get("name")
        if name:
            existing = await self.repository.get_by_name(name)
            if existing is not None:
                raise ConflictException(
                    f"Warehouse name {name!r} is already in use.", details={"existing": model_to_dict(existing)}
                )

        item = await self.repository.create(**field_values)
        await self._invalidate_cache()
        return item

    async def update(self, warehouse_id: uuid.UUID, **field_values: Any) -> Warehouse:
        """Update an existing warehouse entry, validating name uniqueness."""
        item = await self.get_by_id_or_raise(warehouse_id)
        name = field_values.get("name")
        if name:
            existing = await self.repository.get_by_name(name)
            if existing is not None and existing.id != warehouse_id:
                raise ConflictException(
                    f"Warehouse name {name!r} is already in use.", details={"existing": model_to_dict(existing)}
                )

        changes = {k: v for k, v in field_values.items() if v is not None}
        if changes:
            await self.repository.update(item, **changes)
        await self._invalidate_cache()
        return item

    async def activate(self, warehouse_id: uuid.UUID) -> Warehouse:
        """Set warehouse status to ACTIVE."""
        return await self.update(warehouse_id, status=RecordStatus.ACTIVE)

    async def deactivate(self, warehouse_id: uuid.UUID) -> Warehouse:
        """Set warehouse status to INACTIVE."""
        return await self.update(warehouse_id, status=RecordStatus.INACTIVE)

    async def delete(self, warehouse_id: uuid.UUID) -> None:
        """Soft-delete a warehouse record."""
        item = await self.get_by_id_or_raise(warehouse_id)
        await self.repository.delete(item)
        await self._invalidate_cache()

    # ------------------------------------------------------------------
    # Import / Export
    # ------------------------------------------------------------------

    async def import_file(self, filename: str, raw_bytes: bytes) -> ImportSummary:
        """Validate and import warehouses from an uploaded CSV/XLSX file."""
        rows = parse_rows_from_file(filename, raw_bytes)

        async def _create(field_values: dict[str, Any]) -> Warehouse:
            name = field_values["name"]
            existing = await self.repository.get_by_name(name)
            if existing is not None:
                raise ConflictException(
                    f"Warehouse {name!r} already exists.", details={"existing": model_to_dict(existing)}
                )
            return await self.repository.create(**field_values)

        summary = await run_import(
            rows,
            row_validator=validate_warehouse_row,
            row_creator=_create,
            dedupe_keys=("name",),
        )
        await self._invalidate_cache()
        return summary

    async def export_file(self, file_format: str) -> bytes:
        """Export every warehouse record to CSV or XLSX bytes."""
        items = await self.repository.list_all()
        rows = [
            {
                "Name": i.name,
                "Address": i.address,
                "Billing Company": i.billing_company,
                "Over Selling": "Yes" if i.over_selling else "No",
                "Is Primary": "Yes" if i.is_primary else "No",
                "Main Warehouse": i.main_warehouse.name if i.main_warehouse else "",
                "Color": i.color,
                "Status": i.status.value,
                "Created At": i.created_at.strftime("%d-%m-%Y %I:%M %p") if i.created_at else "",
            }
            for i in items
        ]
        if file_format == "csv":
            return build_csv_export(EXPORT_HEADERS, rows)
        return build_excel_export(EXPORT_HEADERS, rows, sheet_title="Warehouses")
