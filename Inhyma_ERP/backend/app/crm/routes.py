"""
CRM Pipeline and Stage Routes.

Dedicated endpoints under /crm/pipelines for managing CRM pipelines and ordered stages.
Enforces RBAC permissions:
- crm.pipelines.view / crm.pipelines.manage for read operations
- crm.pipelines.manage for all mutations
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
from app.crm.dependencies import get_crm_pipeline_service
from app.crm.schemas import (
    CrmPipelineCreate,
    CrmPipelineUpdate,
    CrmStageCreate,
    CrmStageReorderRequest,
    CrmStageUpdate,
)
from app.crm.service import CrmPipelineService
from app.rbac.dependencies import require_any_permission, require_permission

router = APIRouter(prefix="/crm/pipelines", tags=["CRM Pipelines"])
logger = get_logger(__name__)


async def _record_crm_action(
    *,
    audit_service: AuditService,
    request: Request,
    action: AuditAction,
    actor: CurrentUser,
    entity_id: uuid.UUID | str,
    description: str,
    new_values: dict | None = None,
) -> None:
    """Record a CRM pipeline/stage audit log entry."""
    await audit_service.record(
        action=action,
        module="crm",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="CrmPipeline",
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


# -----------------------------------------------------------------------------
# Pipeline Endpoints
# -----------------------------------------------------------------------------

@router.get("", summary="List CRM pipelines")
async def list_pipelines(
    request: Request,
    is_active: bool | None = Query(default=None, description="Filter by active status"),
    service: CrmPipelineService = Depends(get_crm_pipeline_service),
    _current_user: CurrentUser = Depends(require_any_permission("crm.pipelines.view", "crm.pipelines.manage", "crm.leads.view", "crm.leads.manage")),
) -> dict:
    """Retrieve all CRM pipelines with stage and lead counts."""
    pipelines = await service.list_pipelines(is_active=is_active)
    return build_success_response(
        data=[p.model_dump() for p in pipelines],
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("", summary="Create CRM pipeline", status_code=status.HTTP_201_CREATED)
async def create_pipeline(
    request: Request,
    payload: CrmPipelineCreate,
    service: CrmPipelineService = Depends(get_crm_pipeline_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(require_permission("crm.pipelines.manage")),
) -> dict:
    """Create a new CRM pipeline."""
    pipeline = await service.create_pipeline(payload, creator_id=current_user.id)
    await _record_crm_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=pipeline.id,
        description=f"Created CRM pipeline '{pipeline.name}'",
        new_values=payload.model_dump(mode="json"),
    )
    return build_success_response(
        data=pipeline.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/{pipeline_id}", summary="Get CRM pipeline detail")
async def get_pipeline(
    pipeline_id: uuid.UUID,
    request: Request,
    service: CrmPipelineService = Depends(get_crm_pipeline_service),
    _current_user: CurrentUser = Depends(require_any_permission("crm.pipelines.view", "crm.pipelines.manage", "crm.leads.view", "crm.leads.manage")),
) -> dict:
    """Retrieve full pipeline detail with ordered stages."""
    pipeline = await service.get_pipeline_detail(pipeline_id)
    return build_success_response(
        data=pipeline.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.put("/{pipeline_id}", summary="Update CRM pipeline")
async def update_pipeline(
    pipeline_id: uuid.UUID,
    payload: CrmPipelineUpdate,
    request: Request,
    service: CrmPipelineService = Depends(get_crm_pipeline_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(require_permission("crm.pipelines.manage")),
) -> dict:
    """Update pipeline name, description, active status, or default status."""
    updated = await service.update_pipeline(pipeline_id, payload)
    await _record_crm_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=pipeline_id,
        description=f"Updated CRM pipeline '{updated.name}'",
        new_values=payload.model_dump(mode="json", exclude_unset=True),
    )
    return build_success_response(
        data=updated.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/{pipeline_id}/set-default", summary="Set pipeline as default")
async def set_default_pipeline(
    pipeline_id: uuid.UUID,
    request: Request,
    service: CrmPipelineService = Depends(get_crm_pipeline_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(require_permission("crm.pipelines.manage")),
) -> dict:
    """Safely make this pipeline the default, clearing the previous default."""
    pipeline = await service.set_default_pipeline(pipeline_id)
    await _record_crm_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=pipeline_id,
        description=f"Set CRM pipeline '{pipeline.name}' as default",
    )
    return build_success_response(
        data=pipeline.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/{pipeline_id}/toggle-active", summary="Toggle pipeline active state")
async def toggle_active_pipeline(
    pipeline_id: uuid.UUID,
    request: Request,
    service: CrmPipelineService = Depends(get_crm_pipeline_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(require_permission("crm.pipelines.manage")),
) -> dict:
    """Toggle pipeline active status subject to integrity constraints."""
    pipeline = await service.toggle_active_pipeline(pipeline_id)
    await _record_crm_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.STATUS_CHANGED,
        actor=current_user,
        entity_id=pipeline_id,
        description=f"Toggled CRM pipeline '{pipeline.name}' active status to {pipeline.is_active}",
    )
    return build_success_response(
        data=pipeline.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.delete("/{pipeline_id}", summary="Delete CRM pipeline")
async def delete_pipeline(
    pipeline_id: uuid.UUID,
    request: Request,
    service: CrmPipelineService = Depends(get_crm_pipeline_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(require_permission("crm.pipelines.manage")),
) -> dict:
    """Safely delete CRM pipeline if no leads are attached and not default."""
    await service.delete_pipeline(pipeline_id)
    await _record_crm_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=pipeline_id,
        description=f"Deleted CRM pipeline {pipeline_id}",
    )
    return build_success_response(
        data={"message": "Pipeline deleted successfully."},
        request_id=getattr(request.state, "request_id", "-"),
    )


# -----------------------------------------------------------------------------
# Stage Endpoints
# -----------------------------------------------------------------------------

@router.get("/{pipeline_id}/stages", summary="List stages for a pipeline")
async def list_pipeline_stages(
    pipeline_id: uuid.UUID,
    request: Request,
    service: CrmPipelineService = Depends(get_crm_pipeline_service),
    _current_user: CurrentUser = Depends(
        require_any_permission("crm.pipelines.view", "crm.pipelines.manage", "crm.leads.view", "crm.leads.manage")
    ),
) -> dict:
    """Retrieve ordered stages for a given CRM pipeline."""
    pipeline = await service.get_pipeline_detail(pipeline_id)
    return build_success_response(
        data=[s.model_dump() for s in pipeline.stages],
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/{pipeline_id}/stages", summary="Add stage to pipeline", status_code=status.HTTP_201_CREATED)
async def create_stage(
    pipeline_id: uuid.UUID,
    payload: CrmStageCreate,
    request: Request,
    service: CrmPipelineService = Depends(get_crm_pipeline_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(require_permission("crm.pipelines.manage")),
) -> dict:
    """Add a new stage to a pipeline."""
    stage = await service.create_stage(pipeline_id, payload)
    await _record_crm_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=stage.id,
        description=f"Created CRM stage '{stage.name}' in pipeline {pipeline_id}",
        new_values=payload.model_dump(mode="json"),
    )
    return build_success_response(
        data=stage.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.put("/{pipeline_id}/stages/reorder", summary="Reorder stages in pipeline")
async def reorder_stages(
    pipeline_id: uuid.UUID,
    payload: CrmStageReorderRequest,
    request: Request,
    service: CrmPipelineService = Depends(get_crm_pipeline_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(require_permission("crm.pipelines.manage")),
) -> dict:
    """Persist new stage ordering for a pipeline."""
    stages = await service.reorder_stages(pipeline_id, payload)
    await _record_crm_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=pipeline_id,
        description=f"Reordered stages for CRM pipeline {pipeline_id}",
    )
    return build_success_response(
        data=[s.model_dump() for s in stages],
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.put("/{pipeline_id}/stages/{stage_id}", summary="Update stage")
async def update_stage(
    pipeline_id: uuid.UUID,
    stage_id: uuid.UUID,
    payload: CrmStageUpdate,
    request: Request,
    service: CrmPipelineService = Depends(get_crm_pipeline_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(require_permission("crm.pipelines.manage")),
) -> dict:
    """Update stage name, type, order, initial flag, or active state."""
    stage = await service.update_stage(pipeline_id, stage_id, payload)
    await _record_crm_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=stage_id,
        description=f"Updated CRM stage '{stage.name}' in pipeline {pipeline_id}",
        new_values=payload.model_dump(exclude_unset=True),
    )
    return build_success_response(
        data=stage.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/{pipeline_id}/stages/{stage_id}/toggle-active", summary="Toggle stage active state")
async def toggle_active_stage(
    pipeline_id: uuid.UUID,
    stage_id: uuid.UUID,
    request: Request,
    service: CrmPipelineService = Depends(get_crm_pipeline_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(require_permission("crm.pipelines.manage")),
) -> dict:
    """Toggle stage active state subject to integrity constraints."""
    stage = await service.toggle_active_stage(pipeline_id, stage_id)
    await _record_crm_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.STATUS_CHANGED,
        actor=current_user,
        entity_id=stage_id,
        description=f"Toggled CRM stage '{stage.name}' active status to {stage.is_active}",
    )
    return build_success_response(
        data=stage.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.delete("/{pipeline_id}/stages/{stage_id}", summary="Delete stage")
async def delete_stage(
    pipeline_id: uuid.UUID,
    stage_id: uuid.UUID,
    request: Request,
    service: CrmPipelineService = Depends(get_crm_pipeline_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(require_permission("crm.pipelines.manage")),
) -> dict:
    """Safely delete stage if not referenced by leads or stage transition history."""
    await service.delete_stage(pipeline_id, stage_id)
    await _record_crm_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=stage_id,
        description=f"Deleted CRM stage {stage_id} from pipeline {pipeline_id}",
    )
    return build_success_response(
        data={"message": "Stage deleted successfully."},
        request_id=getattr(request.state, "request_id", "-"),
    )
