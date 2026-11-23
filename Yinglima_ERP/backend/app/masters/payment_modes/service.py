"""PaymentMode Service."""

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
    update_record_fields,
)
from app.masters.payment_modes.constants import DROPDOWN_CACHE_NAME, EXPORT_HEADERS
from app.masters.payment_modes.models import PaymentMode
from app.masters.payment_modes.repository import PaymentModeRepository
from app.masters.payment_modes.validators import validate_payment_mode_row


class PaymentModeService:
    """Service for PaymentMode."""

    not_found_message = "Payment mode not found."

    def __init__(self, repository: PaymentModeRepository, cache_manager: CacheManager) -> None:
        self.repository = repository
        self.cache_manager = cache_manager

    async def get_by_id_or_raise(self, payment_mode_id: uuid.UUID) -> PaymentMode:
        item = await self.repository.get_by_id(payment_mode_id)
        if item is None:
            raise NotFoundException(self.not_found_message)
        return item

    async def list_paginated(self, query: ListQueryParams) -> tuple[list[PaymentMode], int]:
        return await self.repository.paginated_list(query)

    async def list_all_cached(self) -> list[PaymentMode]:
        cached = await self.cache_manager.get_dropdown(DROPDOWN_CACHE_NAME)
        if cached is not None:
            return cached
        items = await self.repository.list_all()
        await self.cache_manager.set_dropdown(DROPDOWN_CACHE_NAME, items)
        return items

    async def _invalidate_cache(self) -> None:
        await self.cache_manager.invalidate_dropdown(DROPDOWN_CACHE_NAME)

    async def create(self, **field_values: Any) -> PaymentMode:
        name = field_values.get("name")
        code = field_values.get("code")

        from app.common.trash_conflict import check_trash_or_duplicate, code_exists_anywhere

        if not code and name:
            clean_name = "".join(c.upper() for c in name if c.isalnum())[:10]
            code = f"PM-{clean_name}" if clean_name else "PM-GEN"
            counter = 1
            base_code = code
            while await code_exists_anywhere(self.repository.session, PaymentMode, code):
                code = f"{base_code}{counter}"
                counter += 1
            field_values["code"] = code

        await check_trash_or_duplicate(
            self.repository.session,
            PaymentMode,
            entity_type="Payment Mode",
            name=name,
            code=code,
        )

        item = await self.repository.create(**field_values)
        await self._invalidate_cache()
        return item

    async def update(self, payment_mode_id: uuid.UUID, **field_values: Any) -> PaymentMode:
        item = await self.get_by_id_or_raise(payment_mode_id)
        name = field_values.get("name")
        code = field_values.get("code")
        from app.common.trash_conflict import check_trash_or_duplicate

        await check_trash_or_duplicate(
            self.repository.session,
            PaymentMode,
            entity_type="Payment Mode",
            name=name,
            code=code,
            exclude_id=payment_mode_id,
        )

        changes = {k: v for k, v in field_values.items() if v is not None}
        if changes:
            await self.repository.update(item, **changes)
        await self._invalidate_cache()
        return item

    async def activate(self, payment_mode_id: uuid.UUID) -> PaymentMode:
        return await self.update(payment_mode_id, status=RecordStatus.ACTIVE)

    async def deactivate(self, payment_mode_id: uuid.UUID) -> PaymentMode:
        return await self.update(payment_mode_id, status=RecordStatus.INACTIVE)

    async def delete(self, payment_mode_id: uuid.UUID) -> None:
        item = await self.get_by_id_or_raise(payment_mode_id)
        await self.repository.delete(item)
        await self._invalidate_cache()

    async def import_file(self, filename: str, raw_bytes: bytes, *, update_existing: bool = False) -> ImportSummary:
        rows = parse_rows_from_file(filename, raw_bytes)

        async def _create(field_values: dict[str, Any]) -> PaymentMode | tuple[str, PaymentMode]:
            name = field_values["name"]
            existing = await self.repository.get_by_name(name)
            if update_existing and existing is not None:
                has_changes, changes = update_record_fields(existing, field_values)
                if has_changes:
                    await self.repository.update(existing, **changes)
                    return ("updated", existing)
                return ("unchanged", existing)

            if existing is not None:
                raise ConflictException(
                    f"Payment mode name {name!r} already exists.", details={"existing": model_to_dict(existing)}
                )
            return await self.repository.create(**field_values)

        summary = await run_import(
            rows, row_validator=validate_payment_mode_row, row_creator=_create, dedupe_keys=("name",)
        )
        await self._invalidate_cache()
        return summary

    async def export_file(self, file_format: str) -> bytes:
        items = await self.repository.list_all(active_only=False)
        rows = [
            {
                "Sr. No.": idx + 1,
                "Payment Mode / Bank Account": b.name,
                "Code": b.code or "",
                "Account Type": b.account_type or "",
                "Currency": b.currency_code or "",
                "Description": b.description or "",
                "Status": b.status.value.capitalize(),
            }
            for idx, b in enumerate(items)
        ]
        if file_format == "csv":
            return build_csv_export(EXPORT_HEADERS, rows)
        return build_excel_export(EXPORT_HEADERS, rows, sheet_title="Payment Modes")
