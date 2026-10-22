"""
CRM Salesperson Distribution Routes.

Dedicated endpoints under /crm/distribution for configuring salesperson lead assignment
eligibility, territories, priorities, and capacity. Enforces RBAC permissions:
- crm.distribution.view / crm.distribution.manage for read operations
- crm.distribution.manage for mutations
- Sales manager departmental scoping enforced at service layer.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, status

from app.audit.constants import AuditAction
from app.audit.dependencies import get_audit_service
from app.audit.service import AuditService
from app.auth.service import CurrentUser
from app.core.logging import get_logger
from app.core.responses import build_success_response
from app.crm.dependencies import get_crm_salesperson_distribution_service
from app.crm.schemas import (
    SalespersonBulkEligibilityUpdate,
    SalespersonDistributionItem,
    SalespersonDistributionUpdate,
)
from app.crm.service import CrmSalespersonDistributionService
from app.rbac.dependencies import require_any_permission, require_permission

router = APIRouter(prefix="/crm/distribution", tags=["CRM Salesperson Distribution"])
logger = get_logger(__name__)


async def _record_distribution_action(
    *,
    audit_service: AuditService,
    request: Request,
    action: AuditAction,
    actor: CurrentUser,
    entity_id: uuid.UUID | str,
    description: str,
    new_values: dict | None = None,
) -> None:
    """Record an audit log entry for salesperson distribution changes."""
    await audit_service.record(
        action=action,
        module="crm",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="CrmSalespersonConfig",
        entity_id=str(entity_id),
        new_values=new_values,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, "request_id", "-"),
        http_method=request.method,
        endpoint=request.url.path,
        response_status=status.HTTP_200_OK,
        description=description,
    )
    request.state.audit_logged = True


@router.get("/salespeople", summary="List salespeople for distribution setup")
async def list_salespeople(
    request: Request,
    search: str | None = Query(default=None, description="Search by name, username, employee code, or email"),
    department: str | None = Query(default=None, description="Filter by department name"),
    is_eligible: bool | None = Query(default=None, description="Filter by assignment eligibility"),
    state_id: uuid.UUID | None = Query(default=None, description="Filter by assigned territory/state"),
    service: CrmSalespersonDistributionService = Depends(get_crm_salesperson_distribution_service),
    current_user: CurrentUser = Depends(require_any_permission("crm.distribution.view", "crm.distribution.manage")),
) -> dict:
    """List eligible salespeople with their distribution configuration and lead counts within actor scope."""
    items = await service.list_salespeople(
        actor=current_user,
        search=search,
        department=department,
        is_eligible=is_eligible,
        state_id=state_id,
    )
    return build_success_response(
        data=[item.model_dump() for item in items],
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/salespeople/{user_id}", summary="Get salesperson distribution configuration")
async def get_salesperson(
    request: Request,
    user_id: uuid.UUID,
    service: CrmSalespersonDistributionService = Depends(get_crm_salesperson_distribution_service),
    current_user: CurrentUser = Depends(require_any_permission("crm.distribution.view", "crm.distribution.manage")),
) -> dict:
    """Retrieve distribution configuration for an individual salesperson."""
    item = await service.get_salesperson(user_id, actor=current_user)
    return build_success_response(
        data=item.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.put("/salespeople/{user_id}", summary="Update salesperson distribution configuration")
async def update_salesperson(
    request: Request,
    user_id: uuid.UUID,
    payload: SalespersonDistributionUpdate,
    service: CrmSalespersonDistributionService = Depends(get_crm_salesperson_distribution_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(require_permission("crm.distribution.manage")),
) -> dict:
    """Update eligibility, territories, priority, or capacity for an individual salesperson."""
    updated = await service.update_salesperson(user_id, payload, actor=current_user)
    await _record_distribution_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=user_id,
        description=f"Updated CRM salesperson distribution settings for user {updated.username}",
        new_values=payload.model_dump(exclude_unset=True),
    )
    return build_success_response(
        data=updated.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/salespeople/bulk-eligibility", summary="Bulk update salesperson eligibility")
async def bulk_update_eligibility(
    request: Request,
    payload: SalespersonBulkEligibilityUpdate,
    service: CrmSalespersonDistributionService = Depends(get_crm_salesperson_distribution_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(require_permission("crm.distribution.manage")),
) -> dict:
    """Bulk enable or disable lead assignment eligibility for multiple salespeople."""
    count = await service.bulk_update_eligibility(payload, actor=current_user)
    await _record_distribution_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=str(current_user.id),
        description=f"Bulk updated CRM lead assignment eligibility to {payload.is_eligible} for {count} users",
        new_values={"user_ids": [str(uid) for uid in payload.user_ids], "is_eligible": payload.is_eligible},
    )
    return build_success_response(
        data={"count": count, "is_eligible": payload.is_eligible},
        request_id=getattr(request.state, "request_id", "-"),
    )
