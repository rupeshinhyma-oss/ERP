"""Option List service: queries and CRUD in one place (small, single-table master)."""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException, NotFoundException
from app.masters.option_lists.models import OptionList


class OptionListService:
    """Business logic for the generic option lists master."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_groups(self, group_keys: Iterable[str]) -> dict[str, list[OptionList]]:
        """Return active options for each requested group, ordered for display."""
        keys = [k.strip() for k in group_keys if k and k.strip()]
        result: dict[str, list[OptionList]] = {k: [] for k in keys}
        if not keys:
            return result
        stmt = (
            select(OptionList)
            .where(
                OptionList.group_key.in_(keys),
                OptionList.deleted_at.is_(None),
                OptionList.status == RecordStatus.ACTIVE,
            )
            .order_by(OptionList.group_key, OptionList.sort_order, OptionList.label)
        )
        for row in (await self.session.execute(stmt)).scalars().all():
            result[row.group_key].append(row)
        return result

    async def list_all_group_keys(self) -> list[str]:
        """Return the distinct group keys currently defined."""
        stmt = select(OptionList.group_key).where(OptionList.deleted_at.is_(None)).distinct().order_by(OptionList.group_key)
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_admin(self, group_key: str | None) -> list[OptionList]:
        """Return every non-deleted option (any status), optionally for one group."""
        stmt = select(OptionList).where(OptionList.deleted_at.is_(None))
        if group_key:
            stmt = stmt.where(OptionList.group_key == group_key)
        stmt = stmt.order_by(OptionList.group_key, OptionList.sort_order, OptionList.label)
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_or_raise(self, option_id: uuid.UUID) -> OptionList:
        item = await self.session.get(OptionList, option_id)
        if item is None or item.deleted_at is not None:
            raise NotFoundException("Option not found.")
        return item

    async def _value_taken(self, group_key: str, value: str, exclude_id: uuid.UUID | None = None) -> bool:
        stmt = select(OptionList.id).where(
            OptionList.group_key == group_key,
            OptionList.value == value,
            OptionList.deleted_at.is_(None),
        )
        if exclude_id:
            stmt = stmt.where(OptionList.id != exclude_id)
        return (await self.session.execute(stmt.limit(1))).first() is not None

    async def create(self, **data) -> OptionList:
        if await self._value_taken(data["group_key"], data["value"]):
            raise BadRequestException("This option already exists in the group.")
        data["label"] = data.get("label") or data["value"]
        item = OptionList(**data)
        self.session.add(item)
        await self.session.flush()
        await self.session.refresh(item)
        return item

    async def update(self, option_id: uuid.UUID, **data) -> OptionList:
        item = await self.get_or_raise(option_id)
        new_value = data.get("value")
        if new_value and await self._value_taken(item.group_key, new_value, exclude_id=item.id):
            raise BadRequestException("This option already exists in the group.")
        for key, val in data.items():
            setattr(item, key, val)
        await self.session.flush()
        await self.session.refresh(item)
        return item

    async def delete(self, option_id: uuid.UUID) -> None:
        from datetime import datetime, timezone

        item = await self.get_or_raise(option_id)
        item.deleted_at = datetime.now(timezone.utc)
        await self.session.flush()
