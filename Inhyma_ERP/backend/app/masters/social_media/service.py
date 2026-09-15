"""Social Media Service. Business logic for Social Media CRUD, cache invalidation, and import/export."""

from __future__ import annotations

import uuid
from typing import Any

from app.cache.manager import CacheManager
from app.common.list_query import ListQueryParams
from app.core.constants import RecordStatus
from app.core.exceptions import ConflictException, NotFoundException
from app.masters.social_media.constants import DROPDOWN_CACHE_NAME, EXPORT_HEADERS
from app.masters.social_media.models import SocialMedia
from app.masters.social_media.repository import SocialMediaRepository
from app.masters.social_media.validators import validate_social_media_row
from app.masters.import_export import (
    ImportSummary,
    build_csv_export,
    build_excel_export,
    model_to_dict,
    parse_rows_from_file,
    run_import,
)


class SocialMediaService:
    """Orchestrates social media platform management on top of :class:`SocialMediaRepository`."""

    not_found_message = "Social media record not found."

    def __init__(self, repository: SocialMediaRepository, cache_manager: CacheManager) -> None:
        """Bind this service to its repository and the cache manager."""
        self.repository = repository
        self.cache_manager = cache_manager

    async def get_by_id_or_raise(self, social_media_id: uuid.UUID) -> SocialMedia:
        """Fetch a social media record by ID or raise :class:`NotFoundException`."""
        item = await self.repository.get_by_id(social_media_id)
        if item is None:
            raise NotFoundException(self.not_found_message)
        return item

    async def list_paginated(self, query: ListQueryParams) -> tuple[list[SocialMedia], int]:
        """Return a page of social media platforms matching search/sort/filter parameters."""
        return await self.repository.paginated_list(query)

    async def list_all_cached(self) -> list[SocialMedia]:
        """Return every active social media record, using the shared dropdown cache."""
        cached = await self.cache_manager.get_dropdown(DROPDOWN_CACHE_NAME)
        if cached is not None:
            return cached
        items = await self.repository.list_all()
        await self.cache_manager.set_dropdown(DROPDOWN_CACHE_NAME, items)
        return items

    async def _invalidate_cache(self) -> None:
        """Invalidate the social media dropdown cache after mutation."""
        await self.cache_manager.invalidate_dropdown(DROPDOWN_CACHE_NAME)

    async def create(self, **field_values: Any) -> SocialMedia:
        """Create a new social media entry, validating name uniqueness."""
        name = field_values.get("name")
        if name:
            existing = await self.repository.get_by_name(name)
            if existing is not None:
                raise ConflictException(
                    f"Social media name {name!r} is already in use.", details={"existing": model_to_dict(existing)}
                )

        item = await self.repository.create(**field_values)
        await self._invalidate_cache()
        return item

    async def update(self, social_media_id: uuid.UUID, **field_values: Any) -> SocialMedia:
        """Update an existing social media entry, validating name uniqueness."""
        item = await self.get_by_id_or_raise(social_media_id)
        name = field_values.get("name")
        if name:
            existing = await self.repository.get_by_name(name)
            if existing is not None and existing.id != social_media_id:
                raise ConflictException(
                    f"Social media name {name!r} is already in use.", details={"existing": model_to_dict(existing)}
                )

        changes = {k: v for k, v in field_values.items() if v is not None}
        if changes:
            await self.repository.update(item, **changes)
        await self._invalidate_cache()
        return item

    async def activate(self, social_media_id: uuid.UUID) -> SocialMedia:
        """Set social media status to ACTIVE."""
        return await self.update(social_media_id, status=RecordStatus.ACTIVE)

    async def deactivate(self, social_media_id: uuid.UUID) -> SocialMedia:
        """Set social media status to INACTIVE."""
        return await self.update(social_media_id, status=RecordStatus.INACTIVE)

    async def delete(self, social_media_id: uuid.UUID) -> None:
        """Soft-delete a social media record."""
        item = await self.get_by_id_or_raise(social_media_id)
        await self.repository.delete(item)
        await self._invalidate_cache()

    # ------------------------------------------------------------------
    # Import / Export
    # ------------------------------------------------------------------

    async def import_file(self, filename: str, raw_bytes: bytes) -> ImportSummary:
        """Validate and import social media platforms from an uploaded CSV/XLSX file."""
        rows = parse_rows_from_file(filename, raw_bytes)

        async def _create(field_values: dict[str, Any]) -> SocialMedia:
            name = field_values["name"]
            existing = await self.repository.get_by_name(name)
            if existing is not None:
                raise ConflictException(
                    f"Social media platform {name!r} already exists.", details={"existing": model_to_dict(existing)}
                )
            return await self.repository.create(**field_values)

        summary = await run_import(
            rows,
            row_validator=validate_social_media_row,
            row_creator=_create,
            dedupe_keys=("name",),
        )
        await self._invalidate_cache()
        return summary

    async def export_file(self, file_format: str) -> bytes:
        """Export every social media record to CSV or XLSX bytes."""
        items = await self.repository.list_all()
        rows = [
            {
                "id": str(i.id),
                "name": i.name,
                "status": i.status.value,
                "created_at": i.created_at.isoformat(),
                "updated_at": i.updated_at.isoformat(),
            }
            for i in items
        ]
        if file_format == "csv":
            return build_csv_export(EXPORT_HEADERS, rows)
        return build_excel_export(EXPORT_HEADERS, rows, sheet_title="Social Media")
