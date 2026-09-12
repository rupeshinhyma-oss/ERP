"""
District Routes. Standard CRUD + activate/deactivate + import/export, with audit logging.

Publishes ``district.*`` live events on ``module:districts`` so the District list
page receives real-time updates from other users without a full-page reload.
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
from app.core.constants import RecordStatus
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.events.dependencies import get_event_dispatcher
from app.events.dispatcher import EventDispatcher
from app.masters.districts.dependencies import get_district_service
from app.masters.districts.schemas import (
    DistrictCreate,
    DistrictLookupRead,
    DistrictRead,
    DistrictUpdate,
    ImportSummaryRead,
)
from app.masters.districts.service import DistrictService
from app.rbac.dependencies import require_permission

router = APIRouter(prefix="/masters/districts", tags=["Masters - Districts"])


async def _publish_district_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    district_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish a ``district.*`` live event on ``module:districts``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="districts",
        entity="district",
        entity_id=district_id,
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
    """Shared helper: record a district action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="masters.districts",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="District",
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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a district")
async def create_district(
    payload: DistrictCreate,
    request: Request,
    service: DistrictService = Depends(get_district_service),
    current_user: CurrentUser = Depends(require_permission("district.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new district."""
    district = await service.create(**payload.model_dump())
    data = DistrictRead.model_validate(district).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=district.id,
        description=f"Created district {district.name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_district_event(
        db=db,
        dispatcher=dispatcher,
        event_type="district.created",
        district_id=district.id,
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(
        data=data,
        request_id=request.state.request_id,
        message="Resource created successfully.",
    )


@router.get("", summary="List districts")
async def list_districts(
    request: Request,
    query: ListQueryParams = Depends(get_list_query_params),
    service: DistrictService = Depends(get_district_service),
    _current_user: CurrentUser = Depends(require_permission("district.view")),
) -> dict:
    """List districts, with search/sort/filter/pagination."""
    districts, total = await service.list_paginated(query)
    meta = PageMeta.build(
        page=query.page.page, page_size=query.page.page_size, total_records=total
    ).as_meta_dict()
    data = [DistrictRead.model_validate(d).model_dump(mode="json") for d in districts]
    return build_success_response(
        data=data, request_id=request.state.request_id, meta=meta
    )


@router.get(
    "/lookup",
    summary="Lightweight id/name lookup for districts (no district.view required)",
)
async def lookup_districts(
    request: Request,
    state_id: uuid.UUID | None = None,
    service: DistrictService = Depends(get_district_service),
    _current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Return active districts as bare {id, name, state_id} pairs."""
    if state_id:
        districts = await service.list_by_state(state_id)
    else:
        districts = await service.list_all_cached()
    data = [
        DistrictLookupRead.model_validate(d).model_dump(mode="json") for d in districts
    ]
    return build_success_response(data=data, request_id=request.state.request_id)


@router.get("/export", summary="Export districts to CSV/Excel")
async def export_districts(
    request: Request,
    format: str = "csv",
    service: DistrictService = Depends(get_district_service),
    current_user: CurrentUser = Depends(require_permission("district.export")),
    audit_service: AuditService = Depends(get_audit_service),
) -> Response:
    """Export every district as a CSV or XLSX file."""
    file_format = format.lower()
    if file_format not in ("csv", "xlsx", "excel"):
        file_format = "csv"
    if file_format == "excel":
        file_format = "xlsx"
    content = await service.export_file(file_format)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.EXPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Exported districts as {file_format}.",
    )
    media_type = (
        "text/csv"
        if file_format == "csv"
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    filename = f"districts.{file_format}"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/import", summary="Import districts from CSV/Excel")
async def import_districts(
    request: Request,
    file: UploadFile = File(...),
    service: DistrictService = Depends(get_district_service),
    current_user: CurrentUser = Depends(require_permission("district.create")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Import districts from an uploaded CSV/XLSX file, validating every row."""
    raw_bytes = await file.read()
    summary = await service.import_file(raw_bytes, file.filename or "import.csv")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Imported districts: {summary.created} created, {summary.failed} failed.",
        new_values=summary.as_dict(),
    )
    data = ImportSummaryRead(**summary.as_dict()).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.get("/{district_id}", summary="Get a district")
async def get_district(
    district_id: uuid.UUID,
    request: Request,
    service: DistrictService = Depends(get_district_service),
    _current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Fetch a single district by ID (authenticated lookup)."""
    district = await service.get_by_id_or_raise(district_id)
    data = DistrictRead.model_validate(district).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.patch("/{district_id}", summary="Update a district")
async def update_district(
    district_id: uuid.UUID,
    payload: DistrictUpdate,
    request: Request,
    service: DistrictService = Depends(get_district_service),
    current_user: CurrentUser = Depends(require_permission("district.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update an existing district."""
    district = await service.update(district_id, **payload.model_dump(exclude_none=True))
    data = DistrictRead.model_validate(district).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=district.id,
        description=f"Updated district {district.name!r}.",
        new_values=payload.model_dump(exclude_none=True, mode="json"),
    )
    await _publish_district_event(
        db=db,
        dispatcher=dispatcher,
        event_type="district.updated",
        district_id=district.id,
        user_id=current_user.id,
        changes=payload.model_dump(exclude_none=True, mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.put("/{district_id}", summary="Update a district (PUT)")
async def update_district_put(
    district_id: uuid.UUID,
    payload: DistrictUpdate,
    request: Request,
    service: DistrictService = Depends(get_district_service),
    current_user: CurrentUser = Depends(require_permission("district.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Full update of an existing district."""
    return await update_district(
        district_id=district_id,
        payload=payload,
        request=request,
        service=service,
        current_user=current_user,
        audit_service=audit_service,
        db=db,
        dispatcher=dispatcher,
    )


@router.post("/{district_id}/activate", summary="Activate a district")
async def activate_district(
    district_id: uuid.UUID,
    request: Request,
    service: DistrictService = Depends(get_district_service),
    current_user: CurrentUser = Depends(require_permission("district.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set a district's status to active."""
    district = await service.activate(district_id)
    data = DistrictRead.model_validate(district).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=district.id,
        description=f"Activated district {district.name!r}.",
    )
    await _publish_district_event(
        db=db,
        dispatcher=dispatcher,
        event_type="district.updated",
        district_id=district.id,
        user_id=current_user.id,
        changes={"status": "active"},
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/{district_id}/deactivate", summary="Deactivate a district")
async def deactivate_district(
    district_id: uuid.UUID,
    request: Request,
    service: DistrictService = Depends(get_district_service),
    current_user: CurrentUser = Depends(require_permission("district.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set a district's status to inactive."""
    district = await service.deactivate(district_id)
    data = DistrictRead.model_validate(district).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=district.id,
        description=f"Deactivated district {district.name!r}.",
    )
    await _publish_district_event(
        db=db,
        dispatcher=dispatcher,
        event_type="district.updated",
        district_id=district.id,
        user_id=current_user.id,
        changes={"status": "inactive"},
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.delete("/{district_id}", summary="Delete a district")
async def delete_district(
    district_id: uuid.UUID,
    request: Request,
    service: DistrictService = Depends(get_district_service),
    current_user: CurrentUser = Depends(require_permission("district.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete a district."""
    await service.delete(district_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=district_id,
        description="Deleted district.",
    )
    await _publish_district_event(
        db=db,
        dispatcher=dispatcher,
        event_type="district.deleted",
        district_id=district_id,
        user_id=current_user.id,
        changes={},
    )
    return build_success_response(
        data={"deleted": True}, request_id=request.state.request_id
    )


@router.post("/bulk-delete", summary="Bulk delete districts")
async def bulk_delete_districts(
    payload: dict,
    request: Request,
    service: DistrictService = Depends(get_district_service),
    current_user: CurrentUser = Depends(require_permission("district.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Bulk soft-delete districts."""
    ids = [uuid.UUID(i) for i in payload.get("ids", [])]
    count = await service.bulk_delete(ids)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id="bulk",
        description=f"Bulk deleted {count} districts.",
    )
    return build_success_response(
        data={"count": count}, request_id=request.state.request_id
    )


@router.post("/bulk-status", summary="Bulk set status for districts")
async def bulk_status_districts(
    payload: dict,
    request: Request,
    service: DistrictService = Depends(get_district_service),
    current_user: CurrentUser = Depends(require_permission("district.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Bulk update status for districts."""
    ids = [uuid.UUID(i) for i in payload.get("ids", [])]
    status_val = RecordStatus(payload.get("status", "active"))
    count = await service.bulk_status(ids, status_val)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id="bulk",
        description=f"Bulk set status to {status_val.value} for {count} districts.",
    )
    return build_success_response(
        data={"count": count}, request_id=request.state.request_id
    )
