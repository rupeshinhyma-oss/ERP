"""Bank Service. Business logic for Bank CRUD, cache invalidation, and import/export."""

from __future__ import annotations

import uuid
from typing import Any

from app.cache.manager import CacheManager
from app.common.list_query import ListQueryParams
from app.core.constants import RecordStatus
from app.core.exceptions import ConflictException, NotFoundException
from app.masters.banks.constants import DROPDOWN_CACHE_NAME, EXPORT_HEADERS
from app.masters.banks.models import Bank
from app.masters.banks.repository import BankRepository
from app.masters.banks.validators import validate_bank_row
from app.masters.import_export import (
    ImportSummary,
    build_csv_export,
    build_excel_export,
    model_to_dict,
    parse_rows_from_file,
    run_import,
)


class BankService:
    """Orchestrates bank account management on top of :class:`BankRepository`."""

    not_found_message = "Bank record not found."

    def __init__(self, repository: BankRepository, cache_manager: CacheManager) -> None:
        """Bind this service to its repository and the cache manager."""
        self.repository = repository
        self.cache_manager = cache_manager

    async def get_by_id_or_raise(self, bank_id: uuid.UUID) -> Bank:
        """Fetch a bank record by ID or raise :class:`NotFoundException`."""
        item = await self.repository.get_by_id(bank_id)
        if item is None:
            raise NotFoundException(self.not_found_message)
        return item

    async def list_paginated(self, query: ListQueryParams) -> tuple[list[Bank], int]:
        """Return a page of banks matching search/sort/filter parameters."""
        return await self.repository.paginated_list(query)

    async def list_all_cached(self) -> list[Bank]:
        """Return every active bank record, using the shared dropdown cache."""
        cached = await self.cache_manager.get_dropdown(DROPDOWN_CACHE_NAME)
        if cached is not None:
            return cached
        items = await self.repository.list_all()
        await self.cache_manager.set_dropdown(DROPDOWN_CACHE_NAME, items)
        return items

    async def _invalidate_cache(self) -> None:
        """Invalidate the bank dropdown cache after mutation."""
        await self.cache_manager.invalidate_dropdown(DROPDOWN_CACHE_NAME)

    async def create(self, **field_values: Any) -> Bank:
        """Create a new bank entry, validating account number uniqueness."""
        account_number = field_values.get("account_number")
        if account_number:
            existing = await self.repository.get_by_account_number(account_number)
            if existing is not None:
                raise ConflictException(
                    f"Bank account number {account_number!r} is already in use.",
                    details={"existing": model_to_dict(existing)},
                )

        item = await self.repository.create(**field_values)
        await self._invalidate_cache()
        return item

    async def update(self, bank_id: uuid.UUID, **field_values: Any) -> Bank:
        """Update an existing bank entry, validating account number uniqueness."""
        item = await self.get_by_id_or_raise(bank_id)
        account_number = field_values.get("account_number")
        if account_number:
            existing = await self.repository.get_by_account_number(account_number)
            if existing is not None and existing.id != bank_id:
                raise ConflictException(
                    f"Bank account number {account_number!r} is already in use.",
                    details={"existing": model_to_dict(existing)},
                )

        changes = {k: v for k, v in field_values.items() if v is not None}
        if changes:
            await self.repository.update(item, **changes)
        await self._invalidate_cache()
        return item

    async def activate(self, bank_id: uuid.UUID) -> Bank:
        """Set bank status to ACTIVE."""
        return await self.update(bank_id, status=RecordStatus.ACTIVE)

    async def deactivate(self, bank_id: uuid.UUID) -> Bank:
        """Set bank status to INACTIVE."""
        return await self.update(bank_id, status=RecordStatus.INACTIVE)

    async def delete(self, bank_id: uuid.UUID) -> None:
        """Soft-delete a bank record."""
        item = await self.get_by_id_or_raise(bank_id)
        await self.repository.delete(item)
        await self._invalidate_cache()

    # ------------------------------------------------------------------
    # Import / Export
    # ------------------------------------------------------------------

    async def import_file(self, filename: str, raw_bytes: bytes) -> ImportSummary:
        """Validate and import bank records from an uploaded CSV/XLSX file."""
        rows = parse_rows_from_file(filename, raw_bytes)

        async def _create(field_values: dict[str, Any]) -> Bank:
            account_number = field_values["account_number"]
            existing = await self.repository.get_by_account_number(account_number)
            if existing is not None:
                raise ConflictException(
                    f"Bank account with account number {account_number!r} already exists.",
                    details={"existing": model_to_dict(existing)},
                )
            return await self.repository.create(**field_values)

        summary = await run_import(
            rows,
            row_validator=validate_bank_row,
            row_creator=_create,
            dedupe_keys=("account_number",),
        )
        await self._invalidate_cache()
        return summary

    async def export_file(self, file_format: str) -> bytes:
        """Export every bank record to CSV or XLSX bytes."""
        items = await self.repository.list_all()
        rows = [
            {
                "Bank Name": i.bank_name,
                "Account Number": i.account_number,
                "Account Holder Name": i.account_holder_name,
                "IFSC Code": i.ifsc_code,
                "Branch": i.branch,
                "Status": i.status.value,
                "Created At": i.created_at.strftime("%d-%m-%Y %I:%M %p") if i.created_at else "",
            }
            for i in items
        ]
        if file_format == "csv":
            return build_csv_export(EXPORT_HEADERS, rows)
        return build_excel_export(EXPORT_HEADERS, rows, sheet_title="Banks")
