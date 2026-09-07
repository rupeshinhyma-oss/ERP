"""ERP Membership Repository -- pure DB access, no business rules."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.erp_memberships.models import ErpMembership


class ErpMembershipRepository:
    """Data access for the `erp_memberships` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_id(self, membership_id: uuid.UUID) -> ErpMembership | None:
        """Fetch a single membership by id, or None if not found."""
        result = await self.db.execute(select(ErpMembership).where(ErpMembership.id == membership_id))
        return result.scalar_one_or_none()

    async def get_by_user_and_erp(self, global_user_id: uuid.UUID, erp_instance_id: uuid.UUID) -> ErpMembership | None:
        """Fetch the membership (if any) linking a Global User to a specific ERP instance."""
        result = await self.db.execute(
            select(ErpMembership).where(
                ErpMembership.global_user_id == global_user_id,
                ErpMembership.erp_instance_id == erp_instance_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_by_erp_and_local_user(self, erp_instance_id: uuid.UUID, local_user_id: str) -> ErpMembership | None:
        """Fetch the membership (if any) that already claims this ERP's local user id."""
        result = await self.db.execute(
            select(ErpMembership).where(
                ErpMembership.erp_instance_id == erp_instance_id,
                ErpMembership.local_user_id == local_user_id,
            )
        )
        return result.scalar_one_or_none()

    async def list_for_user(self, global_user_id: uuid.UUID) -> list[ErpMembership]:
        """List every membership a Global User holds, across all ERPs."""
        result = await self.db.execute(
            select(ErpMembership).where(ErpMembership.global_user_id == global_user_id)
        )
        return list(result.scalars().all())

    async def list_for_erp(self, erp_instance_id: uuid.UUID, *, limit: int = 100, offset: int = 0) -> list[ErpMembership]:
        """List memberships for one ERP instance, paged (Phase 3 Step 35 -- never the whole table at once)."""
        result = await self.db.execute(
            select(ErpMembership)
            .where(ErpMembership.erp_instance_id == erp_instance_id)
            .order_by(ErpMembership.created_at)
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())

    async def create(self, membership: ErpMembership) -> ErpMembership:
        """Persist a new membership row and flush so its generated id is available."""
        self.db.add(membership)
        await self.db.flush()
        await self.db.refresh(membership)
        return membership
