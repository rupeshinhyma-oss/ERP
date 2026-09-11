"""Integration Control-Plane Dependencies (Phase 6)."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db_session
from app.erp_registry.repository import ErpInstanceRepository, ErpModuleRepository
from app.global_audit.dependencies import get_global_audit_service
from app.global_audit.service import GlobalAuditService
from app.integration.repository import (
    IntegrationDeadLetterRepository,
    IntegrationEntityMappingRepository,
    IntegrationInboxRepository,
    IntegrationSubscriptionRepository,
)
from app.integration.service import IntegrationService


def get_integration_service(
    db: AsyncSession = Depends(get_db_session),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> IntegrationService:
    """Build a request-scoped `IntegrationService`."""
    return IntegrationService(
        subscription_repository=IntegrationSubscriptionRepository(db),
        inbox_repository=IntegrationInboxRepository(db),
        mapping_repository=IntegrationEntityMappingRepository(db),
        dead_letter_repository=IntegrationDeadLetterRepository(db),
        erp_instance_repository=ErpInstanceRepository(db),
        erp_module_repository=ErpModuleRepository(db),
        audit=audit,
    )
