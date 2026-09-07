"""
ERP Registry Dependencies.

FastAPI dependency-injection wiring: how to build an `ErpRegistryService`
per request.

No authentication/authorization dependency exists here yet. Phase 2 Step
17 is explicit that ERP identity must never itself be treated as
authorization -- registry access control is a Phase 3+ concern once ERP
Membership and Global RBAC exist. Registering that gap here in code (not
just in docs) so nobody accidentally treats an open registry endpoint as
already secure.
"""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db_session
from app.erp_registry.repository import ErpInstanceRepository, ErpModuleRepository
from app.erp_registry.service import ErpRegistryService


def get_erp_registry_service(db: AsyncSession = Depends(get_db_session)) -> ErpRegistryService:
    """Build a request-scoped `ErpRegistryService` wired to its repositories."""
    return ErpRegistryService(
        instance_repository=ErpInstanceRepository(db),
        module_repository=ErpModuleRepository(db),
    )
