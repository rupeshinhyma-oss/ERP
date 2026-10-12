"""
City Service.

Business logic for city CRUD: state (and consistent country) existence,
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
from app.masters.cities.constants import DROPDOWN_CACHE_NAME, EXPORT_HEADERS
from app.masters.cities.models import City
from app.masters.cities.repository import CityRepository
from app.masters.cities.validators import validate_city_row
from app.masters.countries.repository import CountryRepository
from app.masters.import_export import (
    ImportSummary,
    build_csv_export,
    build_excel_export,
    model_to_dict,
    parse_rows_from_file,
    run_import,
    update_record_fields,
)
from app.masters.states.repository import StateRepository


class CityService:
    """Orchestrates city management on top of :class:`CityRepository`."""

    not_found_message = "City not found."

    def __init__(
        self,
        repository: CityRepository,
        state_repository: StateRepository,
        country_repository: CountryRepository,
        cache_manager: CacheManager,
    ) -> None:
        """Bind this service to its repository, the state/country repositories, and the cache manager."""
        self.repository = repository
        self.state_repository = state_repository
        self.country_repository = country_repository
        self.cache_manager = cache_manager

    async def get_by_id_or_raise(self, city_id: uuid.UUID) -> City:
        """Fetch a city by ID or raise :class:`NotFoundException`."""
        city = await self.repository.get_by_id(city_id)
        if city is None:
            raise NotFoundException(self.not_found_message)
        return city

    async def list_paginated(self, query: ListQueryParams) -> tuple[list[City], int]:
        """Return a page of cities matching the given search/sort/filter parameters."""
        return await self.repository.paginated_list(query)

    async def list_all_cached(self) -> list[City]:
        """Return every active city, using the shared dropdown cache."""
        cached = await self.cache_manager.get_dropdown(DROPDOWN_CACHE_NAME)
        if cached is not None:
            return cached
        cities = await self.repository.list_all()
        await self.cache_manager.set_dropdown(DROPDOWN_CACHE_NAME, cities)
        return cities

    async def _invalidate_cache(self) -> None:
        """Invalidate the cities dropdown cache after any mutation."""
        await self.cache_manager.invalidate_dropdown(DROPDOWN_CACHE_NAME)

    async def _validate_state_and_country(self, state_id: uuid.UUID, country_id: uuid.UUID) -> None:
        """Ensure the state exists and genuinely belongs to the given country."""
        state = await self.state_repository.get_by_id(state_id)
        if state is None:
            raise BadRequestException("The specified state does not exist.")
        if state.country_id != country_id:
            raise BadRequestException("The specified state does not belong to the specified country.")

    async def create(self, **field_values: Any) -> City:
        """Create a new city, validating state/country consistency and name uniqueness."""
        state_id = field_values["state_id"]
        country_id = field_values["country_id"]
        name = field_values.get("name")
        await self._validate_state_and_country(state_id, country_id)
        from app.common.trash_conflict import check_trash_or_duplicate

        await check_trash_or_duplicate(
            self.repository.session,
            City,
            entity_type="City",
            name=name,
            extra_filters={"state_id": state_id},
        )

        city = await self.repository.create(**field_values)
        await self._invalidate_cache()
        return city

    async def update(self, city_id: uuid.UUID, **field_values: Any) -> City:
        """Update an existing city, validating state/country consistency and name uniqueness."""
        city = await self.get_by_id_or_raise(city_id)
        state_id = field_values.get("state_id") or city.state_id
        country_id = field_values.get("country_id") or city.country_id
        name = field_values.get("name")
        if field_values.get("state_id") is not None or field_values.get("country_id") is not None:
            await self._validate_state_and_country(state_id, country_id)
        from app.common.trash_conflict import check_trash_or_duplicate

        await check_trash_or_duplicate(
            self.repository.session,
            City,
            entity_type="City",
            name=name,
            exclude_id=city_id,
            extra_filters={"state_id": state_id},
        )

        changes = {k: v for k, v in field_values.items() if v is not None}
        if changes:
            await self.repository.update(city, **changes)
        await self._invalidate_cache()
        return city

    async def activate(self, city_id: uuid.UUID) -> City:
        """Set a city's status to ACTIVE."""
        return await self.update(city_id, status=RecordStatus.ACTIVE)

    async def deactivate(self, city_id: uuid.UUID) -> City:
        """Set a city's status to INACTIVE."""
        return await self.update(city_id, status=RecordStatus.INACTIVE)

    async def delete(self, city_id: uuid.UUID) -> None:
        """Soft-delete a city, refusing if it is referenced elsewhere."""
        city = await self.get_by_id_or_raise(city_id)
        if await self.repository.is_referenced(city_id):
            raise ConflictException("This city cannot be deleted because it is referenced elsewhere.")
        await self.repository.delete(city)
        await self._invalidate_cache()

    # ------------------------------------------------------------------
    # Import / Export
    # ------------------------------------------------------------------

    async def import_file(self, filename: str, raw_bytes: bytes, *, update_existing: bool = False) -> ImportSummary:
        """Validate and import cities from an uploaded CSV/XLSX file."""
        rows = parse_rows_from_file(filename, raw_bytes)

        async def _create(field_values: dict[str, Any]) -> City | tuple[str, City]:
            country_code = field_values.pop("country_code")
            state_name = field_values.pop("state_name")
            country = await self.country_repository.get_by_code(country_code.upper())
            if country is None:
                country = await self.country_repository.get_by_name(country_code)
            if country is None:
                for c in await self.country_repository.list_all():
                    if c.code.upper() == country_code.upper() or c.name.strip().lower() == country_code.strip().lower():
                        country = c
                        break
            if country is None:
                raise BadRequestException(f"Country {country_code!r} does not exist.")
            matching_states = [
                s for s in await self.state_repository.list_all()
                if s.country_id == country.id and s.name.strip().lower() == state_name.strip().lower()
            ]
            if not matching_states:
                raise BadRequestException(f"State {state_name!r} does not exist in country {country.name!r}.")
            state = matching_states[0]
            field_values["country_id"] = country.id
            field_values["state_id"] = state.id
            name = field_values["name"]
            existing = await self.repository.get_by_name_in_state(state.id, name)
            if update_existing and existing is not None:
                has_changes, changes = update_record_fields(existing, field_values)
                if has_changes:
                    await self.repository.update(existing, **changes)
                    return ("updated", existing)
                return ("unchanged", existing)

            if existing is not None:
                raise ConflictException(
                    f"City {name!r} already exists in state {state_name!r}.",
                    details={"existing": model_to_dict(existing)},
                )
            return await self.repository.create(**field_values)

        summary = await run_import(
            rows,
            row_validator=validate_city_row,
            row_creator=_create,
            dedupe_keys=("name", "country_code", "state_name"),
        )
        await self._invalidate_cache()
        return summary

    async def export_file(self, file_format: str) -> bytes:
        """Export every city to CSV or XLSX with clean human-readable business headers matching UI table sequence."""
        cities = await self.repository.list_all()
        countries = {c.id: c.name for c in await self.country_repository.list_all()}
        states = {s.id: s.name for s in await self.state_repository.list_all()}

        rows = []
        for idx, c in enumerate(cities, start=1):
            status_val = c.status.value.capitalize() if hasattr(c.status, "value") else str(c.status or "").capitalize()
            rows.append(
                {
                    "Sr. No.": idx,
                    "City Name": c.name,
                    "Province / Region": states.get(c.state_id, ""),
                    "Country": countries.get(c.country_id, ""),
                    "Status": status_val,
                }
            )
        if file_format == "csv":
            return build_csv_export(EXPORT_HEADERS, rows)
        return build_excel_export(EXPORT_HEADERS, rows, sheet_title="Cities")
