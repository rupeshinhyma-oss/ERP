"""
Entity Synchronization Policy Repository (Phase 8A).

Data access layer providing queries for EntitySyncPolicy records, active policy lookup,
and conflict detection across ERP nodes.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.sync_policy.enums import SyncDirection, SyncPolicyStatus
from app.sync_policy.models import EntitySyncPolicy


class EntitySyncPolicyRepository:
    """Encapsulates database operations for EntitySyncPolicy."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, policy: EntitySyncPolicy) -> EntitySyncPolicy:
        """Add a new policy to the session and flush."""
        self.db.add(policy)
        await self.db.flush()
        return policy

    async def get_by_id(self, policy_id: uuid.UUID) -> EntitySyncPolicy | None:
        """Fetch a single policy by primary key."""
        stmt = (
            select(EntitySyncPolicy)
            .where(EntitySyncPolicy.id == policy_id)
            .options(
                selectinload(EntitySyncPolicy.source_erp),
                selectinload(EntitySyncPolicy.target_erp),
                selectinload(EntitySyncPolicy.authoritative_owner_erp),
            )
        )
        return await self.db.scalar(stmt)

    async def list_policies(
        self,
        *,
        source_erp_id: uuid.UUID | None = None,
        target_erp_id: uuid.UUID | None = None,
        entity_type: str | None = None,
        status: SyncPolicyStatus | None = None,
        enabled: bool | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Sequence[EntitySyncPolicy]:
        """List policies with optional filters and pagination."""
        stmt = (
            select(EntitySyncPolicy)
            .options(
                selectinload(EntitySyncPolicy.source_erp),
                selectinload(EntitySyncPolicy.target_erp),
                selectinload(EntitySyncPolicy.authoritative_owner_erp),
            )
            .order_by(EntitySyncPolicy.created_at.desc())
        )

        if source_erp_id is not None:
            stmt = stmt.where(EntitySyncPolicy.source_erp_id == source_erp_id)
        if target_erp_id is not None:
            stmt = stmt.where(EntitySyncPolicy.target_erp_id == target_erp_id)
        if entity_type is not None:
            stmt = stmt.where(EntitySyncPolicy.entity_type == entity_type.lower())
        if status is not None:
            stmt = stmt.where(EntitySyncPolicy.status == status)
        if enabled is not None:
            stmt = stmt.where(EntitySyncPolicy.enabled == enabled)

        stmt = stmt.limit(limit).offset(offset)
        result = await self.db.scalars(stmt)
        return result.all()

    async def count_policies(
        self,
        *,
        source_erp_id: uuid.UUID | None = None,
        target_erp_id: uuid.UUID | None = None,
        entity_type: str | None = None,
        status: SyncPolicyStatus | None = None,
        enabled: bool | None = None,
    ) -> int:
        """Count total matching policies for pagination."""
        stmt = select(func.count()).select_from(EntitySyncPolicy)
        if source_erp_id is not None:
            stmt = stmt.where(EntitySyncPolicy.source_erp_id == source_erp_id)
        if target_erp_id is not None:
            stmt = stmt.where(EntitySyncPolicy.target_erp_id == target_erp_id)
        if entity_type is not None:
            stmt = stmt.where(EntitySyncPolicy.entity_type == entity_type.lower())
        if status is not None:
            stmt = stmt.where(EntitySyncPolicy.status == status)
        if enabled is not None:
            stmt = stmt.where(EntitySyncPolicy.enabled == enabled)

        count = await self.db.scalar(stmt)
        return int(count or 0)

    async def find_active_policy(
        self,
        source_erp_id: uuid.UUID,
        target_erp_id: uuid.UUID,
        entity_type: str,
    ) -> EntitySyncPolicy | None:
        """
        Find an currently active and enabled policy for the specific
        (source_erp_id, target_erp_id, entity_type) tuple.
        """
        stmt = (
            select(EntitySyncPolicy)
            .where(
                EntitySyncPolicy.source_erp_id == source_erp_id,
                EntitySyncPolicy.target_erp_id == target_erp_id,
                EntitySyncPolicy.entity_type == entity_type.lower(),
                EntitySyncPolicy.enabled.is_(True),
                EntitySyncPolicy.status == SyncPolicyStatus.ACTIVE,
            )
            .options(
                selectinload(EntitySyncPolicy.source_erp),
                selectinload(EntitySyncPolicy.target_erp),
                selectinload(EntitySyncPolicy.authoritative_owner_erp),
            )
        )
        return await self.db.scalar(stmt)

    async def find_conflicting_active_policy(
        self,
        source_erp_id: uuid.UUID,
        target_erp_id: uuid.UUID,
        entity_type: str,
        exclude_id: uuid.UUID | None = None,
    ) -> EntitySyncPolicy | None:
        """
        Detect any contradictory active policy between these two nodes for the entity type:
        1. Exact duplicate forward active policy: (source, target, entity_type)
        2. Reverse active policy that is BIDIRECTIONAL: (target, source, entity_type)
        """
        norm_entity = entity_type.lower()
        stmt = select(EntitySyncPolicy).where(
            EntitySyncPolicy.entity_type == norm_entity,
            EntitySyncPolicy.enabled.is_(True),
            EntitySyncPolicy.status == SyncPolicyStatus.ACTIVE,
            or_(
                # Direct match
                (EntitySyncPolicy.source_erp_id == source_erp_id) & (EntitySyncPolicy.target_erp_id == target_erp_id),
                # Reverse match if bidirectional
                (EntitySyncPolicy.source_erp_id == target_erp_id)
                & (EntitySyncPolicy.target_erp_id == source_erp_id)
                & (EntitySyncPolicy.direction == SyncDirection.BIDIRECTIONAL),
            ),
        )
        if exclude_id is not None:
            stmt = stmt.where(EntitySyncPolicy.id != exclude_id)

        return await self.db.scalar(stmt)

    async def update(self, policy: EntitySyncPolicy) -> EntitySyncPolicy:
        """Flush changes to a policy record."""
        await self.db.flush()
        return policy

    async def delete(self, policy: EntitySyncPolicy) -> None:
        """Permanently delete a policy record from the database."""
        await self.db.delete(policy)
        await self.db.flush()
