"""
Agent Service.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from fastapi import HTTPException, status

from app.agents.models import Agent
from app.agents.repository import AgentRepository
from app.agents.schemas import AgentCreate, AgentUpdate


def calculate_age(birth_date: date | None) -> int | None:
    if not birth_date:
        return None
    today = date.today()
    return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))


class AgentService:
    """Business logic for Agents."""

    def __init__(self, repo: AgentRepository) -> None:
        self.repo = repo

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
        return await self.repo.list_agents(
            search=search,
            sales_person=sales_person,
            state=state,
            district=district,
            city=city,
            grade=grade,
            status=status,
            sort_by=sort_by,
            sort_dir=sort_dir,
            limit=limit,
            offset=offset,
        )

    async def get_agent(self, agent_id: uuid.UUID) -> Agent:
        agent = await self.repo.get_by_id(agent_id)
        if not agent:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Agent with id '{agent_id}' not found",
            )
        return agent

    async def check_duplicate(
        self,
        calling_number: str | None,
        whatsapp_number: str | None,
        exclude_id: uuid.UUID | None = None,
    ) -> tuple[bool, str | None, str | None]:
        exists, field, agent = await self.repo.check_duplicate_phone(calling_number, whatsapp_number, exclude_id)
        return exists, field, (agent.full_name if agent else None)

    async def create_agent(self, payload: AgentCreate) -> Agent:
        exists, field, existing_agent = await self.repo.check_duplicate_phone(
            payload.calling_number, payload.whatsapp_number
        )
        if exists and existing_agent:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Agent with this {field} already exists ({existing_agent.full_name})",
            )

        data = payload.model_dump()
        if data.get("birth_date"):
            data["age"] = calculate_age(data["birth_date"])
        if not data.get("added_on"):
            data["added_on"] = date.today()

        return await self.repo.create(data)

    async def update_agent(self, agent_id: uuid.UUID, payload: AgentUpdate) -> Agent:
        agent = await self.get_agent(agent_id)
        update_data = payload.model_dump(exclude_unset=True)

        calling_no = update_data.get("calling_number", agent.calling_number)
        whatsapp_no = update_data.get("whatsapp_number", agent.whatsapp_number)

        exists, field, existing_agent = await self.repo.check_duplicate_phone(
            calling_no, whatsapp_no, exclude_id=agent_id
        )
        if exists and existing_agent:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Agent with this {field} already exists ({existing_agent.full_name})",
            )

        if "birth_date" in update_data:
            update_data["age"] = calculate_age(update_data["birth_date"])

        return await self.repo.update(agent, update_data)

    async def delete_agent(self, agent_id: uuid.UUID) -> bool:
        agent = await self.get_agent(agent_id)
        return await self.repo.soft_delete(agent)

    async def bulk_delete(self, ids: list[uuid.UUID]) -> int:
        count = 0
        for aid in ids:
            try:
                agent = await self.repo.get_by_id(aid)
                if agent:
                    await self.repo.soft_delete(agent)
                    count += 1
            except Exception:
                continue
        return count
