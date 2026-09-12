"""
District Service.

Business logic for district CRUD: state (and consistent country) existence,
name-uniqueness-within-state, cache invalidation, and CSV/Excel
import/export orchestration.
"""

from __future__ import annotations

import uuid
from typing import Any

from app.cache.manager import CacheManager
from app.common.list_query import ListQueryParams
from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException, ConflictException, NotFoundException
from app.masters.countries.repository import CountryRepository
from app.masters.districts.constants import DROPDOWN_CACHE_NAME, EXPORT_HEADERS
from app.masters.districts.models import District
from app.masters.districts.repository import DistrictRepository
from app.masters.districts.validators import validate_district_row
from app.masters.import_export import (
    ImportSummary,
    build_csv_export,
    build_excel_export,
    model_to_dict,
    parse_rows_from_file,
    run_import,
)
from app.masters.states.repository import StateRepository


class DistrictService:
    """Orchestrates district management on top of :class:`DistrictRepository`."""

    not_found_message = "District not found."

    def __init__(
        self,
        repository: DistrictRepository,
        state_repository: StateRepository,
        country_repository: CountryRepository,
        cache_manager: CacheManager,
    ) -> None:
        """Bind this service to its repository, the state/country repositories, and the cache manager."""
        self.repository = repository
        self.state_repository = state_repository
        self.country_repository = country_repository
        self.cache_manager = cache_manager

    async def get_by_id_or_raise(self, district_id: uuid.UUID) -> District:
        """Fetch a district by ID or raise :class:`NotFoundException`."""
        district = await self.repository.get_by_id(district_id)
        if district is None:
            raise NotFoundException(self.not_found_message)
        return district

    async def list_paginated(self, query: ListQueryParams) -> tuple[list[District], int]:
        """Return a page of districts matching the given search/sort/filter parameters."""
        return await self.repository.paginated_list(query)

    async def list_all_cached(self) -> list[District]:
        """Return every active district, using the shared dropdown cache."""
        cached = await self.cache_manager.get_dropdown(DROPDOWN_CACHE_NAME)
        if cached is not None:
            return cached
        districts = await self.repository.list_all()
        await self.cache_manager.set_dropdown(DROPDOWN_CACHE_NAME, districts)
        return districts

    async def list_by_state(self, state_id: uuid.UUID) -> list[District]:
        """Return every district in a specific state."""
        return await self.repository.list_by_state(state_id)

    async def _invalidate_cache(self) -> None:
        """Invalidate the districts dropdown cache after any mutation."""
        await self.cache_manager.invalidate_dropdown(DROPDOWN_CACHE_NAME)

    async def _validate_state_and_country(
        self, country_id: uuid.UUID, state_id: uuid.UUID
    ) -> None:
        """Verify the state exists and belongs to the specified country."""
        state = await self.state_repository.get_by_id(state_id)
        if state is None:
            raise BadRequestException("The specified State does not exist.")
        if state.country_id != country_id:
            raise BadRequestException(
                "State does not belong to the specified Country."
            )

    async def create(
        self,
        country_id: uuid.UUID,
        state_id: uuid.UUID,
        name: str,
        code: str | None = None,
        status: RecordStatus = RecordStatus.ACTIVE,
    ) -> District:
        """Create a new district after validating foreign keys and uniqueness."""
        await self._validate_state_and_country(country_id, state_id)
        if await self.repository.name_exists_in_state(state_id, name):
            raise ConflictException(
                f"A district named {name!r} already exists in this State."
            )
        district = await self.repository.create(
            country_id=country_id,
            state_id=state_id,
            name=name,
            code=code,
            status=status,
        )
        await self._invalidate_cache()
        return district

    async def update(
        self,
        district_id: uuid.UUID,
        *,
        country_id: uuid.UUID | None = None,
        state_id: uuid.UUID | None = None,
        name: str | None = None,
        code: str | None = None,
        status: RecordStatus | None = None,
    ) -> District:
        """Update an existing district's fields, validating when state/country/name change."""
        district = await self.get_by_id_or_raise(district_id)

        target_country = country_id if country_id is not None else district.country_id
        target_state = state_id if state_id is not None else district.state_id
        target_name = name if name is not None else district.name

        if country_id is not None or state_id is not None:
            await self._validate_state_and_country(target_country, target_state)

        if name is not None or state_id is not None:
            if await self.repository.name_exists_in_state(
                target_state, target_name, exclude_id=district_id
            ):
                raise ConflictException(
                    f"A district named {target_name!r} already exists in this State."
                )

        updates: dict[str, Any] = {}
        if country_id is not None:
            updates["country_id"] = country_id
        if state_id is not None:
            updates["state_id"] = state_id
        if name is not None:
            updates["name"] = name
        if code is not None:
            updates["code"] = code
        if status is not None:
            updates["status"] = status

        if updates:
            district = await self.repository.update(district, **updates)
            await self._invalidate_cache()
        return district

    async def delete(self, district_id: uuid.UUID) -> None:
        """Soft-delete a district."""
        district = await self.get_by_id_or_raise(district_id)
        if await self.repository.is_referenced(district_id):
            raise ConflictException(
                "Cannot delete this district because other records still reference it."
            )
        await self.repository.soft_delete(district)
        await self._invalidate_cache()

    async def set_status(self, district_id: uuid.UUID, status: RecordStatus) -> District:
        """Set a district's active/inactive status."""
        district = await self.get_by_id_or_raise(district_id)
        district = await self.repository.update(district, status=status)
        await self._invalidate_cache()
        return district

    async def activate(self, district_id: uuid.UUID) -> District:
        """Activate a district."""
        return await self.set_status(district_id, RecordStatus.ACTIVE)

    async def deactivate(self, district_id: uuid.UUID) -> District:
        """Deactivate a district."""
        return await self.set_status(district_id, RecordStatus.INACTIVE)

    async def export_file(self, fmt: str) -> bytes:
        """Export all districts returning bytes."""
        content, _ = await self.export(fmt)
        return content

    async def bulk_delete(self, district_ids: list[uuid.UUID]) -> int:
        """Soft-delete multiple districts."""
        count = await self.repository.bulk_soft_delete(district_ids)
        await self._invalidate_cache()
        return count

    async def bulk_status(
        self, district_ids: list[uuid.UUID], status: RecordStatus
    ) -> int:
        """Change status for multiple districts."""
        count = await self.repository.bulk_set_status(district_ids, status)
        await self._invalidate_cache()
        return count

    async def export(self, fmt: str) -> tuple[bytes, str]:
        """Export all districts to CSV or Excel format."""
        districts = await self.repository.list_all()
        rows = [model_to_dict(d, EXPORT_HEADERS) for d in districts]
        if fmt == "excel":
            content = build_excel_export(rows, EXPORT_HEADERS, sheet_name="Districts")
            media_type = (
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            )
        else:
            content = build_csv_export(rows, EXPORT_HEADERS)
            media_type = "text/csv; charset=utf-8"
        return content, media_type

    async def import_file(
        self, file_content: bytes, filename: str
    ) -> ImportSummary:
        """Import districts from CSV or Excel file."""
        raw_rows = parse_rows_from_file(file_content, filename)

        async def row_handler(clean_row: dict[str, Any]) -> str:
            country = await self.country_repository.get_by_code(clean_row["country_code"])
            if country is None:
                raise BadRequestException(
                    f"Country code {clean_row['country_code']!r} not found."
                )
            state = await self.state_repository.get_by_name_in_country(
                country.id, clean_row["state_name"]
            )
            if state is None:
                raise BadRequestException(
                    f"State {clean_row['state_name']!r} not found in country {clean_row['country_code']!r}."
                )

            existing = await self.repository.get_by_name_in_state(
                state.id, clean_row["name"]
            )
            if existing is not None:
                await self.repository.update(
                    existing, status=clean_row["status"], code=clean_row.get("code")
                )
                return "updated"

            await self.repository.create(
                country_id=country.id,
                state_id=state.id,
                name=clean_row["name"],
                code=clean_row.get("code"),
                status=clean_row["status"],
            )
            return "created"

        summary = await run_import(
            raw_rows=raw_rows,
            validator=validate_district_row,
            row_handler=row_handler,
            duplicate_finder=lambda row: None,
        )
        await self._invalidate_cache()
        return summary
