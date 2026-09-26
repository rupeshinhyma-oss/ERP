"""
Provisioning Reconciliation Service (Phase 8).

Orchestrates automatic, durable background reconciliation and recovery for ERP
memberships in PENDING, PENDING_RETRY, or retryable FAILED states.
"""

from __future__ import annotations

import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import (
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
)
from app.erp_memberships.models import ErpMembership, ErpMembershipStatus
from app.erp_memberships.repository import ErpMembershipRepository
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.global_users.repository import GlobalUserRepository
from app.identity_linking.exceptions import (
    ErpAuthError,
    ErpConflictError,
    ErpNotFoundError,
    ErpProvisioningError,
    IdentityConflictDetectedError,
)
from app.identity_linking.models import ProvisioningReconciliationTask, ProvisioningTaskStatus
from app.identity_linking.reconciliation_repository import ProvisioningReconciliationRepository
from app.identity_linking.service import IdentityLinkingService

logger = logging.getLogger(__name__)


def compute_backoff_delay(
    retry_count: int,
    base_delay: float | None = None,
    max_delay: float | None = None,
) -> float:
    """
    Calculate bounded exponential backoff with full jitter (Phase 5 & 8 strategy).

    Formula: min(max_delay, base_delay * (2 ** retry_count)) + random_jitter
    """
    base = base_delay if base_delay is not None else settings.PROVISIONING_BASE_BACKOFF_SECONDS
    maximum = max_delay if max_delay is not None else settings.PROVISIONING_MAX_BACKOFF_SECONDS
    exponential = min(maximum, base * (2 ** retry_count))
    jitter = random.uniform(0.1, 1.0)
    return exponential + jitter


