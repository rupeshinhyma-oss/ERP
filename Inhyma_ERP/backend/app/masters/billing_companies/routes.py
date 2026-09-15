"""Billing Company Routes. Standard CRUD + activate/deactivate + import/export, with audit logging."""

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
from app.masters.billing_companies.dependencies import get_billing_company_service
from app.masters.billing_companies.models import BillingCompany
from app.masters.billing_companies.schemas import (
    BillingCompanyCreate,
    BillingCompanyLookup,
    BillingCompanyRead,
    BillingCompanyUpdate,
    ImportSummaryRead,
)
from app.masters.billing_companies.service import BillingCompanyService
from app.rbac.dependencies import require_permission

router = APIRouter(prefix="/masters/billing-companies", tags=["Masters - Billing Companies"])


def _to_read(item: BillingCompany) -> dict:
    """Serialize BillingCompany model to BillingCompanyRead dictionary."""
    read = BillingCompanyRead(
        id=item.id,
        name=item.name,
        email=item.email,
        mobile=item.mobile,
        logo_url=item.logo_url,
        signature_url=item.signature_url,
        address=item.address,
        city=item.city,
        zip_code=item.zip_code,
        gst_no=item.gst_no,
        pan_no=item.pan_no,
        so_prefix=item.so_prefix,
        pi_prefix=item.pi_prefix,
        bank_name=item.bank_name,
        terms_and_conditions=item.terms_and_conditions,
        status=item.status,
        created_at=item.created_at,
        updated_at=item.updated_at,
        version=item.version,
    )
    return read.model_dump(mode="json")


