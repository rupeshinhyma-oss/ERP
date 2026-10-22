"""
CRM Pipeline Dependencies.

Provides FastAPI dependency factories for CRM services.
"""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db_session
from app.crm.assignment_service import CrmAssignmentEngineService
from app.crm.import_service import CrmImportService
from app.crm.lead_service import CrmLeadService
from app.crm.service import CrmPipelineService, CrmSalespersonDistributionService


def get_crm_pipeline_service(
    session: AsyncSession = Depends(get_db_session),
) -> CrmPipelineService:
    """Dependency provider for CrmPipelineService."""
    return CrmPipelineService(session=session)


def get_crm_salesperson_distribution_service(
    session: AsyncSession = Depends(get_db_session),
) -> CrmSalespersonDistributionService:
    """Dependency provider for CrmSalespersonDistributionService."""
    return CrmSalespersonDistributionService(session=session)


def get_crm_import_service(
    session: AsyncSession = Depends(get_db_session),
) -> CrmImportService:
    """Dependency provider for CrmImportService."""
    return CrmImportService(session=session)


def get_crm_assignment_service(
    session: AsyncSession = Depends(get_db_session),
) -> CrmAssignmentEngineService:
    """Dependency provider for CrmAssignmentEngineService."""
    return CrmAssignmentEngineService(session=session)


def get_crm_lead_service(
    session: AsyncSession = Depends(get_db_session),
) -> CrmLeadService:
    """Dependency provider for CrmLeadService."""
    return CrmLeadService(session=session)