class ProvisioningReconciliationService:
    """Domain service managing the lifecycle and execution of background provisioning recovery."""

    def __init__(
        self,
        *,
        db: AsyncSession,
        reconciliation_repository: ProvisioningReconciliationRepository,
        identity_linking_service: IdentityLinkingService,
        membership_repository: ErpMembershipRepository,
        global_user_repository: GlobalUserRepository,
        audit_service: GlobalAuditService,
    ) -> None:
        self.db = db
        self.repo = reconciliation_repository
        self.identity_linking_service = identity_linking_service
        self.membership_repo = membership_repository
        self.global_user_repo = global_user_repository
        self.audit = audit_service

    async def ingest_untracked_pending_memberships(self, limit: int = 50) -> int:
        """
        Scan for PENDING memberships lacking a reconciliation task and register them.

        Guarantees that pending work created prior to restart or from earlier phases
        is safely ingested into the durable recovery queue.
        """
        untracked = await self.repo.discover_untracked_pending_memberships(limit=limit)
        ingested = 0
        now = datetime.now(timezone.utc)

        for mem in untracked:
            meta = mem.metadata_json or {}
            sync_status = meta.get("sync_status")
            is_retryable = meta.get("is_retryable", True)

            # Do not register memberships that permanently failed or have unresolved conflicts
            if sync_status in ("CONFLICT", "FAILED") and not is_retryable:
                continue

            retry_count = meta.get("retry_count", 0)
            last_error_type = meta.get("error_type")
            last_error_message = meta.get("sync_error")

            await self.repo.create_or_update_task(
                membership_id=mem.id,
                global_user_id=mem.global_user_id,
                erp_instance_id=mem.erp_instance_id,
                status=ProvisioningTaskStatus.PENDING_RETRY,
                retry_count=retry_count,
                max_retries=settings.PROVISIONING_MAX_RETRIES,
                next_retry_at=now,
                last_error_type=last_error_type,
                last_error_message=last_error_message,
            )
            ingested += 1

        if ingested > 0:
            logger.info("Ingested %d untracked pending memberships into reconciliation queue.", ingested)
        return ingested

    async def reconcile_single_task(
        self,
        task_id: uuid.UUID,
        worker_id: str,
    ) -> dict[str, Any]:
        """
        Safely claim and execute recovery for a single reconciliation task.

        Enforces:
        1. Atomic distributed lease protection.
        2. Lifecycle checks: skip cancelled/revoked/suspended memberships or disabled GlobalUsers.
        3. Idempotent provisioning using the Phase 5 check-before-create strategy.
        4. Identity conflict isolation (stops retrying and records conflict).
        5. Bounded retries with exponential backoff and jitter.
        6. Comprehensive audit events without secret leaks.
        """
        now = datetime.now(timezone.utc)
        claimed = await self.repo.claim_task(
            task_id=task_id,
            worker_id=worker_id,
            now=now,
            lease_duration_seconds=settings.PROVISIONING_LEASE_DURATION_SECONDS,
        )
        if not claimed:
            logger.debug("Task %s could not be claimed by %s (concurrent claim or ineligible).", task_id, worker_id)
            return {"status": "skipped", "reason": "could_not_claim"}

        task = await self.repo.get_by_id(task_id)
        if task is None:
            return {"status": "skipped", "reason": "task_not_found"}

        logger.info(
            "Worker %s claimed reconciliation task %s (membership=%s, attempt %d/%d)",
            worker_id,
            task.id,
            task.membership_id,
            task.retry_count + 1,
            task.max_retries,
        )

        # ---------------------------------------------------------------------
        # Pre-check: Lifecycle and Eligibility Verification
        # ---------------------------------------------------------------------
        global_user = await self.global_user_repo.get_by_id(task.global_user_id)
        if global_user is None or global_user.status != GlobalUserStatus.ACTIVE:
            status_val = global_user.status.value if global_user else "MISSING"
            logger.warning(
                "Skipping task %s: GlobalUser %s status is %s (not ACTIVE). Cancelling task.",
                task.id,
                task.global_user_id,
                status_val,
            )
            await self.repo.release_claim(
                task_id=task.id,
                status=ProvisioningTaskStatus.CANCELLED,
                last_error_type="GLOBAL_USER_INACTIVE",
                last_error_message=f"GlobalUser status is {status_val}",
            )
            return {"status": "cancelled", "reason": f"global_user_{status_val.lower()}"}

        membership = await self.membership_repo.get_by_id(task.membership_id)
        if membership is None:
            logger.warning("Skipping task %s: Membership %s no longer exists.", task.id, task.membership_id)
            await self.repo.release_claim(
                task_id=task.id,
                status=ProvisioningTaskStatus.CANCELLED,
                last_error_type="MEMBERSHIP_NOT_FOUND",
                last_error_message="ErpMembership deleted",
            )
            return {"status": "cancelled", "reason": "membership_not_found"}

        if membership.status in (ErpMembershipStatus.REVOKED, ErpMembershipStatus.SUSPENDED):
            logger.warning(
                "Skipping task %s: Membership %s is %s. Cancelling task.",
                task.id,
                task.membership_id,
                membership.status.value,
            )
            await self.repo.release_claim(
                task_id=task.id,
                status=ProvisioningTaskStatus.CANCELLED,
                last_error_type=f"MEMBERSHIP_{membership.status.value}",
                last_error_message=f"Membership is {membership.status.value}",
            )
            return {"status": "cancelled", "reason": f"membership_{membership.status.value.lower()}"}

        if membership.status == ErpMembershipStatus.ACTIVE:
            logger.info("Task %s: Membership %s is already ACTIVE.", task.id, task.membership_id)
            await self.repo.release_claim(
                task_id=task.id,
                status=ProvisioningTaskStatus.SUCCEEDED,
            )
            return {"status": "succeeded", "reason": "already_active"}

        # ---------------------------------------------------------------------
        # Execution: Invoke Provisioning Recovery Flow
        # ---------------------------------------------------------------------
        notes = (membership.metadata_json or {}).get("notes")
        target_org_id_str = (membership.metadata_json or {}).get("target_organization_id")
        target_org_id = uuid.UUID(target_org_id_str) if target_org_id_str else None

        try:
            # Execute one provisioning attempt; background loop handles outer retries
            updated_membership = await self.identity_linking_service.provision_global_user_to_erp(
                global_user_id=task.global_user_id,
                erp_instance_id=task.erp_instance_id,
                target_organization_id=target_org_id,
                notes=notes,
                actor=None,  # Recorded as SYSTEM actor by IdentityLinkingService
                max_retries=1,
            )

            # Check if provisioning reached ACTIVE state
            if updated_membership.status == ErpMembershipStatus.ACTIVE:
                logger.info(
                    "Reconciliation succeeded for task %s (membership=%s, erp=%s).",
                    task.id,
                    task.membership_id,
                    task.erp_instance_id,
                )
                await self.repo.release_claim(
                    task_id=task.id,
                    status=ProvisioningTaskStatus.SUCCEEDED,
                )
                return {"status": "succeeded", "task_id": str(task.id)}
            else:
                # Still pending retry
                meta = updated_membership.metadata_json or {}
                error_type = meta.get("error_type", "TRANSIENT_FAILURE")
                error_msg = meta.get("sync_error", "Spoke provisioning still pending")
                retry_cnt = meta.get("retry_count")
                return await self._handle_transient_failure(task, error_type, error_msg, retry_count=retry_cnt)

        except (IdentityConflictDetectedError, ErpConflictError, ConflictException) as exc:
            logger.error(
                "Task %s encountered identity conflict: %s. Halting automatic retries.",
                task.id,
                str(exc),
            )
            await self.repo.release_claim(
                task_id=task.id,
                status=ProvisioningTaskStatus.FAILED,
                last_error_type="IDENTITY_CONFLICT",
                last_error_message=str(exc),
            )
            return {"status": "conflict", "error": str(exc)}

        except (ErpAuthError, ErpNotFoundError, BadRequestException, ForbiddenException, NotFoundException) as exc:
            error_type = getattr(exc, "error_type", None)
            if not error_type:
                if isinstance(exc, (ErpAuthError, ForbiddenException)):
                    error_type = "AUTH_FAILURE"
                elif isinstance(exc, (ErpNotFoundError, NotFoundException)):
                    error_type = "NOT_FOUND"
                else:
                    error_type = "PERMANENT_ERROR"
            logger.error(
                "Task %s encountered permanent failure (%s): %s. Halting automatic retries.",
                task.id,
                error_type,
                str(exc),
            )
            await self.repo.release_claim(
                task_id=task.id,
                status=ProvisioningTaskStatus.FAILED,
                last_error_type=error_type,
                last_error_message=str(exc),
            )
            return {"status": "failed_permanent", "error": str(exc)}

        except ErpProvisioningError as exc:
            if exc.is_transient:
                return await self._handle_transient_failure(task, exc.error_type, exc.message)
            else:
                logger.error(
                    "Task %s permanent provisioning error (%s): %s.",
                    task.id,
                    exc.error_type,
                    exc.message,
                )
                await self.repo.release_claim(
                    task_id=task.id,
                    status=ProvisioningTaskStatus.FAILED,
                    last_error_type=exc.error_type,
                    last_error_message=exc.message,
                )
                return {"status": "failed_permanent", "error": exc.message}

        except Exception as exc:
            logger.exception("Unexpected exception while reconciling task %s: %s", task.id, exc)
            return await self._handle_transient_failure(task, "UNEXPECTED_ERROR", str(exc))

    async def _handle_transient_failure(
        self,
        task: ProvisioningReconciliationTask,
        error_type: str,
        error_message: str,
        retry_count: int | None = None,
    ) -> dict[str, Any]:
        """Process a transient failure by scheduling the next exponential backoff retry or failing."""
        new_retry_count = retry_count if retry_count is not None else (task.retry_count + 1)


        if new_retry_count >= task.max_retries:
            logger.warning(
                "Task %s exceeded max retries (%d). Marking terminal failure.",
                task.id,
                task.max_retries,
            )
            await self.repo.release_claim(
                task_id=task.id,
                status=ProvisioningTaskStatus.FAILED,
                retry_count=new_retry_count,
                last_error_type="MAX_RETRIES_EXCEEDED",
                last_error_message=f"Exceeded max retries ({task.max_retries}): {error_message}",
            )
            await self.audit.record(
                event_type=AuditEventType.PROVISIONING_FAILED,
                actor_type=AuditActorType.SYSTEM,
                actor_id=None,
                actor_label="Background Reconciler",
                target_type="erp_membership",
                target_id=task.membership_id,
                details={
                    "error_type": "MAX_RETRIES_EXCEEDED",
                    "retries": new_retry_count,
                    "last_error": error_message,
                },
            )
            return {"status": "max_retries_exceeded", "retry_count": new_retry_count}

        delay = compute_backoff_delay(new_retry_count)
        next_retry = datetime.now(timezone.utc) + timedelta(seconds=delay)

        logger.info(
            "Task %s transient failure (%s). Rescheduling retry #%d in %.1fs (at %s).",
            task.id,
            error_type,
            new_retry_count,
            delay,
            next_retry.isoformat(),
        )

        await self.repo.release_claim(
            task_id=task.id,
            status=ProvisioningTaskStatus.PENDING_RETRY,
            next_retry_at=next_retry,
            retry_count=new_retry_count,
            last_error_type=error_type,
            last_error_message=error_message,
        )

        await self.audit.record(
            event_type=AuditEventType.PROVISIONING_RETRY_SCHEDULED,
            actor_type=AuditActorType.SYSTEM,
            actor_id=None,
            actor_label="Background Reconciler",
            target_type="erp_membership",
            target_id=task.membership_id,
            details={
                "error_type": error_type,
                "retry_count": new_retry_count,
                "next_retry_at": next_retry.isoformat(),
            },
        )
        return {
            "status": "rescheduled",
            "retry_count": new_retry_count,
            "next_retry_at": next_retry.isoformat(),
        }

    async def run_reconciliation_batch(
        self,
        worker_id: str,
        limit: int | None = None,
    ) -> dict[str, Any]:
        """
        Execute one reconciliation sweep over eligible tasks.

        Discovers untracked work, claims tasks atomically, and executes recovery.
        """
        effective_limit = limit or settings.PROVISIONING_RECONCILIATION_BATCH_SIZE

        # Ingest any untracked pending memberships
        await self.ingest_untracked_pending_memberships(limit=effective_limit)

        now = datetime.now(timezone.utc)
        eligible_tasks = await self.repo.find_eligible_tasks(now=now, limit=effective_limit)

        summary = {
            "eligible": len(eligible_tasks),
            "succeeded": 0,
            "rescheduled": 0,
            "failed_permanent": 0,
            "max_retries_exceeded": 0,
            "conflict": 0,
            "cancelled": 0,
            "skipped": 0,
        }

        if not eligible_tasks:
            return summary

        logger.info("Worker %s executing reconciliation sweep over %d eligible tasks.", worker_id, len(eligible_tasks))

        for task in eligible_tasks:
            result = await self.reconcile_single_task(task.id, worker_id)
            res_status = result.get("status", "unknown")
            if res_status in summary:
                summary[res_status] += 1
            else:
                summary["skipped"] += 1

        logger.info("Reconciliation sweep completed: %s", summary)
        return summary
