"""
Entity Synchronization Policy Dependencies (Phase 8A).
"""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db_session
from app.erp_registry.repository import ErpInstanceRepository
from app.global_audit.dependencies import get_global_audit_service
from app.global_audit.service import GlobalAuditService
from app.sync_policy.repository import EntitySyncPolicyRepository
from app.sync_policy.service import EntitySyncPolicyService


def get_sync_policy_service(
    db: AsyncSession = Depends(get_db_session),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> EntitySyncPolicyService:
    """Build a request-scoped `EntitySyncPolicyService`."""
    return EntitySyncPolicyService(
        repository=EntitySyncPolicyRepository(db),
        erp_instance_repository=ErpInstanceRepository(db),
        audit=audit,
    )
