"""Company Categories Routes. Standard CRUD + activate/deactivate + import/export, with audit logging."""

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
from app.masters.company_categories.dependencies import get_company_category_service
from app.masters.company_categories.schemas import (
    CompanyCategoryCreate,
    CompanyCategoryRead,
    CompanyCategoryUpdate,
    ImportSummaryRead,
)
from app.masters.company_categories.service import CompanyCategoryService
from app.rbac.dependencies import require_permission

router = APIRouter(prefix="/masters/company-categories", tags=["Masters - Company Categories"])


async def _publish_company_category_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    company_category_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish a ``company_category.*`` live event on ``module:company_categories``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="company_categories",
        entity="company_category",
        entity_id=company_category_id,
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
    """Shared helper: record a company category action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="masters.company_categories",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="CompanyCategory",
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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a company category entry")
async def create_company_category(
    payload: CompanyCategoryCreate,
    request: Request,
    service: CompanyCategoryService = Depends(get_company_category_service),
    current_user: CurrentUser = Depends(require_permission("companycategory.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new company category platform entry."""
    item = await service.create(**payload.model_dump())
    data = CompanyCategoryRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Created company category {item.name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_company_category_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company_category.created",
        company_category_id=item.id,
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource created successfully.")


@router.get("", summary="List company categories")
async def list_company_categories(
    request: Request,
    query: ListQueryParams = Depends(get_list_query_params),
    service: CompanyCategoryService = Depends(get_company_category_service),
    _current_user: CurrentUser = Depends(require_permission("companycategory.view")),
) -> dict:
    """List company categories, with search/sort/filter/pagination."""
    items, total = await service.list_paginated(query)
    meta = PageMeta.build(page=query.page.page, page_size=query.page.page_size, total_records=total).as_meta_dict()
    data = [CompanyCategoryRead.model_validate(i).model_dump(mode="json") for i in items]
    return build_success_response(data=data, request_id=request.state.request_id, meta=meta)


@router.get("/export", summary="Export company categories to CSV/Excel")
async def export_company_categories(
    request: Request,
    format: str = "csv",
    service: CompanyCategoryService = Depends(get_company_category_service),
    current_user: CurrentUser = Depends(require_permission("companycategory.export")),
    audit_service: AuditService = Depends(get_audit_service),
) -> Response:
    """Export every company category entry as a CSV or XLSX file."""
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
        description=f"Exported company categories as {file_format}.",
    )
    media_type = "text/csv" if file_format == "csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    filename = f"company_categories_export.{file_format}"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import", summary="Import company categories from CSV/Excel")
