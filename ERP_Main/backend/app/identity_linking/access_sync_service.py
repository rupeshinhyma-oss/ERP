"""
Access-sync recovery: make ERP_Main's suspend / restore / revoke decisions stick.

Problem this solves
-------------------
ERP_Main marks a membership SUSPENDED/REVOKED and then tells the target ERP to stop
letting that account sign in.  If the ERP is asleep or unreachable the call used to be
dropped (only an audit note), leaving the local account fully active.  Now the failure
is stored as a durable `AccessSyncTask` and retried with bounded exponential backoff
until the ERP confirms -- surviving restarts, with leases so two workers never process
the same task.

Safety rules
------------
* The state pushed to the ERP is recomputed from the CURRENT membership + global user
  status on every attempt.  A stale "allow" can never re-enable someone who has since
  been suspended, disabled or revoked.
* A successful call is the only thing that clears a task.  Exhausted retries end in
  FAILED with an audit event, never in a silent success.
* Error text is truncated and never contains credentials.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.erp_memberships.models import ErpMembership, ErpMembershipStatus
from app.erp_registry.models import ErpInstance
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.identity_linking.models import AccessSyncStatus, AccessSyncTask
from app.identity_linking.reconciliation_service import compute_backoff_delay

logger = logging.getLogger(__name__)

_MAX_ERROR_LEN = 500


def _utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


class AccessSyncService:
    """Durable retry of local-access synchronization to target ERPs."""

    def __init__(self, db: AsyncSession, audit: GlobalAuditService, adapter_registry) -> None:
        self.db = db
        self.audit = audit
        self.adapter_registry = adapter_registry

    # ------------------------------------------------------------------ scheduling
    async def schedule(
        self,
        membership: ErpMembership,
        *,
        requested_allow_login: bool,
        reason: str | None,
        error: str,
    ) -> AccessSyncTask:
        """Record (or refresh) a pending task for a membership whose ERP could not be told."""
        now = datetime.now(timezone.utc)
        task = await self.db.scalar(select(AccessSyncTask).where(AccessSyncTask.membership_id == membership.id))
        if task is None:
            task = AccessSyncTask(
                membership_id=membership.id,
                erp_instance_id=membership.erp_instance_id,
                local_user_id=membership.local_user_id,
                requested_allow_login=requested_allow_login,
                reason=(reason or None) and reason[:_MAX_ERROR_LEN],
                status=AccessSyncStatus.PENDING_RETRY,
                retry_count=0,
                max_retries=settings.PROVISIONING_MAX_RETRIES,
                next_retry_at=now + timedelta(seconds=compute_backoff_delay(0)),
                last_error=error[:_MAX_ERROR_LEN],
            )
            self.db.add(task)
        else:
            # Latest decision wins; start a fresh retry schedule.
            task.local_user_id = membership.local_user_id
            task.requested_allow_login = requested_allow_login
            task.reason = (reason or None) and reason[:_MAX_ERROR_LEN]
            task.status = AccessSyncStatus.PENDING_RETRY
            task.retry_count = 0
            task.next_retry_at = now + timedelta(seconds=compute_backoff_delay(0))
            task.lease_expires_at = None
            task.claimed_by = None
            task.last_error = error[:_MAX_ERROR_LEN]
        await self.db.flush()
        await self._audit(
            AuditEventType.ACCESS_SYNC_RETRY_SCHEDULED, membership.id, {"error": error[:200], "retry_count": 0}
        )
        return task

    async def clear(self, membership_id: uuid.UUID) -> None:
        """The ERP just confirmed the current state directly: any stale pending task is obsolete."""
        task = await self.db.scalar(select(AccessSyncTask).where(AccessSyncTask.membership_id == membership_id))
        if task is not None and task.status != AccessSyncStatus.SUCCEEDED:
            task.status = AccessSyncStatus.SUCCEEDED
            task.lease_expires_at = None
            task.claimed_by = None
            task.last_error = None
            await self.db.flush()

    # ------------------------------------------------------------------ recovery
    @staticmethod
    def effective_allow_login(membership: ErpMembership, global_user: GlobalUser | None) -> bool:
        """Access is allowed only if BOTH the membership and the central user are ACTIVE right now."""
        return (
            membership.status == ErpMembershipStatus.ACTIVE
            and global_user is not None
            and global_user.status == GlobalUserStatus.ACTIVE
        )

    async def _claim(self, task_id: uuid.UUID, worker_id: str, now: datetime) -> bool:
        """Atomically take the lease; False if another worker got there first or it is not due."""
        lease = now + timedelta(seconds=settings.PROVISIONING_LEASE_DURATION_SECONDS)
        result = await self.db.execute(
            update(AccessSyncTask)
            .where(
                AccessSyncTask.id == task_id,
                or_(
                    and_(AccessSyncTask.status == AccessSyncStatus.PENDING_RETRY, AccessSyncTask.next_retry_at <= now),
                    and_(AccessSyncTask.status == AccessSyncStatus.PROCESSING, AccessSyncTask.lease_expires_at < now),
                ),
            )
            .values(status=AccessSyncStatus.PROCESSING, claimed_by=worker_id, lease_expires_at=lease)
        )
        await self.db.commit()
        return (result.rowcount or 0) == 1

    async def process_task(self, task_id: uuid.UUID, worker_id: str) -> str:
        """Run one attempt. Returns 'recovered', 'retry', 'failed' or 'skipped'."""
        now = datetime.now(timezone.utc)
        if not await self._claim(task_id, worker_id, now):
            return "skipped"
        task = await self.db.get(AccessSyncTask, task_id)
        if task is None:
            return "skipped"
        await self.db.refresh(task)

        membership = await self.db.get(ErpMembership, task.membership_id)
        erp = await self.db.get(ErpInstance, task.erp_instance_id)
        if membership is None or erp is None:
            task.status = AccessSyncStatus.SUCCEEDED  # nothing left to synchronize
            task.last_error = "membership_or_erp_removed"
            await self.db.commit()
            return "recovered"

        global_user = await self.db.get(GlobalUser, membership.global_user_id)
        allow = self.effective_allow_login(membership, global_user)  # recomputed, never replayed
        reason = task.reason or ("central access restored" if allow else "central access removed")

        adapter = self.adapter_registry.get_adapter(erp)
        try:
            result = await adapter.set_local_user_access(erp, task.local_user_id, allow_login=allow, reason=reason)
            error = None if result is not None else "ERP did not confirm the access change (unreachable or rejected)."
        except Exception as exc:  # adapters soft-fail, but never let one bad task stop the sweep
            result, error = None, f"{type(exc).__name__}"

        if result is not None:
            if membership.status == ErpMembershipStatus.REVOKED:
                try:
                    await adapter.deprovision_local_user(erp, task.local_user_id, reason=reason)
                except Exception:
                    pass
            recovered_after = task.retry_count
            task.status = AccessSyncStatus.SUCCEEDED
            task.lease_expires_at = None
            task.claimed_by = None
            task.last_error = None
            await self._audit(
                AuditEventType.ACCESS_SYNC_RECOVERED,
                membership.id,
                {"allow_login": allow, "attempts": recovered_after + 1},
            )
            await self.db.commit()
            return "recovered"

        task.retry_count += 1
        task.last_error = (error or "unknown")[:_MAX_ERROR_LEN]
        task.lease_expires_at = None
        task.claimed_by = None
        if task.retry_count >= task.max_retries:
            task.status = AccessSyncStatus.FAILED
            await self._audit(
                AuditEventType.ACCESS_SYNC_FAILED,
                membership.id,
                {"attempts": task.retry_count, "error": task.last_error[:200], "needs_admin_attention": True},
            )
            await self.db.commit()
            logger.error("Access sync for membership %s exhausted retries; admin attention required.", membership.id)
            return "failed"
        task.status = AccessSyncStatus.PENDING_RETRY
        task.next_retry_at = datetime.now(timezone.utc) + timedelta(seconds=compute_backoff_delay(task.retry_count))
        await self.db.commit()
        return "retry"

    async def run_batch(self, worker_id: str, limit: int | None = None) -> int:
        """Process every currently-due task (bounded). Returns how many were attempted."""
        now = datetime.now(timezone.utc)
        batch = limit or settings.PROVISIONING_RECONCILIATION_BATCH_SIZE
        ids = (
            await self.db.scalars(
                select(AccessSyncTask.id)
                .where(
                    or_(
                        and_(AccessSyncTask.status == AccessSyncStatus.PENDING_RETRY, AccessSyncTask.next_retry_at <= now),
                        and_(AccessSyncTask.status == AccessSyncStatus.PROCESSING, AccessSyncTask.lease_expires_at < now),
                    )
                )
                .order_by(AccessSyncTask.next_retry_at)
                .limit(batch)
            )
        ).all()
        attempted = 0
        for task_id in ids:
            try:
                outcome = await self.process_task(task_id, worker_id)
                if outcome != "skipped":
                    attempted += 1
            except Exception:
                logger.exception("Access-sync task %s crashed; it will be retried after its lease expires.", task_id)
                await self.db.rollback()
        return attempted

    async def _audit(self, event: AuditEventType, membership_id: uuid.UUID, details: dict) -> None:
        try:
            await self.audit.record(
                event_type=event,
                actor_type=AuditActorType.SYSTEM,
                actor_id=None,
                actor_label="access-sync",
                target_type="erp_membership",
                target_id=membership_id,
                details=details,
            )
        except Exception:  # auditing must never break recovery
            logger.warning("Could not record %s audit event for membership %s.", event.value, membership_id)
