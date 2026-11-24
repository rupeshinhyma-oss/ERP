"""
FollowUp Repository.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.core.exceptions import BadRequestException
from app.follow_ups.models import FollowUp


def _parse_filter_date(value: Any, param_name: str) -> date | None:
    """Convert an optional YYYY-MM-DD query filter into a native ``datetime.date``."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        try:
            return date.fromisoformat(cleaned)
        except ValueError as exc:
            raise BadRequestException(
                f"Invalid {param_name!r} date value {value!r}. Expected ISO format YYYY-MM-DD."
            ) from exc
    raise BadRequestException(
        f"Invalid {param_name!r} date value {value!r}. Expected ISO format YYYY-MM-DD."
    )


class FollowUpRepository(BaseRepository[FollowUp]):
    """Repository for FollowUp entities."""

    searchable_fields = (
        "company_name",
        "contact_person",
        "contact_phone",
        "contact_email",
        "designation",
        "business_type",
        "client_grade",
        "potential_type",
        "business_category",
        "category",
        "call_type",
        "call_category",
        "marketing_person",
        "current_status",
        "feedback",
        "area",
        "city",
        "district",
        "state",
        "notes",
        "direct_import_from_china",
        "monthly_import_volume",
        "lead_status",
        "reason_for_won_loss",
        "entry_source",
    )
    sortable_fields = (
        "company_name",
        "contact_person",
        "business_type",
        "client_grade",
        "potential_type",
        "area",
        "city",
        "district",
        "state",
        "current_status",
        "feedback",
        "call_category",
        "call_type",
        "followup_date",
        "added_on",
        "created_at",
        "direct_import_from_china",
        "monthly_import_volume",
        "lead_status",
    )
    filterable_fields = (
        "call_type",
        "marketing_person",
        "business_type",
        "state",
        "district",
        "city",
        "current_status",
        "category",
        "client_grade",
        "potential_type",
        "business_category",
        "call_category",
        "direct_import_from_china",
        "monthly_import_volume",
        "lead_status",
        "entry_source",
    )

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, FollowUp)

    async def list_follow_ups(
        self,
        *,
        search: str | None = None,
        call_type: str | None = None,
        marketing_person: str | None = None,
        marketing_person_names: set[str] | None = None,
        scoped_user_ids: set[uuid.UUID] | None = None,
        scoped_usernames: set[str] | None = None,
        business_type: str | None = None,
        state: str | None = None,
        district: str | None = None,
        city: str | None = None,
        current_status: str | None = None,
        category: str | None = None,
        client_grade: str | None = None,
        potential_type: str | None = None,
        business_category: str | None = None,
        company_name: str | None = None,
        call_category: str | None = None,
        direct_import_from_china: str | None = None,
        monthly_import_volume: str | None = None,
        lead_status: str | None = None,
        entry_source: str | None = None,
        added_date: Any | None = None,
        date_from: Any | None = None,
        date_to: Any | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[FollowUp], int]:
        """Query follow-ups with full text search, field filtering, sorting, and pagination."""
        stmt = self._base_select()

        # Filters
        if company_name and company_name.strip():
            stmt = stmt.where(func.lower(FollowUp.company_name) == company_name.strip().lower())
        if call_category and call_category.strip() and call_category.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.call_category) == call_category.strip().lower())
        if call_type and call_type.strip() and call_type.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.call_type) == call_type.strip().lower())
        if scoped_user_ids is not None:
            scope_conds = [
                FollowUp.owner_user_id.in_(list(scoped_user_ids)),
                and_(FollowUp.owner_user_id.is_(None), FollowUp.created_by_user_id.in_(list(scoped_user_ids))),
            ]
            if scoped_usernames:
                scope_conds.append(
                    and_(
                        FollowUp.owner_user_id.is_(None),
                        FollowUp.created_by_user_id.is_(None),
                        func.lower(FollowUp.marketing_person).in_(sorted(scoped_usernames)),
                    )
                )
            stmt = stmt.where(or_(*scope_conds))
            if marketing_person and marketing_person.strip() and marketing_person.strip().lower() not in ("all", "select"):
                stmt = stmt.where(func.lower(FollowUp.marketing_person) == marketing_person.strip().lower())
        elif marketing_person_names:
            stmt = stmt.where(func.lower(FollowUp.marketing_person).in_(sorted(marketing_person_names)))
        elif marketing_person and marketing_person.strip() and marketing_person.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.marketing_person) == marketing_person.strip().lower())
        if business_type and business_type.strip() and business_type.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.business_type) == business_type.strip().lower())
        if state and state.strip() and state.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.state) == state.strip().lower())
        if district and district.strip() and district.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.district) == district.strip().lower())
        if city and city.strip() and city.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.city) == city.strip().lower())
        if current_status and current_status.strip() and current_status.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.current_status) == current_status.strip().lower())
        if category and category.strip() and category.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.category) == category.strip().lower())
        if client_grade and client_grade.strip() and client_grade.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.client_grade) == client_grade.strip().lower())
        if potential_type and potential_type.strip() and potential_type.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.potential_type) == potential_type.strip().lower())
        if business_category and business_category.strip() and business_category.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.business_category) == business_category.strip().lower())
        if direct_import_from_china and direct_import_from_china.strip() and direct_import_from_china.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.direct_import_from_china) == direct_import_from_china.strip().lower())
        if monthly_import_volume and monthly_import_volume.strip() and monthly_import_volume.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.monthly_import_volume).ilike(f"%{monthly_import_volume.strip().lower()}%"))
        if lead_status and lead_status.strip() and lead_status.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.lead_status) == lead_status.strip().lower())
        if entry_source and entry_source.strip() and entry_source.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(FollowUp.entry_source) == entry_source.strip().lower())

        # Date filters (strictly typed to native datetime.date for PostgreSQL DATE columns)
        parsed_added_date = _parse_filter_date(added_date, "added_date")
        parsed_date_from = _parse_filter_date(date_from, "date_from")
        parsed_date_to = _parse_filter_date(date_to, "date_to")
        if parsed_added_date is not None:
            stmt = stmt.where(FollowUp.added_on == parsed_added_date)
        if parsed_date_from is not None:
            stmt = stmt.where(FollowUp.added_on >= parsed_date_from)
        if parsed_date_to is not None:
            stmt = stmt.where(FollowUp.added_on <= parsed_date_to)

        # Validate sorting against explicit allowlist before model attribute access
        clean_sort_by = (sort_by or "").strip() or "created_at"
        if clean_sort_by not in self.sortable_fields:
            raise BadRequestException(
                f"Cannot sort follow-ups by {sort_by!r}. Allowed fields: {', '.join(self.sortable_fields)}."
            )
        clean_sort_dir = (sort_dir or "").strip().lower() or "desc"
        if clean_sort_dir not in ("asc", "desc"):
            raise BadRequestException(
                f"Invalid sort_dir {sort_dir!r}. Allowed values: asc, desc."
            )

        # Free search
        if search and search.strip():
            term = f"%{search.strip().lower()}%"
            or_clauses = [
                func.lower(FollowUp.company_name).ilike(term),
                func.lower(FollowUp.contact_person).ilike(term),
                func.lower(FollowUp.contact_phone).ilike(term),
                func.lower(FollowUp.city).ilike(term),
                func.lower(FollowUp.district).ilike(term),
                func.lower(FollowUp.state).ilike(term),
                func.lower(FollowUp.call_type).ilike(term),
                func.lower(FollowUp.call_category).ilike(term),
                func.lower(FollowUp.marketing_person).ilike(term),
                func.lower(FollowUp.current_status).ilike(term),
                func.lower(FollowUp.feedback).ilike(term),
                func.lower(FollowUp.business_type).ilike(term),
                func.lower(FollowUp.lead_status).ilike(term),
                func.lower(FollowUp.reason_for_won_loss).ilike(term),
                func.lower(FollowUp.monthly_import_volume).ilike(term),
            ]
            stmt = stmt.where(or_(*or_clauses))

        # Total count
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await self.session.execute(count_stmt)).scalar() or 0

        # Sorting (pre-validated against self.sortable_fields & asc/desc allowlist)
        sort_col = getattr(FollowUp, clean_sort_by)
        if clean_sort_dir == "asc":
            stmt = stmt.order_by(sort_col.asc().nulls_last())
        else:
            stmt = stmt.order_by(sort_col.desc().nulls_last())

        # Pagination
        stmt = stmt.limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        return list(result.scalars().all()), total

    async def soft_delete(self, instance: FollowUp) -> None:
        """Soft-delete a single follow-up via BaseRepository.delete (sets deleted_at)."""
        await self.delete(instance)

    async def bulk_soft_delete(self, ids: list[uuid.UUID]) -> int:
        """Soft delete multiple follow-up records atomically using SoftDeleteMixin semantics."""
        unique_ids = list(dict.fromkeys(ids))
        if not unique_ids:
            return 0
        stmt = select(FollowUp).where(
            FollowUp.id.in_(unique_ids),
            FollowUp.deleted_at.is_(None),
        )
        result = await self.session.execute(stmt)
        items = list(result.scalars().all())
        for item in items:
            await self.soft_delete(item)
        return len(items)
