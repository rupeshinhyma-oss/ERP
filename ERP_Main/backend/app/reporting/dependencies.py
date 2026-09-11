"""Reporting Dependencies (Phase 7)."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db_session
from app.erp_memberships.repository import ErpMembershipRepository
from app.erp_registry.repository import ErpInstanceRepository
from app.global_audit.dependencies import get_global_audit_service
from app.global_audit.service import GlobalAuditService
from app.global_users.repository import GlobalUserRepository
from app.integration.repository import IntegrationDeadLetterRepository, IntegrationInboxRepository
from app.platform_authz.dependencies import get_platform_authz_service
from app.platform_authz.service import PlatformAuthzService
from app.reporting.repository import (
    GlobalBuyerProjectionRepository,
    GlobalInquiryProjectionRepository,
    GlobalProductProjectionRepository,
    GlobalSupplierProjectionRepository,
    ProjectionCheckpointRepository,
    ReportExportJobRepository,
)
from app.reporting.service import (
    DashboardService,
    ExportCleanupService,
    ExportService,
    HealthService,
    MetricsService,
    ProjectionService,
    ReconciliationService,
    ReportEngine,
    SearchService,
)


def get_projection_service(db: AsyncSession = Depends(get_db_session)) -> ProjectionService:
    """Build a request-scoped `ProjectionService`."""
    return ProjectionService(
        inbox_repository=IntegrationInboxRepository(db),
        buyer_projection_repository=GlobalBuyerProjectionRepository(db),
        supplier_projection_repository=GlobalSupplierProjectionRepository(db),
        product_projection_repository=GlobalProductProjectionRepository(db),
        inquiry_projection_repository=GlobalInquiryProjectionRepository(db),
        checkpoint_repository=ProjectionCheckpointRepository(db),
    )


def get_search_service(
    db: AsyncSession = Depends(get_db_session),
    authz_service: PlatformAuthzService = Depends(get_platform_authz_service),
) -> SearchService:
    """Build a request-scoped `SearchService`."""
    return SearchService(
        buyer_projection_repository=GlobalBuyerProjectionRepository(db),
        supplier_projection_repository=GlobalSupplierProjectionRepository(db),
        product_projection_repository=GlobalProductProjectionRepository(db),
        inquiry_projection_repository=GlobalInquiryProjectionRepository(db),
        membership_repository=ErpMembershipRepository(db),
        authz_service=authz_service,
    )


def get_dashboard_service(db: AsyncSession = Depends(get_db_session)) -> DashboardService:
    """Build a request-scoped `DashboardService`."""
    return DashboardService(
        erp_instance_repository=ErpInstanceRepository(db),
        global_user_repository=GlobalUserRepository(db),
        membership_repository=ErpMembershipRepository(db),
        inbox_repository=IntegrationInboxRepository(db),
        dead_letter_repository=IntegrationDeadLetterRepository(db),
        buyer_projection_repository=GlobalBuyerProjectionRepository(db),
        supplier_projection_repository=GlobalSupplierProjectionRepository(db),
        product_projection_repository=GlobalProductProjectionRepository(db),
        inquiry_projection_repository=GlobalInquiryProjectionRepository(db),
        checkpoint_repository=ProjectionCheckpointRepository(db),
    )


def get_report_engine(db: AsyncSession = Depends(get_db_session)) -> ReportEngine:
    """Build a request-scoped `ReportEngine`."""
    return ReportEngine(
        buyer_repo=GlobalBuyerProjectionRepository(db),
        supplier_repo=GlobalSupplierProjectionRepository(db),
        product_repo=GlobalProductProjectionRepository(db),
        inquiry_repo=GlobalInquiryProjectionRepository(db),
        erp_repo=ErpInstanceRepository(db),
    )


def get_reconciliation_service(
    db: AsyncSession = Depends(get_db_session),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> ReconciliationService:
    """Build a request-scoped `ReconciliationService`."""
    return ReconciliationService(
        erp_instance_repository=ErpInstanceRepository(db),
        buyer_projection_repository=GlobalBuyerProjectionRepository(db),
        supplier_projection_repository=GlobalSupplierProjectionRepository(db),
        product_projection_repository=GlobalProductProjectionRepository(db),
        inquiry_projection_repository=GlobalInquiryProjectionRepository(db),
        audit=audit,
    )


def get_export_service(
    db: AsyncSession = Depends(get_db_session),
    authz_service: PlatformAuthzService = Depends(get_platform_authz_service),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> ExportService:
    """Build a request-scoped `ExportService`."""
    search_service = get_search_service(db=db, authz_service=authz_service)
    report_engine = get_report_engine(db=db)
    return ExportService(
        job_repository=ReportExportJobRepository(db),
        report_engine=report_engine,
        search_service=search_service,
        erp_instance_repository=ErpInstanceRepository(db),
        audit=audit,
    )


def get_metrics_service(db: AsyncSession = Depends(get_db_session)) -> MetricsService:
    """Build a request-scoped `MetricsService`."""
    return MetricsService(
        db=db,
        erp_repo=ErpInstanceRepository(db),
        user_repo=GlobalUserRepository(db),
        membership_repo=ErpMembershipRepository(db),
        inbox_repo=IntegrationInboxRepository(db),
        dead_letter_repo=IntegrationDeadLetterRepository(db),
        buyer_repo=GlobalBuyerProjectionRepository(db),
        supplier_repo=GlobalSupplierProjectionRepository(db),
        product_repo=GlobalProductProjectionRepository(db),
        inquiry_repo=GlobalInquiryProjectionRepository(db),
    )


def get_health_service(db: AsyncSession = Depends(get_db_session)) -> HealthService:
    """Build a request-scoped `HealthService`."""
    return HealthService(
        db=db,
        erp_repo=ErpInstanceRepository(db),
    )


def get_export_cleanup_service(db: AsyncSession = Depends(get_db_session)) -> ExportCleanupService:
    """Build a request-scoped `ExportCleanupService`."""
    return ExportCleanupService(
        job_repo=ReportExportJobRepository(db),
    )
