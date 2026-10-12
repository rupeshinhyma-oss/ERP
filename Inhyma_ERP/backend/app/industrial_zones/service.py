"""
Industrial Zone Service.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException, status

from app.industrial_zones.models import IndustrialZone
from app.industrial_zones.repository import IndustrialZoneRepository
from app.industrial_zones.schemas import IndustrialZoneCreate, IndustrialZoneUpdate


class IndustrialZoneService:
    """Business logic for Industrial Zones."""

    def __init__(self, repo: IndustrialZoneRepository) -> None:
        self.repo = repo

    async def list_zones(
        self,
        *,
        search: str | None = None,
        grade: str | None = None,
        state: str | None = None,
        district: str | None = None,
        city: str | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[IndustrialZone], int]:
        return await self.repo.list_zones(
            search=search,
            grade=grade,
            state=state,
            district=district,
            city=city,
            sort_by=sort_by,
            sort_dir=sort_dir,
            limit=limit,
            offset=offset,
        )

    async def get_zone(self, zone_id: uuid.UUID) -> IndustrialZone:
        zone = await self.repo.get_by_id(zone_id)
        if not zone:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Industrial Zone with id '{zone_id}' not found",
            )
        return zone

    async def check_name_exists(self, name: str, exclude_id: uuid.UUID | None = None) -> bool:
        if not name or not name.strip():
            return False
        existing = await self.repo.get_by_name(name.strip(), exclude_id)
        return existing is not None

    async def create_zone(self, payload: IndustrialZoneCreate) -> IndustrialZone:
        name = payload.zone_name.strip()
        existing = await self.repo.get_by_name(name)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Industrial Zone with name '{name}' already exists",
            )

        zone_data = payload.model_dump()
        zone_data["zone_name"] = name
        return await self.repo.create(zone_data)

    async def update_zone(self, zone_id: uuid.UUID, payload: IndustrialZoneUpdate) -> IndustrialZone:
        zone = await self.get_zone(zone_id)
        update_data = payload.model_dump(exclude_unset=True)

        if "zone_name" in update_data and update_data["zone_name"]:
            name = update_data["zone_name"].strip()
            existing = await self.repo.get_by_name(name, exclude_id=zone_id)
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Industrial Zone with name '{name}' already exists",
                )
            update_data["zone_name"] = name

        updated = await self.repo.update(zone, update_data)
        return updated

    async def delete_zone(self, zone_id: uuid.UUID) -> bool:
        zone = await self.get_zone(zone_id)
        return await self.repo.soft_delete(zone)

    async def bulk_delete(self, ids: list[uuid.UUID]) -> int:
        count = 0
        for zid in ids:
            try:
                zone = await self.repo.get_by_id(zid)
                if zone:
                    await self.repo.soft_delete(zone)
                    count += 1
            except Exception:
                continue
        return count