async def import_company_categories(
    request: Request,
    file: UploadFile = File(...),
    service: CompanyCategoryService = Depends(get_company_category_service),
    current_user: CurrentUser = Depends(require_permission("companycategory.import")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Import company categories from an uploaded CSV or XLSX file."""
    raw_bytes = await file.read()
    summary = await service.import_file(file.filename or "import.csv", raw_bytes)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Imported company categories: created={summary.created}, failed={summary.failed}.",
    )
    return build_success_response(
        data=ImportSummaryRead.model_validate(summary).model_dump(mode="json"),
        request_id=request.state.request_id,
        message=f"Import complete. {summary.created} records created.",
    )


@router.get("/lookup", summary="Lightweight company categories lookup")
async def lookup_company_categories(
    service: CompanyCategoryService = Depends(get_company_category_service),
    _current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Lightweight id/name lookup for dropdowns."""
    items = await service.list_all_cached()
    data = [
        {
            "id": str(i.id),
            "name": i.name,
            "business_type": i.business_type,
            "description": i.description,
            "status": i.status.value,
        }
        for i in items
        if i.status.value == "active"
    ]
    return build_success_response(data=data)


@router.get("/{company_category_id}", summary="Get a company category by ID")
async def get_company_category(
    company_category_id: uuid.UUID,
    request: Request,
    service: CompanyCategoryService = Depends(get_company_category_service),
    _current_user: CurrentUser = Depends(require_permission("companycategory.view")),
) -> dict:
    """Fetch a company category entry by its UUID."""
    item = await service.get_by_id_or_raise(company_category_id)
    data = CompanyCategoryRead.model_validate(item).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.put("/{company_category_id}", summary="Update a company category")
async def update_company_category(
    company_category_id: uuid.UUID,
    payload: CompanyCategoryUpdate,
    request: Request,
    service: CompanyCategoryService = Depends(get_company_category_service),
    current_user: CurrentUser = Depends(require_permission("companycategory.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update an existing company category entry."""
    item = await service.update(company_category_id, **payload.model_dump())
    data = CompanyCategoryRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=company_category_id,
        description=f"Updated company category {item.name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_company_category_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company_category.updated",
        company_category_id=company_category_id,
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource updated successfully.")


@router.patch("/{company_category_id}/activate", summary="Activate a company category")
async def activate_company_category(
    company_category_id: uuid.UUID,
    request: Request,
    service: CompanyCategoryService = Depends(get_company_category_service),
    current_user: CurrentUser = Depends(require_permission("companycategory.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set company category status to ACTIVE."""
    item = await service.activate(company_category_id)
    data = CompanyCategoryRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=company_category_id,
        description=f"Activated company category {item.name!r}.",
    )
    await _publish_company_category_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company_category.activated",
        company_category_id=company_category_id,
        user_id=current_user.id,
        changes={"status": "active"},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Company category activated.")


@router.patch("/{company_category_id}/deactivate", summary="Deactivate a company category")
async def deactivate_company_category(
    company_category_id: uuid.UUID,
    request: Request,
    service: CompanyCategoryService = Depends(get_company_category_service),
    current_user: CurrentUser = Depends(require_permission("companycategory.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set company category status to INACTIVE."""
    item = await service.deactivate(company_category_id)
    data = CompanyCategoryRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=company_category_id,
        description=f"Deactivated company category {item.name!r}.",
    )
    await _publish_company_category_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company_category.deactivated",
        company_category_id=company_category_id,
        user_id=current_user.id,
        changes={"status": "inactive"},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Company category deactivated.")


@router.delete("/{company_category_id}", summary="Delete a company category")
async def delete_company_category(
    company_category_id: uuid.UUID,
    request: Request,
    service: CompanyCategoryService = Depends(get_company_category_service),
    current_user: CurrentUser = Depends(require_permission("companycategory.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete a company category record."""
    await service.delete(company_category_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=company_category_id,
        description=f"Deleted company category {company_category_id}.",
    )
    await _publish_company_category_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company_category.deleted",
        company_category_id=company_category_id,
        user_id=current_user.id,
        changes={"deleted": True},
    )
    return build_success_response(data={"id": str(company_category_id)}, request_id=request.state.request_id, message="Resource deleted successfully.")


@router.post("/bulk-status", summary="Bulk activate/deactivate company categories")
async def bulk_status(
    payload: dict,
    request: Request,
    service: CompanyCategoryService = Depends(get_company_category_service),
    current_user: CurrentUser = Depends(require_permission("companycategory.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk update status for a list of company category IDs."""
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
        description=f"Bulk {target_status} applied to {updated} company category records.",
    )
    return build_success_response(data={"updated": updated}, request_id=request.state.request_id, message=f"{updated} records updated.")


@router.post("/bulk-delete", summary="Bulk delete company categories")
async def bulk_delete(
    payload: dict,
    request: Request,
    service: CompanyCategoryService = Depends(get_company_category_service),
    current_user: CurrentUser = Depends(require_permission("companycategory.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk soft-delete for a list of company category IDs."""
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
        description=f"Bulk deleted {deleted} company category records.",
    )
    return build_success_response(data={"deleted": deleted}, request_id=request.state.request_id, message=f"{deleted} records deleted.")
