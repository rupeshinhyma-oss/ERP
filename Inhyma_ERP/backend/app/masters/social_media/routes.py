"""
Social Media Routes. Standard CRUD + activate/deactivate + import/export, with audit logging.
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
from app.masters.social_media.dependencies import get_social_media_service
from app.masters.social_media.schemas import (
    ImportSummaryRead,
    SocialMediaCreate,
    SocialMediaRead,
    SocialMediaUpdate,
)
from app.masters.social_media.service import SocialMediaService
from app.rbac.dependencies import require_permission

router = APIRouter(prefix="/masters/social-media", tags=["Masters - Social Media"])


async def _publish_social_media_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    social_media_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish a ``social_media.*`` live event on ``module:social_media``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="social_media",
        entity="social_media",
        entity_id=social_media_id,
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
    """Shared helper: record a social media action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="masters.social_media",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="SocialMedia",
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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a social media entry")
async def create_social_media(
    payload: SocialMediaCreate,
    request: Request,
    service: SocialMediaService = Depends(get_social_media_service),
    current_user: CurrentUser = Depends(require_permission("socialmedia.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new social media platform entry."""
    item = await service.create(**payload.model_dump())
    data = SocialMediaRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Created social media {item.name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_social_media_event(
        db=db,
        dispatcher=dispatcher,
        event_type="social_media.created",
        social_media_id=item.id,
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource created successfully.")


@router.get("", summary="List social media platforms")
async def list_social_media(
    request: Request,
    query: ListQueryParams = Depends(get_list_query_params),
    service: SocialMediaService = Depends(get_social_media_service),
    _current_user: CurrentUser = Depends(require_permission("socialmedia.view")),
) -> dict:
    """List social media platforms, with search/sort/filter/pagination."""
    items, total = await service.list_paginated(query)
    meta = PageMeta.build(page=query.page.page, page_size=query.page.page_size, total_records=total).as_meta_dict()
    data = [SocialMediaRead.model_validate(i).model_dump(mode="json") for i in items]
    return build_success_response(data=data, request_id=request.state.request_id, meta=meta)


@router.get("/export", summary="Export social media platforms to CSV/Excel")
async def export_social_media(
    request: Request,
    format: str = "csv",
    service: SocialMediaService = Depends(get_social_media_service),
    current_user: CurrentUser = Depends(require_permission("socialmedia.export")),
    audit_service: AuditService = Depends(get_audit_service),
) -> Response:
    """Export every social media entry as a CSV or XLSX file."""
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
        description=f"Exported social media platforms as {file_format}.",
    )
    media_type = "text/csv" if file_format == "csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    filename = f"social_media_export.{file_format}"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import", summary="Import social media platforms from CSV/Excel")
async def import_social_media(
    request: Request,
    file: UploadFile = File(...),
    service: SocialMediaService = Depends(get_social_media_service),
    current_user: CurrentUser = Depends(require_permission("socialmedia.import")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Import social media platforms from an uploaded CSV or XLSX file."""
    raw_bytes = await file.read()
    summary = await service.import_file(file.filename or "import.csv", raw_bytes)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Imported social media platforms: created={summary.created}, failed={summary.failed}.",
    )
    return build_success_response(
        data=ImportSummaryRead.model_validate(summary).model_dump(mode="json"),
        request_id=request.state.request_id,
        message=f"Import complete. {summary.created} records created.",
    )


@router.get("/lookup", summary="Lightweight social media lookup")
async def lookup_social_media(
    service: SocialMediaService = Depends(get_social_media_service),
    _current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Lightweight id/name lookup for dropdowns."""
    items = await service.list_all_cached()
    data = [
        {
            "id": str(i.id),
            "name": i.name,
            "status": i.status.value,
        }
        for i in items
        if i.status.value == "active"
    ]
    return build_success_response(data=data)


@router.get("/{social_media_id}", summary="Get a social media platform by ID")
async def get_social_media(
    social_media_id: uuid.UUID,
    request: Request,
    service: SocialMediaService = Depends(get_social_media_service),
    _current_user: CurrentUser = Depends(require_permission("socialmedia.view")),
) -> dict:
    """Fetch a social media entry by its UUID."""
    item = await service.get_by_id_or_raise(social_media_id)
    data = SocialMediaRead.model_validate(item).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.put("/{social_media_id}", summary="Update a social media platform")
async def update_social_media(
    social_media_id: uuid.UUID,
    payload: SocialMediaUpdate,
    request: Request,
    service: SocialMediaService = Depends(get_social_media_service),
    current_user: CurrentUser = Depends(require_permission("socialmedia.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update an existing social media entry."""
    item = await service.update(social_media_id, **payload.model_dump())
    data = SocialMediaRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=social_media_id,
        description=f"Updated social media {item.name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_social_media_event(
        db=db,
        dispatcher=dispatcher,
        event_type="social_media.updated",
        social_media_id=social_media_id,
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource updated successfully.")


@router.patch("/{social_media_id}/activate", summary="Activate a social media platform")
async def activate_social_media(
    social_media_id: uuid.UUID,
    request: Request,
    service: SocialMediaService = Depends(get_social_media_service),
    current_user: CurrentUser = Depends(require_permission("socialmedia.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set social media status to ACTIVE."""
    item = await service.activate(social_media_id)
    data = SocialMediaRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=social_media_id,
        description=f"Activated social media {item.name!r}.",
    )
    await _publish_social_media_event(
        db=db,
        dispatcher=dispatcher,
        event_type="social_media.activated",
        social_media_id=social_media_id,
        user_id=current_user.id,
        changes={"status": "active"},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Social media activated.")


@router.patch("/{social_media_id}/deactivate", summary="Deactivate a social media platform")
async def deactivate_social_media(
    social_media_id: uuid.UUID,
    request: Request,
    service: SocialMediaService = Depends(get_social_media_service),
    current_user: CurrentUser = Depends(require_permission("socialmedia.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set social media status to INACTIVE."""
    item = await service.deactivate(social_media_id)
    data = SocialMediaRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=social_media_id,
        description=f"Deactivated social media {item.name!r}.",
    )
    await _publish_social_media_event(
        db=db,
        dispatcher=dispatcher,
        event_type="social_media.deactivated",
        social_media_id=social_media_id,
        user_id=current_user.id,
        changes={"status": "inactive"},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Social media deactivated.")


@router.delete("/{social_media_id}", summary="Delete a social media platform")
async def delete_social_media(
    social_media_id: uuid.UUID,
    request: Request,
    service: SocialMediaService = Depends(get_social_media_service),
    current_user: CurrentUser = Depends(require_permission("socialmedia.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete a social media record."""
    await service.delete(social_media_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=social_media_id,
        description=f"Deleted social media {social_media_id}.",
    )
    await _publish_social_media_event(
        db=db,
        dispatcher=dispatcher,
        event_type="social_media.deleted",
        social_media_id=social_media_id,
        user_id=current_user.id,
        changes={"deleted": True},
    )
    return build_success_response(data={"id": str(social_media_id)}, request_id=request.state.request_id, message="Resource deleted successfully.")


@router.post("/bulk-status", summary="Bulk activate/deactivate social media platforms")
async def bulk_status(
    payload: dict,
    request: Request,
    service: SocialMediaService = Depends(get_social_media_service),
    current_user: CurrentUser = Depends(require_permission("socialmedia.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk update status for a list of social media IDs."""
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
        description=f"Bulk {target_status} applied to {updated} social media records.",
    )
    return build_success_response(data={"updated": updated}, request_id=request.state.request_id, message=f"{updated} records updated.")


@router.post("/bulk-delete", summary="Bulk delete social media platforms")
async def bulk_delete(
    payload: dict,
    request: Request,
    service: SocialMediaService = Depends(get_social_media_service),
    current_user: CurrentUser = Depends(require_permission("socialmedia.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk soft-delete for a list of social media IDs."""
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
        description=f"Bulk deleted {deleted} social media records.",
    )
    return build_success_response(data={"deleted": deleted}, request_id=request.state.request_id, message=f"{deleted} records deleted.")
