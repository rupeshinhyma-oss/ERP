"""
Agent Types Routes. Standard CRUD + activate/deactivate + import/export, with audit logging.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.constants import AuditAction
from app.audit.dependencies import get_audit_service
from app.audit.service import AuditService
from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.common.list_query import ListQueryParams, get_list_query_params
from app.common.pagination import PageMeta
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.events.dependencies import get_event_dispatcher
from app.events.dispatcher import EventDispatcher
from app.masters.agent_types.dependencies import get_agent_type_service
from app.masters.agent_types.schemas import (
    AgentTypeCreate,
    AgentTypeRead,
    AgentTypeUpdate,
    ImportSummaryRead,
)
from app.masters.agent_types.service import AgentTypeService
from app.rbac.dependencies import require_permission

router = APIRouter(prefix="/masters/agent-types", tags=["Masters - Agent Types"])


async def _publish_agent_type_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    agent_type_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish an ``agent_type.*`` live event on ``module:agent_types``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="agent_types",
        entity="agent_type",
        entity_id=agent_type_id,
        event_type=event_type,
        version=None,
        user_id=user_id,
        changes=changes,
    )


async def _record_action(
    *,
    audit_service: AuditService,
    request: Request,
    action: AuditAction,
    actor: CurrentUser,
    entity_id: uuid.UUID | str,
    description: str,
    new_values: dict | None = None,
) -> None:
    """Shared helper: record an agent type action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="masters.agent_types",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="AgentType",
        entity_id=str(entity_id),
        new_values=new_values,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=request.state.request_id,
        http_method=request.method,
        endpoint=request.url.path,
        response_status=status.HTTP_200_OK,
        description=description,
    )
    request.state.audit_logged = True


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create an agent type entry")
async def create_agent_type(
    payload: AgentTypeCreate,
    request: Request,
    service: AgentTypeService = Depends(get_agent_type_service),
    current_user: CurrentUser = Depends(require_permission("agenttype.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new agent type platform entry."""
    item = await service.create(**payload.model_dump())
    data = AgentTypeRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Created agent type {item.name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_agent_type_event(
        db=db,
        dispatcher=dispatcher,
        event_type="agent_type.created",
        agent_type_id=item.id,
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource created successfully.")


@router.get("", summary="List agent types")
async def list_agent_types(
    request: Request,
    query: ListQueryParams = Depends(get_list_query_params),
    service: AgentTypeService = Depends(get_agent_type_service),
    _current_user: CurrentUser = Depends(require_permission("agenttype.view")),
) -> dict:
    """List agent types, with search/sort/filter/pagination."""
    items, total = await service.list_paginated(query)
    meta = PageMeta.build(page=query.page.page, page_size=query.page.page_size, total_records=total).as_meta_dict()
    data = [AgentTypeRead.model_validate(i).model_dump(mode="json") for i in items]
    return build_success_response(data=data, request_id=request.state.request_id, meta=meta)


@router.get("/export", summary="Export agent types to CSV/Excel")
async def export_agent_types(
    request: Request,
    format: str = "csv",
    service: AgentTypeService = Depends(get_agent_type_service),
    current_user: CurrentUser = Depends(require_permission("agenttype.export")),
    audit_service: AuditService = Depends(get_audit_service),
) -> Response:
    """Export every agent type entry as a CSV or XLSX file."""
    file_format = format.lower()
    if file_format not in ("csv", "xlsx"):
        file_format = "csv"
    content = await service.export_file(file_format)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.EXPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Exported agent types as {file_format}.",
    )
    media_type = "text/csv" if file_format == "csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    filename = f"agent_types_export.{file_format}"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import", summary="Import agent types from CSV/Excel")
async def import_agent_types(
    request: Request,
    file: UploadFile = File(...),
    service: AgentTypeService = Depends(get_agent_type_service),
    current_user: CurrentUser = Depends(require_permission("agenttype.import")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Import agent types from an uploaded CSV or XLSX file."""
    raw_bytes = await file.read()
    summary = await service.import_file(file.filename or "import.csv", raw_bytes)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Imported agent types: created={summary.created}, failed={summary.failed}.",
    )
    return build_success_response(
        data=ImportSummaryRead.model_validate(summary).model_dump(mode="json"),
        request_id=request.state.request_id,
        message=f"Import complete. {summary.created} records created.",
    )


@router.get("/lookup", summary="Lightweight agent types lookup")
async def lookup_agent_types(
    service: AgentTypeService = Depends(get_agent_type_service),
    _current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Lightweight id/name lookup for dropdowns."""
    items = await service.list_all_cached()
    data = [
        {
            "id": str(i.id),
            "name": i.name,
            "description": i.description,
            "status": i.status.value,
        }
        for i in items
        if i.status.value == "active"
    ]
    return build_success_response(data=data)


@router.get("/{agent_type_id}", summary="Get an agent type by ID")
async def get_agent_type(
    agent_type_id: uuid.UUID,
    request: Request,
    service: AgentTypeService = Depends(get_agent_type_service),
    _current_user: CurrentUser = Depends(require_permission("agenttype.view")),
) -> dict:
    """Fetch an agent type entry by its UUID."""
    item = await service.get_by_id_or_raise(agent_type_id)
    data = AgentTypeRead.model_validate(item).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.put("/{agent_type_id}", summary="Update an agent type")
async def update_agent_type(
    agent_type_id: uuid.UUID,
    payload: AgentTypeUpdate,
    request: Request,
    service: AgentTypeService = Depends(get_agent_type_service),
    current_user: CurrentUser = Depends(require_permission("agenttype.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update an existing agent type entry."""
    item = await service.update(agent_type_id, **payload.model_dump())
    data = AgentTypeRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=agent_type_id,
        description=f"Updated agent type {item.name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_agent_type_event(
        db=db,
        dispatcher=dispatcher,
        event_type="agent_type.updated",
        agent_type_id=agent_type_id,
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource updated successfully.")


@router.patch("/{agent_type_id}/activate", summary="Activate an agent type")
async def activate_agent_type(
    agent_type_id: uuid.UUID,
    request: Request,
    service: AgentTypeService = Depends(get_agent_type_service),
    current_user: CurrentUser = Depends(require_permission("agenttype.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set agent type status to ACTIVE."""
    item = await service.activate(agent_type_id)
    data = AgentTypeRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=agent_type_id,
        description=f"Activated agent type {item.name!r}.",
    )
    await _publish_agent_type_event(
        db=db,
        dispatcher=dispatcher,
        event_type="agent_type.activated",
        agent_type_id=agent_type_id,
        user_id=current_user.id,
        changes={"status": "active"},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Agent type activated.")


@router.patch("/{agent_type_id}/deactivate", summary="Deactivate an agent type")
async def deactivate_agent_type(
    agent_type_id: uuid.UUID,
    request: Request,
    service: AgentTypeService = Depends(get_agent_type_service),
    current_user: CurrentUser = Depends(require_permission("agenttype.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set agent type status to INACTIVE."""
    item = await service.deactivate(agent_type_id)
    data = AgentTypeRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=agent_type_id,
        description=f"Deactivated agent type {item.name!r}.",
    )
    await _publish_agent_type_event(
        db=db,
        dispatcher=dispatcher,
        event_type="agent_type.deactivated",
        agent_type_id=agent_type_id,
        user_id=current_user.id,
        changes={"status": "inactive"},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Agent type deactivated.")


@router.delete("/{agent_type_id}", summary="Delete an agent type")
async def delete_agent_type(
    agent_type_id: uuid.UUID,
    request: Request,
    service: AgentTypeService = Depends(get_agent_type_service),
    current_user: CurrentUser = Depends(require_permission("agenttype.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete an agent type record."""
    await service.delete(agent_type_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=agent_type_id,
        description=f"Deleted agent type {agent_type_id}.",
    )
    await _publish_agent_type_event(
        db=db,
        dispatcher=dispatcher,
        event_type="agent_type.deleted",
        agent_type_id=agent_type_id,
        user_id=current_user.id,
        changes={"deleted": True},
    )
    return build_success_response(data={"id": str(agent_type_id)}, request_id=request.state.request_id, message="Resource deleted successfully.")


@router.post("/bulk-status", summary="Bulk activate/deactivate agent types")
async def bulk_status(
    payload: dict,
    request: Request,
    service: AgentTypeService = Depends(get_agent_type_service),
    current_user: CurrentUser = Depends(require_permission("agenttype.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk update status for a list of agent type IDs."""
    ids = payload.get("ids", [])
    target_status = payload.get("status", "active").lower()
    updated = 0
    for id_str in ids:
        try:
            cid = uuid.UUID(id_str)
            if target_status == "active":
                await service.activate(cid)
            else:
                await service.deactivate(cid)
            updated += 1
        except Exception:
            continue
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id="bulk",
        description=f"Bulk {target_status} applied to {updated} agent type records.",
    )
    return build_success_response(data={"updated": updated}, request_id=request.state.request_id, message=f"{updated} records updated.")


@router.post("/bulk-delete", summary="Bulk delete agent types")
async def bulk_delete(
    payload: dict,
    request: Request,
    service: AgentTypeService = Depends(get_agent_type_service),
    current_user: CurrentUser = Depends(require_permission("agenttype.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk soft-delete for a list of agent type IDs."""
    ids = payload.get("ids", [])
    deleted = 0
    for id_str in ids:
        try:
            cid = uuid.UUID(id_str)
            await service.delete(cid)
            deleted += 1
        except Exception:
            continue
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id="bulk",
        description=f"Bulk deleted {deleted} agent type records.",
    )
    return build_success_response(data={"deleted": deleted}, request_id=request.state.request_id, message=f"{deleted} records deleted.")
