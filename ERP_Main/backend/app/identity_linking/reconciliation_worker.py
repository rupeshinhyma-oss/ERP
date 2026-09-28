"""
Provisioning Reconciliation Background Worker (Phase 8).

Runs an autonomous, resilient background loop in ERP_Main to automatically
discover and recover pending/retryable ERP provisioning operations.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.database.engine import get_sessionmaker
from app.erp_memberships.repository import ErpMembershipRepository
from app.erp_registry.repository import ErpInstanceRepository
from app.global_audit.repository import GlobalAuditRepository
from app.global_audit.service import GlobalAuditService
from app.global_users.repository import GlobalUserRepository
from app.identity_linking.reconciliation_repository import ProvisioningReconciliationRepository
from app.identity_linking.reconciliation_service import ProvisioningReconciliationService
from app.identity_linking.repository import IdentityConflictRepository
from app.identity_linking.service import IdentityLinkingService

logger = logging.getLogger(__name__)


def create_reconciliation_service(db: AsyncSession) -> ProvisioningReconciliationService:
    """Factory creating a fully wired ProvisioningReconciliationService for a session."""
    global_user_repo = GlobalUserRepository(db)
    membership_repo = ErpMembershipRepository(db)
    erp_repo = ErpInstanceRepository(db)
    conflict_repo = IdentityConflictRepository(db)
    audit_repo = GlobalAuditRepository(db)
    audit_service = GlobalAuditService(audit_repo)

    id_linking_service = IdentityLinkingService(
        db=db,
        global_user_repository=global_user_repo,
        membership_repository=membership_repo,
        erp_instance_repository=erp_repo,
        conflict_repository=conflict_repo,
        audit_service=audit_service,
    )
    recon_repo = ProvisioningReconciliationRepository(db)

    return ProvisioningReconciliationService(
        db=db,
        reconciliation_repository=recon_repo,
        identity_linking_service=id_linking_service,
        membership_repository=membership_repo,
        global_user_repository=global_user_repo,
        audit_service=audit_service,
    )


class ProvisioningReconciliationWorker:
    """
    Autonomous background reconciler worker.

    Periodically checks the database for eligible recovery tasks, claims them atomically,
    and runs the provisioning recovery flow.
    """

    def __init__(self) -> None:
        self.worker_id = f"worker:{uuid.uuid4().hex[:8]}:{os.getpid()}"
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._trigger_event = asyncio.Event()

    @property
    def is_running(self) -> bool:
        """Return True if the background loop is active."""
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        """Launch the background reconciliation loop as an asyncio Task."""
        if self.is_running:
            logger.warning("ProvisioningReconciliationWorker is already running.")
            return

        self._stop_event.clear()
        self._trigger_event.clear()
        self._task = asyncio.create_task(self._run(), name=f"provisioning-reconciler-{self.worker_id}")
        logger.info("ProvisioningReconciliationWorker started with ID %s", self.worker_id)

    async def stop(self, timeout: float = 10.0) -> None:
        """Signal the worker to stop and wait for the current cycle to complete."""
        if not self.is_running:
            return

        logger.info("Stopping ProvisioningReconciliationWorker %s (graceful)...", self.worker_id)
        self._stop_event.set()
        self._trigger_event.set()

        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=timeout)
            except asyncio.TimeoutError:
                logger.warning("Worker %s did not terminate in %.1fs; cancelling.", self.worker_id, timeout)
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass
            except Exception as exc:
                logger.error("Error during worker shutdown: %s", exc)

        logger.info("ProvisioningReconciliationWorker %s stopped.", self.worker_id)

    def trigger(self) -> None:
        """Trigger an immediate reconciliation sweep without waiting for the sleep interval."""
        self._trigger_event.set()

    async def _run(self) -> None:
        """Main background loop."""
        session_factory = get_sessionmaker()

        while not self._stop_event.is_set():
            try:
                async with session_factory() as session:
                    service = create_reconciliation_service(session)
                    await service.run_reconciliation_batch(worker_id=self.worker_id)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.exception("Error in ProvisioningReconciliationWorker sweep: %s", exc)

            # Sleep until interval expires or an external trigger/stop event occurs
            interval = settings.PROVISIONING_RECONCILIATION_INTERVAL_SECONDS
            self._trigger_event.clear()

            try:
                # Wait for stop, trigger, or timeout
                done, _ = await asyncio.wait(
                    [
                        asyncio.create_task(self._stop_event.wait()),
                        asyncio.create_task(self._trigger_event.wait()),
                    ],
                    timeout=interval,
                    return_when=asyncio.FIRST_COMPLETED,
                )
            except asyncio.CancelledError:
                break


_global_worker: ProvisioningReconciliationWorker | None = None


def get_reconciliation_worker() -> ProvisioningReconciliationWorker:
    """Process-wide singleton instance of ProvisioningReconciliationWorker."""
    global _global_worker
    if _global_worker is None:
        _global_worker = ProvisioningReconciliationWorker()
    return _global_worker


def reset_reconciliation_worker() -> None:
    """Reset worker for test isolation."""
    global _global_worker
    _global_worker = None
