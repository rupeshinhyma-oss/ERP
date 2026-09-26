"""
Provisioning Reconciliation Repository (Phase 8).

Handles durable database persistence and atomic leasing for background
provisioning recovery tasks across distributed workers.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Sequence

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.erp_memberships.models import ErpMembership, ErpMembershipStatus
from app.identity_linking.models import ProvisioningReconciliationTask, ProvisioningTaskStatus


class ProvisioningReconciliationRepository:
    """Data-access layer for durable provisioning reconciliation tasks and atomic leases."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, task_id: uuid.UUID) -> ProvisioningReconciliationTask | None:
        """Fetch a reconciliation task by primary key."""
        stmt = select(ProvisioningReconciliationTask).where(ProvisioningReconciliationTask.id == task_id)
        res = await self.db.execute(stmt)
        return res.scalar_one_or_none()

    async def get_by_membership_id(self, membership_id: uuid.UUID) -> ProvisioningReconciliationTask | None:
        """Fetch a reconciliation task by its associated ERP membership ID."""
        stmt = select(ProvisioningReconciliationTask).where(
            ProvisioningReconciliationTask.membership_id == membership_id
        )
        res = await self.db.execute(stmt)
        return res.scalar_one_or_none()

    async def find_eligible_tasks(
        self,
        now: datetime,
        limit: int = 25,
    ) -> Sequence[ProvisioningReconciliationTask]:
        """
        Find tasks eligible for reconciliation execution.

        Eligible tasks:
        1. PENDING_RETRY where next_retry_at <= now
        2. PROCESSING where lease_expires_at < now (expired lease from crashed worker)

        Ordered by next_retry_at ascending to ensure fair FIFO retry scheduling.
        """
        stmt = (
            select(ProvisioningReconciliationTask)
            .where(
                or_(
                    and_(
                        ProvisioningReconciliationTask.status == ProvisioningTaskStatus.PENDING_RETRY,
                        ProvisioningReconciliationTask.next_retry_at <= now,
                    ),
                    and_(
                        ProvisioningReconciliationTask.status == ProvisioningTaskStatus.PROCESSING,
                        ProvisioningReconciliationTask.lease_expires_at < now,
                    ),
                )
            )
            .order_by(ProvisioningReconciliationTask.next_retry_at.asc())
            .limit(limit)
        )
        res = await self.db.execute(stmt)
        return res.scalars().all()

    async def claim_task(
        self,
        task_id: uuid.UUID,
        worker_id: str,
        now: datetime,
        lease_duration_seconds: int = 60,
    ) -> bool:
        """
        Atomically claim a reconciliation task for a worker.

        Guarantees that two workers or processes cannot simultaneously claim the same task.
        Recovers expired leases atomically.
        """
        lease_expires_at = now + timedelta(seconds=lease_duration_seconds)
        stmt = (
            update(ProvisioningReconciliationTask)
            .where(
                ProvisioningReconciliationTask.id == task_id,
                or_(
                    ProvisioningReconciliationTask.status == ProvisioningTaskStatus.PENDING_RETRY,
                    and_(
                        ProvisioningReconciliationTask.status == ProvisioningTaskStatus.PROCESSING,
                        ProvisioningReconciliationTask.lease_expires_at < now,
                    ),
                ),
            )
            .values(
                status=ProvisioningTaskStatus.PROCESSING,
                claimed_by=worker_id,
                claimed_at=now,
                lease_expires_at=lease_expires_at,
                last_attempt_at=now,
                updated_at=now,
            )
            .execution_options(synchronize_session=False)
        )
        res = await self.db.execute(stmt)
        await self.db.commit()
        task = await self.get_by_id(task_id)
        if task is not None:
            await self.db.refresh(task)
        return (res.rowcount or 0) > 0

    async def release_claim(
        self,
        task_id: uuid.UUID,
        status: ProvisioningTaskStatus,
        *,
        next_retry_at: datetime | None = None,
        retry_count: int | None = None,
        last_error_type: str | None = None,
        last_error_message: str | None = None,
    ) -> None:
        """Release the claim and update task status and diagnostic metadata."""
        now = datetime.now(timezone.utc)
        task = await self.get_by_id(task_id)
        if task is not None:
            task.status = status
            task.claimed_by = None
            task.claimed_at = None
            task.lease_expires_at = None
            task.updated_at = now
            if next_retry_at is not None:
                task.next_retry_at = next_retry_at
            if retry_count is not None:
                task.retry_count = retry_count
            if last_error_type is not None:
                task.last_error_type = last_error_type
            if last_error_message is not None:
                task.last_error_message = last_error_message[:1000]
            await self.db.commit()
            await self.db.refresh(task)

    async def create_or_update_task(
        self,
        *,
        membership_id: uuid.UUID,
        global_user_id: uuid.UUID,
        erp_instance_id: uuid.UUID,
        status: ProvisioningTaskStatus = ProvisioningTaskStatus.PENDING_RETRY,
        retry_count: int = 0,
        max_retries: int = 10,
        next_retry_at: datetime | None = None,
        last_error_type: str | None = None,
        last_error_message: str | None = None,
    ) -> ProvisioningReconciliationTask:
        """Create or update a reconciliation task for a membership."""
        now = datetime.now(timezone.utc)
        effective_next_retry = next_retry_at or now

        existing = await self.get_by_membership_id(membership_id)
        if existing is not None:
            existing.status = status
            existing.retry_count = retry_count
            # Preserve customized max_retries if already configured on existing task
            if existing.max_retries is None:
                existing.max_retries = max_retries
            existing.next_retry_at = effective_next_retry
            existing.last_error_type = last_error_type
            existing.last_error_message = last_error_message[:1000] if last_error_message else None
            existing.claimed_by = None
            existing.claimed_at = None
            existing.lease_expires_at = None
            existing.updated_at = now
            await self.db.commit()
            await self.db.refresh(existing)
            return existing


        task = ProvisioningReconciliationTask(
            membership_id=membership_id,
            global_user_id=global_user_id,
            erp_instance_id=erp_instance_id,
            status=status,
            retry_count=retry_count,
            max_retries=max_retries,
            next_retry_at=effective_next_retry,
            last_attempt_at=now,
            last_error_type=last_error_type,
            last_error_message=last_error_message[:1000] if last_error_message else None,
        )
        self.db.add(task)
        await self.db.commit()
        await self.db.refresh(task)
        return task

    async def discover_untracked_pending_memberships(
        self,
        limit: int = 50,
    ) -> Sequence[ErpMembership]:
        """
        Discover PENDING memberships that do not yet have a reconciliation task.

        Ensures pre-existing pending memberships from process restarts or prior phases
        are safely ingested into the background reconciliation queue without manual intervention.
        """
        subquery = select(ProvisioningReconciliationTask.membership_id)
        stmt = (
            select(ErpMembership)
            .where(
                ErpMembership.status == ErpMembershipStatus.PENDING,
                ErpMembership.id.not_in(subquery),
            )
            .limit(limit)
        )
        res = await self.db.execute(stmt)
        return res.scalars().all()
