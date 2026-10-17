"""
CRM Lead and Assignment Visibility Routes.

Dedicated endpoints under /crm/leads and /crm/assignment-history for querying
leads, ownership status, and persisted assignment audit history.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request, status

from app.audit.constants import AuditAction
from app.audit.dependencies import get_audit_service
from app.audit.service import AuditService
from app.auth.service import CurrentUser
from app.core.exceptions import ForbiddenException
from app.core.logging import get_logger
from app.core.responses import build_success_response
from app.crm.dependencies import get_crm_lead_service
from app.crm.lead_service import CrmLeadService
from app.crm.schemas import (
    CrmActivityCreate,
    CrmFollowUpCreate,
    CrmFollowUpStatusUpdate,
    CrmLeadCreate,
    CrmLeadReassignRequest,
    CrmLeadStageTransitionRequest,
    CrmLeadUpdate,
)
from app.rbac.dependencies import require_any_permission

router = APIRouter(tags=["CRM Leads & Assignment Visibility"])
logger = get_logger(__name__)


@router.get("/crm/leads", summary="List CRM leads with ownership visibility")
async def list_leads(
    request: Request,
    search: str | None = Query(default=None, description="Search by name, phone, email, company, code"),
    pipeline_id: uuid.UUID | None = Query(default=None, description="Filter by pipeline ID"),
    stage_id: uuid.UUID | None = Query(default=None, description="Filter by stage ID"),
    assigned_to: uuid.UUID | None = Query(default=None, description="Filter by assigned salesperson ID"),
    unassigned_only: bool = Query(default=False, description="Filter only unassigned leads"),
    campaign: str | None = Query(default=None, description="Filter by campaign"),
    status: str | None = Query(default=None, description="Filter by lifecycle status"),
    page: int = Query(default=1, ge=1, description="Page number"),
    page_size: int = Query(default=25, ge=1, le=100, description="Page size"),
    service: CrmLeadService = Depends(get_crm_lead_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """
    Retrieve paginated list of CRM leads with ownership and assignment visibility.
    Enforces departmental and salesperson scopes on the backend.
    """
    if assigned_to is not None:
        role_type, _ = await service.get_actor_role_and_scope(current_user)
        if role_type == "salesperson" and assigned_to != current_user.id:
            raise ForbiddenException("Salespeople can only query their own leads.")

    result = await service.list_leads(
        actor=current_user,
        search=search,
        pipeline_id=pipeline_id,
        stage_id=stage_id,
        assigned_to=assigned_to,
        unassigned_only=unassigned_only,
        campaign=campaign,
        status=status,
        page=page,
        page_size=page_size,
    )
    return build_success_response(
        data=result.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/crm/leads/{lead_id}", summary="Get CRM lead detail")
async def get_lead(
    request: Request,
    lead_id: uuid.UUID,
    service: CrmLeadService = Depends(get_crm_lead_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """
    Retrieve single CRM lead detail with ownership and assignment reason.
    """
    lead = await service.get_lead(lead_id=lead_id, actor=current_user)
    return build_success_response(
        data=lead.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post(
    "/crm/leads",
    summary="Manually create a new CRM lead",
    status_code=status.HTTP_201_CREATED,
)
async def create_lead(
    request: Request,
    payload: CrmLeadCreate,
    service: CrmLeadService = Depends(get_crm_lead_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """
    Manually create a single CRM lead.
    Salespeople create leads for themselves; managers/admins create within their permitted scope.
    Normalizes phone numbers and rejects duplicates.
    """
    lead = await service.create_lead(payload=payload, actor=current_user)

    await audit_service.record(
        action=AuditAction.CREATE,
        module="crm",
        user_id=current_user.id,
        username_snapshot=current_user.username,
        entity_type="CrmLead",
        entity_id=str(lead.id),
        new_values=payload.model_dump(mode="json"),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, "request_id", "-"),
        http_method=request.method,
        endpoint=request.url.path,
        response_status=status.HTTP_201_CREATED,
        description=f"Created CRM lead {lead.lead_code} ({lead.name})",
    )
    request.state.audit_logged = True

    return build_success_response(
        data=lead.model_dump(),
        message="Lead created successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.patch(
    "/crm/leads/{lead_id}",
    summary="Update CRM lead details",
)
async def update_lead(
    request: Request,
    lead_id: uuid.UUID,
    payload: CrmLeadUpdate,
    service: CrmLeadService = Depends(get_crm_lead_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """
    Update details of a CRM lead (e.g. priority, contact details, company, notes).
    Preserves priority if not explicitly changed.
    """
    lead = await service.update_lead(lead_id=lead_id, payload=payload, actor=current_user)

    await audit_service.record(
        action=AuditAction.UPDATE,
        module="crm",
        user_id=current_user.id,
        username_snapshot=current_user.username,
        entity_type="CrmLead",
        entity_id=str(lead.id),
        new_values=payload.model_dump(exclude_unset=True, mode="json"),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, "request_id", "-"),
        http_method=request.method,
        endpoint=request.url.path,
        response_status=status.HTTP_200_OK,
        description=f"Updated CRM lead {lead.lead_code}",
    )
    request.state.audit_logged = True

    return build_success_response(
        data=lead.model_dump(),
        message="Lead updated successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/crm/assignment-history", summary="List CRM assignment history audit log")
async def list_assignment_history(
    request: Request,
    lead_id: uuid.UUID | None = Query(default=None, description="Filter by lead ID"),
    salesperson_id: uuid.UUID | None = Query(default=None, description="Filter by salesperson ID"),
    batch_id: uuid.UUID | None = Query(default=None, description="Filter by import batch ID"),
    page: int = Query(default=1, ge=1, description="Page number"),
    page_size: int = Query(default=25, ge=1, le=100, description="Page size"),
    service: CrmLeadService = Depends(get_crm_lead_service),
    current_user: CurrentUser = Depends(
        require_any_permission(
            "crm.leads.view",
            "crm.leads.manage",
            "crm.distribution.view",
            "crm.distribution.manage",
        )
    ),
) -> dict:
    """
    Retrieve paginated CRM lead assignment audit history records.
    Restricted to actor's authorized team or self-scope.
    """
    result = await service.list_assignment_history(
        actor=current_user,
        lead_id=lead_id,
        salesperson_id=salesperson_id,
        batch_id=batch_id,
        page=page,
        page_size=page_size,
    )
    return build_success_response(
        data=result.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/crm/leads/{lead_id}/reassign", summary="Reassign lead to a salesperson")
async def reassign_lead(
    request: Request,
    lead_id: uuid.UUID,
    payload: CrmLeadReassignRequest,
    service: CrmLeadService = Depends(get_crm_lead_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.manage")
    ),
) -> dict:
    """
    Reassign a CRM lead to an eligible salesperson.
    Requires crm.leads.manage permission and enforces manager/admin scope on the backend.
    Mandatory reason (min 5 chars).
    """
    lead = await service.reassign_lead(
        lead_id=lead_id,
        new_salesperson_id=payload.new_salesperson_id,
        reason=payload.reason,
        actor=current_user,
    )

    await audit_service.record(
        action=AuditAction.UPDATE,
        module="crm",
        user_id=current_user.id,
        username_snapshot=current_user.username,
        entity_type="CrmLead",
        entity_id=str(lead_id),
        new_values={
            "lead_id": str(lead_id),
            "new_salesperson_id": str(payload.new_salesperson_id),
            "reason": payload.reason,
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, "request_id", "-"),
        http_method=request.method,
        endpoint=request.url.path,
        response_status=status.HTTP_200_OK,
        description=f"Reassigned lead {lead.lead_code} to salesperson {lead.assigned_salesperson_name}. Reason: {payload.reason}",
    )
    request.state.audit_logged = True

    return build_success_response(
        data=lead.model_dump(),
        message=f"Lead {lead.lead_code} successfully reassigned.",
        request_id=getattr(request.state, "request_id", "-"),
    )


# -----------------------------------------------------------------------------
# Phase 6: Activity Logging Endpoints
# -----------------------------------------------------------------------------


@router.post(
    "/crm/leads/{lead_id}/activities",
    summary="Log activity on a lead",
    status_code=status.HTTP_201_CREATED,
)
async def create_lead_activity(
    request: Request,
    lead_id: uuid.UUID,
    payload: CrmActivityCreate,
    service: CrmLeadService = Depends(get_crm_lead_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """
    Log an activity/touchpoint (call, meeting, note, email, whatsapp, task, etc.) on a lead.
    Automatically updates lead.last_contacted_at for direct contact activities.
    """
    activity = await service.create_activity(
        lead_id=lead_id,
        data=payload,
        actor=current_user,
    )

    await audit_service.record(
        action=AuditAction.CREATE,
        module="crm",
        user_id=current_user.id,
        username_snapshot=current_user.username,
        entity_type="CrmActivity",
        entity_id=str(activity.id),
        new_values=payload.model_dump(mode="json"),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, "request_id", "-"),
        http_method=request.method,
        endpoint=request.url.path,
        response_status=status.HTTP_201_CREATED,
        description=f"Logged {payload.activity_type} activity on lead {lead_id}",
    )
    request.state.audit_logged = True

    return build_success_response(
        data=activity.model_dump(),
        message="Activity logged successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get(
    "/crm/leads/{lead_id}/activities",
    summary="List activities for a lead",
)
async def list_lead_activities(
    request: Request,
    lead_id: uuid.UUID,
    page: int = Query(default=1, ge=1, description="Page number"),
    page_size: int = Query(default=50, ge=1, le=100, description="Page size"),
    service: CrmLeadService = Depends(get_crm_lead_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """Retrieve reverse chronological paginated list of activities for a lead."""
    result = await service.list_activities(
        lead_id=lead_id,
        actor=current_user,
        page=page,
        page_size=page_size,
    )
    return build_success_response(
        data=result.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


# -----------------------------------------------------------------------------
# Phase 6: Follow-Up Endpoints
# -----------------------------------------------------------------------------


@router.post(
    "/crm/leads/{lead_id}/follow-ups",
    summary="Schedule follow-up on a lead",
    status_code=status.HTTP_201_CREATED,
)
async def schedule_lead_follow_up(
    request: Request,
    lead_id: uuid.UUID,
    payload: CrmFollowUpCreate,
    service: CrmLeadService = Depends(get_crm_lead_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """
    Schedule a CRM follow-up commitment on a lead and recalculate next_follow_up_at.
    """
    follow_up = await service.create_follow_up(
        lead_id=lead_id,
        data=payload,
        actor=current_user,
    )

    await audit_service.record(
        action=AuditAction.CREATE,
        module="crm",
        user_id=current_user.id,
        username_snapshot=current_user.username,
        entity_type="CrmFollowUp",
        entity_id=str(follow_up.id),
        new_values=payload.model_dump(mode="json"),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, "request_id", "-"),
        http_method=request.method,
        endpoint=request.url.path,
        response_status=status.HTTP_201_CREATED,
        description=f"Scheduled {payload.follow_up_type} follow-up on lead {lead_id}",
    )
    request.state.audit_logged = True

    return build_success_response(
        data=follow_up.model_dump(),
        message="Follow-up scheduled successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get(
    "/crm/leads/{lead_id}/follow-ups",
    summary="List follow-ups for a specific lead",
)
async def list_lead_follow_ups(
    request: Request,
    lead_id: uuid.UUID,
    status: str = Query(default="all", description="Filter by status (pending, completed, cancelled, all)"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    service: CrmLeadService = Depends(get_crm_lead_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """
    Retrieve paginated follow-up commitments for a specific lead with RBAC scope check.
    """
    result = await service.list_follow_ups(
        actor=current_user,
        lead_id=lead_id,
        status=status,
        page=page,
        page_size=page_size,
    )
    return build_success_response(
        data=result.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.patch(
    "/crm/follow-ups/{follow_up_id}/status",
    summary="Complete or cancel a follow-up",
)
async def update_follow_up_status(
    request: Request,
    follow_up_id: uuid.UUID,
    payload: CrmFollowUpStatusUpdate,
    service: CrmLeadService = Depends(get_crm_lead_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """
    Mark a follow-up as completed or cancelled.
    Completing a follow-up logs an activity and recalculates lead.next_follow_up_at.
    """
    follow_up = await service.update_follow_up_status(
        follow_up_id=follow_up_id,
        data=payload,
        actor=current_user,
    )

    await audit_service.record(
        action=AuditAction.UPDATE,
        module="crm",
        user_id=current_user.id,
        username_snapshot=current_user.username,
        entity_type="CrmFollowUp",
        entity_id=str(follow_up_id),
        new_values=payload.model_dump(mode="json"),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, "request_id", "-"),
        http_method=request.method,
        endpoint=request.url.path,
        response_status=status.HTTP_200_OK,
        description=f"Updated follow-up {follow_up_id} status to {payload.status}",
    )
    request.state.audit_logged = True

    return build_success_response(
        data=follow_up.model_dump(),
        message=f"Follow-up marked {payload.status}.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get(
    "/crm/follow-ups",
    summary="Query follow-ups with date filtering and team scoping",
)
async def list_follow_ups(
    request: Request,
    lead_id: uuid.UUID | None = Query(default=None, description="Filter by lead ID"),
    assigned_to: uuid.UUID | None = Query(default=None, description="Filter by assigned salesperson ID"),
    status: str | None = Query(default="pending", description="Status filter: pending, completed, cancelled, all"),
    due_filter: str | None = Query(default=None, description="Date filter: overdue, today, upcoming, past_due, all"),
    search: str | None = Query(default=None, description="Search lead name, code, phone, notes"),
    page: int = Query(default=1, ge=1, description="Page number"),
    page_size: int = Query(default=25, ge=1, le=100, description="Page size"),
    service: CrmLeadService = Depends(get_crm_lead_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """
    Retrieve paginated list of follow-ups.
    Enforces RBAC team scoping and business-local date boundary filtering.
    """
    result = await service.list_follow_ups(
        actor=current_user,
        lead_id=lead_id,
        assigned_to=assigned_to,
        status=status,
        due_filter=due_filter,
        search=search,
        page=page,
        page_size=page_size,
    )
    return build_success_response(
        data=result.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


# -----------------------------------------------------------------------------
# Phase 6: Stage Transition Endpoints
# -----------------------------------------------------------------------------


@router.post(
    "/crm/leads/{lead_id}/stage",
    summary="Transition lead to a new stage",
)
async def transition_lead_stage(
    request: Request,
    lead_id: uuid.UUID,
    payload: CrmLeadStageTransitionRequest,
    service: CrmLeadService = Depends(get_crm_lead_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """
    Transition lead to a new pipeline stage within its pipeline.
    Enforces won_at, lost_at, mandatory lost_reason, and writes CrmStageHistory + CrmActivity.
    """
    lead = await service.transition_lead_stage(
        lead_id=lead_id,
        data=payload,
        actor=current_user,
    )

    await audit_service.record(
        action=AuditAction.STATUS_CHANGED,
        module="crm",
        user_id=current_user.id,
        username_snapshot=current_user.username,
        entity_type="CrmLead",
        entity_id=str(lead_id),
        new_values=payload.model_dump(mode="json"),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, "request_id", "-"),
        http_method=request.method,
        endpoint=request.url.path,
        response_status=status.HTTP_200_OK,
        description=f"Transitioned lead {lead.lead_code} to stage {lead.stage_name}",
    )
    request.state.audit_logged = True

    return build_success_response(
        data=lead.model_dump(),
        message=f"Lead {lead.lead_code} transitioned to stage '{lead.stage_name}'.",
        request_id=getattr(request.state, "request_id", "-"),
    )


# -----------------------------------------------------------------------------
# Phase 6: Unified Chronological Timeline Endpoint
# -----------------------------------------------------------------------------


@router.get(
    "/crm/leads/{lead_id}/timeline",
    summary="Get unified chronological timeline for a lead",
)
async def get_lead_timeline(
    request: Request,
    lead_id: uuid.UUID,
    service: CrmLeadService = Depends(get_crm_lead_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """
    Retrieve unified chronological timeline combining activities, follow-ups,
    stage transition audits, and ownership assignment history.
    """
    timeline = await service.get_lead_timeline(
        lead_id=lead_id,
        actor=current_user,
    )
    return build_success_response(
        data=timeline.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get(
    "/crm/leads/{lead_id}/stage-history",
    summary="Get pipeline stage transition history for a lead",
)
async def list_lead_stage_history(
    request: Request,
    lead_id: uuid.UUID,
    service: CrmLeadService = Depends(get_crm_lead_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """
    Retrieve chronological stage transition history for a lead with RBAC scope check.
    """
    result = await service.list_stage_history(
        lead_id=lead_id,
        actor=current_user,
    )
    return build_success_response(
        data=result.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


# -----------------------------------------------------------------------------
# Phase 6, Step 3: Daily Work & Manager Team Oversight Endpoints
# -----------------------------------------------------------------------------


@router.get(
    "/crm/daily-work/summary",
    summary="Get salesperson daily work metrics summary",
)
async def get_daily_work_summary(
    request: Request,
    salesperson_id: uuid.UUID | None = Query(
        default=None,
        description="Salesperson ID (defaults to current user; manager/admin scoped)",
    ),
    service: CrmLeadService = Depends(get_crm_lead_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """
    Retrieve real daily work metrics (overdue, due today, upcoming follow-ups, and active leads).
    Uses Asia/Kolkata business boundaries.
    Salespeople can only query their own metrics.
    """
    summary = await service.get_daily_work_summary(
        actor=current_user,
        salesperson_id=salesperson_id,
    )
    return build_success_response(
        data=summary.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get(
    "/crm/team-oversight",
    summary="Get manager or admin team oversight metrics",
)
async def get_team_oversight(
    request: Request,
    department_id: uuid.UUID | None = Query(
        default=None,
        description="Optional department filter for admin",
    ),
    service: CrmLeadService = Depends(get_crm_lead_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """
    Retrieve rep-by-rep active leads, overdue/due-today follow-ups, current calendar month won/lost counts,
    and pipeline-stage distributions scoped to the manager's authorized team/department (company-wide for admin).
    Salespeople are forbidden from accessing this endpoint.
    """
    oversight = await service.get_team_oversight(
        actor=current_user,
        department_id=department_id,
    )
    return build_success_response(
        data=oversight.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


# -----------------------------------------------------------------------------
# CRM Reports & Analytics Endpoints
# -----------------------------------------------------------------------------


@router.get(
    "/crm/reports/analytics",
    summary="Get comprehensive CRM reports and analytics metrics",
)
@router.get(
    "/crm/analytics",
    summary="Get comprehensive CRM reports and analytics metrics (alias)",
)
async def get_crm_analytics(
    request: Request,
    start_date: str | None = Query(default=None, description="Start date (YYYY-MM-DD) in Asia/Kolkata"),
    end_date: str | None = Query(default=None, description="End date (YYYY-MM-DD) in Asia/Kolkata"),
    pipeline_id: uuid.UUID | None = Query(default=None, description="Optional pipeline filter"),
    salesperson_id: uuid.UUID | None = Query(default=None, description="Optional salesperson filter (scoped)"),
    service: CrmLeadService = Depends(get_crm_lead_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """
    Retrieve comprehensive CRM performance and analytics metrics.
    Enforces strict role-based data isolation:
    - Admin: Company-wide metrics with optional salesperson/pipeline filters
    - Manager: Restricted to authorized departmental/team scope
    - Salesperson: Strictly personal metrics (forced self-assignment, external rep queries rejected)
    """
    analytics = await service.get_crm_analytics(
        actor=current_user,
        start_date=start_date,
        end_date=end_date,
        pipeline_id=pipeline_id,
        salesperson_id=salesperson_id,
    )
    return build_success_response(
        data=analytics.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/crm/leads/backfill-companies", summary="Safely backfill company_id for legacy CRM leads")
async def backfill_companies_endpoint(
    request: Request,
    service: CrmLeadService = Depends(get_crm_lead_service),
    current_user: CurrentUser = Depends(require_any_permission("crm.leads.manage")),
) -> dict:
    """
    Safely backfill company_id for legacy leads having a single reliable match in companies master.
    Leaves ambiguous and unmatched legacy rows unmodified and reports them for resolution.
    """
    from app.crm.company_linking import backfill_legacy_lead_companies
    results = await backfill_legacy_lead_companies(service.session)
    return build_success_response(
        data=results,
        request_id=getattr(request.state, "request_id", "-"),
        message="Legacy company backfill completed.",
    )



