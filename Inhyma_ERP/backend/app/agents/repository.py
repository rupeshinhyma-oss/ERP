"""
Agent Repository.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.models import Agent
from app.common.base_repository import BaseRepository


def normalize_phone(phone: str | None) -> str:
    if not phone:
        return ""
    return re.sub(r"[^\d]", "", phone)


class AgentRepository(BaseRepository[Agent]):
    """Repository for Agent entities."""

    searchable_fields = (
        "full_name",
        "agent_type",
        "company_name",
        "calling_number",
        "whatsapp_number",
        "state",
        "district",
        "city",
        "area",
        "agent_grade",
        "current_status",
        "sales_person",
        "remarks",
    )
    sortable_fields = (
        "full_name",
        "company_name",
        "agent_type",
        "agent_grade",
        "current_status",
        "potential",
        "age",
        "added_on",
        "created_at",
    )

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, Agent)

    async def list_agents(
        self,
        *,
        search: str | None = None,
        sales_person: str | None = None,
        state: str | None = None,
        district: str | None = None,
        city: str | None = None,
        grade: str | None = None,
        status: str | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Agent], int]:
        stmt = self._base_select()

        if sales_person and sales_person.strip() and sales_person.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(Agent.sales_person) == sales_person.strip().lower())
        if state and state.strip() and state.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(Agent.state) == state.strip().lower())
        if district and district.strip() and district.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(Agent.district) == district.strip().lower())
        if city and city.strip() and city.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(Agent.city) == city.strip().lower())
        if grade and grade.strip() and grade.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(Agent.agent_grade) == grade.strip().lower())
        if status and status.strip() and status.strip().lower() not in ("all", "select"):
            stmt = stmt.where(func.lower(Agent.current_status) == status.strip().lower())

        if search and search.strip():
            term = f"%{search.strip().lower()}%"
            stmt = stmt.where(
                or_(
                    func.lower(Agent.full_name).like(term),
                    func.lower(Agent.company_name).like(term),
                    func.lower(Agent.calling_number).like(term),
                    func.lower(Agent.whatsapp_number).like(term),
                    func.lower(Agent.city).like(term),
                    func.lower(Agent.district).like(term),
                    func.lower(Agent.state).like(term),
                    func.lower(Agent.sales_person).like(term),
                    func.lower(Agent.agent_type).like(term),
                )
            )

        # Count total
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_res = await self.session.execute(count_stmt)
        total = total_res.scalar_one()

        # Sorting
        sort_col = getattr(Agent, sort_by, Agent.created_at)
        if sort_dir.lower() == "asc":
            stmt = stmt.order_by(sort_col.asc())
        else:
            stmt = stmt.order_by(sort_col.desc())

        stmt = stmt.offset(offset).limit(limit)
        result = await self.session.execute(stmt)
        items = list(result.scalars().all())
        return items, total

    async def check_duplicate_phone(
        self,
        calling_number: str | None,
        whatsapp_number: str | None,
        exclude_id: uuid.UUID | None = None,
    ) -> tuple[bool, str | None, Agent | None]:
        """
        Check if calling_number or whatsapp_number exists on any active agent record.
        Returns (exists: bool, conflicting_field: str | None, agent: Agent | None).
        """
        clean_calling = normalize_phone(calling_number)
        clean_whatsapp = normalize_phone(whatsapp_number)

        stmt = self._base_select()
        if exclude_id:
            stmt = stmt.where(Agent.id != exclude_id)

        # Fetch non-deleted agents
        result = await self.session.execute(stmt)
        agents = result.scalars().all()

        for a in agents:
            a_calling = normalize_phone(a.calling_number)
            a_whatsapp = normalize_phone(a.whatsapp_number)

            if clean_calling and a_calling and (clean_calling == a_calling or clean_calling == a_whatsapp):
                return True, "Calling Number", a
            if clean_whatsapp and a_whatsapp and (clean_whatsapp == a_whatsapp or clean_whatsapp == a_calling):
                return True, "WhatsApp Number", a

        return False, None, None