async def _publish_billing_company_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    company_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish a ``billing_company.*`` live event on ``module:billing_companies``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="billing_companies",
        entity="billing_company",
        entity_id=company_id,
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
    """Shared helper: record a billing company action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="masters.billing_companies",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="BillingCompany",
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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a billing company entry")
async def create_billing_company(
    payload: BillingCompanyCreate,
    request: Request,
    service: BillingCompanyService = Depends(get_billing_company_service),
    current_user: CurrentUser = Depends(require_permission("billingcompany.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new billing company platform entry."""
    item = await service.create(**payload.model_dump())
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Created billing company {item.name!r}.",
        new_values=data,
    )
    await _publish_billing_company_event(
        db=db,
        dispatcher=dispatcher,
        event_type="billing_company.created",
        company_id=item.id,
        user_id=current_user.id,
        changes=data,
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Billing company created successfully.")


@router.get("", summary="List billing companies with pagination and filters")
async def list_billing_companies(
    request: Request,
    query_params: ListQueryParams = Depends(get_list_query_params),
    service: BillingCompanyService = Depends(get_billing_company_service),
    current_user: CurrentUser = Depends(require_permission("billingcompany.view")),
) -> dict:
    """Return a paginated list of billing company entries."""
    items, total = await service.list_paginated(query_params)
    meta = PageMeta.build(page=query_params.page.page, page_size=query_params.page.page_size, total_records=total).as_meta_dict()
    data = [_to_read(i) for i in items]
    return build_success_response(data=data, meta=meta, request_id=request.state.request_id)


@router.get("/lookup", summary="List active billing companies for select dropdowns")
async def lookup_billing_companies(
    request: Request,
    service: BillingCompanyService = Depends(get_billing_company_service),
    current_user: CurrentUser = Depends(require_permission("billingcompany.view")),
) -> dict:
    """Return cached minimal billing company list for dropdown selectors."""
    items = await service.list_all_cached()
    data = [BillingCompanyLookup.model_validate(i).model_dump(mode="json") for i in items]
    return build_success_response(data=data, request_id=request.state.request_id)


@router.get("/export", summary="Export billing company master data to CSV or Excel")
async def export_billing_companies(
    format: str = "csv",
    service: BillingCompanyService = Depends(get_billing_company_service),
    current_user: CurrentUser = Depends(require_permission("billingcompany.export")),
) -> Response:
    """Stream an exported file containing all billing company records."""
    fmt = format.lower().strip()
    if fmt not in ("csv", "xlsx", "excel"):
        fmt = "csv"
    norm_fmt = "xlsx" if fmt in ("xlsx", "excel") else "csv"
    raw = await service.export_file(norm_fmt)
    if norm_fmt == "csv":
        return Response(
            content=raw,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="billing_companies.csv"'},
        )
    return Response(
        content=raw,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="billing_companies.xlsx"'},
    )


@router.post("/import", summary="Import billing company records from CSV or Excel")
async def import_billing_companies(
    request: Request,
    file: UploadFile = File(...),
    service: BillingCompanyService = Depends(get_billing_company_service),
    current_user: CurrentUser = Depends(require_permission("billingcompany.import")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk-import billing company records from a CSV or XLSX file."""
    raw = await file.read()
    filename = file.filename or "upload.csv"
    summary = await service.import_file(filename, raw)
    data = ImportSummaryRead.model_validate(summary.__dict__).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Imported billing company file {filename!r}: {summary.created} created, {summary.failed} failed.",
        new_values=data,
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Import completed.")


@router.get("/{company_id}", summary="Get a billing company by ID")
async def get_billing_company(
    company_id: uuid.UUID,
    request: Request,
    service: BillingCompanyService = Depends(get_billing_company_service),
    current_user: CurrentUser = Depends(require_permission("billingcompany.view")),
) -> dict:
    """Fetch details of a single billing company record."""
    item = await service.get_by_id_or_raise(company_id)
    return build_success_response(data=_to_read(item), request_id=request.state.request_id)


@router.put("/{company_id}", summary="Update a billing company entry")
async def update_billing_company(
    company_id: uuid.UUID,
    payload: BillingCompanyUpdate,
    request: Request,
    service: BillingCompanyService = Depends(get_billing_company_service),
    current_user: CurrentUser = Depends(require_permission("billingcompany.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update fields of an existing billing company."""
    item = await service.update(company_id, **payload.model_dump(exclude_unset=True))
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=company_id,
        description=f"Updated billing company {item.name!r}.",
        new_values=data,
    )
    await _publish_billing_company_event(
        db=db,
        dispatcher=dispatcher,
        event_type="billing_company.updated",
        company_id=company_id,
        user_id=current_user.id,
        changes=data,
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Billing company updated successfully.")


@router.patch("/{company_id}/activate", summary="Activate a billing company")
async def activate_billing_company(
    company_id: uuid.UUID,
    request: Request,
    service: BillingCompanyService = Depends(get_billing_company_service),
    current_user: CurrentUser = Depends(require_permission("billingcompany.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Mark a billing company as active."""
    item = await service.activate(company_id)
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=company_id,
        description=f"Activated billing company {item.name!r}.",
        new_values={"status": item.status.value},
    )
    await _publish_billing_company_event(
        db=db,
        dispatcher=dispatcher,
        event_type="billing_company.activated",
        company_id=company_id,
        user_id=current_user.id,
        changes={"status": item.status.value},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Billing company activated successfully.")


@router.patch("/{company_id}/deactivate", summary="Deactivate a billing company")
async def deactivate_billing_company(
    company_id: uuid.UUID,
    request: Request,
    service: BillingCompanyService = Depends(get_billing_company_service),
    current_user: CurrentUser = Depends(require_permission("billingcompany.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Mark a billing company as inactive."""
    item = await service.deactivate(company_id)
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=company_id,
        description=f"Deactivated billing company {item.name!r}.",
        new_values={"status": item.status.value},
    )
    await _publish_billing_company_event(
        db=db,
        dispatcher=dispatcher,
        event_type="billing_company.deactivated",
        company_id=company_id,
        user_id=current_user.id,
        changes={"status": item.status.value},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Billing company deactivated successfully.")


@router.delete("/{company_id}", summary="Soft-delete a billing company")
async def delete_billing_company(
    company_id: uuid.UUID,
    request: Request,
    service: BillingCompanyService = Depends(get_billing_company_service),
    current_user: CurrentUser = Depends(require_permission("billingcompany.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete a billing company record."""
    await service.delete(company_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=company_id,
        description=f"Deleted billing company {company_id}.",
    )
    await _publish_billing_company_event(
        db=db,
        dispatcher=dispatcher,
        event_type="billing_company.deleted",
        company_id=company_id,
        user_id=current_user.id,
        changes={"deleted": True},
    )
    return build_success_response(data={"id": str(company_id)}, request_id=request.state.request_id, message="Resource deleted successfully.")


@router.post("/bulk-status", summary="Bulk activate/deactivate billing companies")
async def bulk_status(
    payload: dict,
    request: Request,
    service: BillingCompanyService = Depends(get_billing_company_service),
    current_user: CurrentUser = Depends(require_permission("billingcompany.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk update status for a list of billing company IDs."""
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
        description=f"Bulk {target_status} applied to {updated} billing company records.",
    )
    return build_success_response(data={"updated": updated}, request_id=request.state.request_id, message=f"{updated} records updated.")


@router.post("/bulk-delete", summary="Bulk delete billing companies")
async def bulk_delete(
    payload: dict,
    request: Request,
    service: BillingCompanyService = Depends(get_billing_company_service),
    current_user: CurrentUser = Depends(require_permission("billingcompany.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk soft-delete for a list of billing company IDs."""
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
        description=f"Bulk deleted {deleted} billing company records.",
    )
    return build_success_response(data={"deleted": deleted}, request_id=request.state.request_id, message=f"{deleted} records deleted.")
