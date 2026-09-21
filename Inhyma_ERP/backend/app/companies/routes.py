"""
Company Routes.

Standard CRUD + contacts sub-resource + list-view inline grade/potential
updates + activate/deactivate + import/export, with audit logging and live event publishing.
"""

from __future__ import annotations

from datetime import datetime
import uuid

from fastapi import APIRouter, Depends, File, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.constants import AuditAction
from app.audit.dependencies import get_audit_service
from app.audit.service import AuditService
from app.auth.service import CurrentUser
from app.common.list_query import ListQueryParams, get_list_query_params
from app.common.pagination import PageMeta
from app.common.storage import save_uploaded_file
from app.core.logging import get_logger
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.events.dependencies import get_event_dispatcher
from app.events.dispatcher import EventDispatcher
from app.rbac.dependencies import require_any_permission
from app.companies.dependencies import get_company_service
from app.companies.schemas import (
    CompanyContactCreate,
    CompanyContactRead,
    CompanyContactUpdate,
    CompanyCreate,
    CompanyGradeUpdate,
    CompanyListItemRead,
    CompanyPotentialUpdate,
    CompanyRead,
    CompanyUpdate,
    ImportSummaryRead,
)
from app.companies.service import CompanyService

router = APIRouter(prefix="/companies", tags=["Companies"])
logger = get_logger(__name__)


async def _publish_company_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    company_id: uuid.UUID | str,
    version: int | None,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Publish a ``company.*`` live event on ``module:companies``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="companies",
        entity="company",
        entity_id=company_id,
        event_type=event_type,
        version=version,
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
    """Shared helper: record a company action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="companies",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="Company",
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


async def _to_company_read(service: CompanyService, company) -> dict:
    """Build a CompanyRead dict, filling in derived/joined fields."""
    payload = {
        "id": company.id,
        "company_name": company.company_name,
        "company_type": company.company_type,
        "brand_description": company.brand_description,
        "country_id": company.country_id,
        "state_id": company.state_id,
        "city_id": company.city_id,
        "area": company.area,
        "district": company.district,
        "sales_person_id": company.sales_person_id,
        "contact_salutation": company.contact_salutation,
        "contact_full_name": company.contact_full_name,
        "contact_designation": company.contact_designation,
        "contact_calling_number": company.contact_calling_number,
        "contact_whatsapp_number": company.contact_whatsapp_number,
        "contact_wechat_number": company.contact_wechat_number,
        "contact_indiamart_number": company.contact_indiamart_number,
        "tax_id_number": company.tax_id_number,
        "address": company.address,
        "town": company.town,
        "primary_website": company.primary_website,
        "secondary_website": company.secondary_website,
        "company_grade": company.company_grade,
        "current_status": company.current_status,
        "potential": company.potential,
        "potential_reason": company.potential_reason,
        "secondary_products_description": company.secondary_products_description,
        "visited_factory_office": company.visited_factory_office,
        "visit_remarks": company.visit_remarks,
        "visit_media": company.visit_media,
        "overall_remarks": company.overall_remarks,
        "is_active": company.is_active,
        "created_at": company.created_at,
        "updated_at": company.updated_at,
        "emails": [e.email for e in company.emails],
        "category_ids": [link.category_id for link in company.category_links],
        "sub_category_ids": [link.sub_category_id for link in company.sub_category_links],
        "product_ids": [link.product_id for link in company.product_links],
        "contacts": [CompanyContactRead.model_validate(c) for c in company.contacts],
    }
    return CompanyRead.model_validate(payload).model_dump(mode="json")


def _to_list_item(company) -> dict:
    """Build a CompanyListItemRead dict for the list view."""
    data = CompanyListItemRead.model_validate(company).model_dump(mode="json")
    data["category_ids"] = [str(link.category_id) for link in company.category_links]
    data["sub_category_ids"] = [str(link.sub_category_id) for link in company.sub_category_links]
    data["product_ids"] = [str(link.product_id) for link in company.product_links]
    return data


# ---------------------------------------------------------------------------
# Company CRUD
# ---------------------------------------------------------------------------


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a company")
async def create_company(
    payload: CompanyCreate,
    request: Request,
    service: CompanyService = Depends(get_company_service),
    current_user: CurrentUser = Depends(require_any_permission("company.create", "supplier.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new company profile."""
    company = await service.create(**payload.model_dump())
    data = await _to_company_read(service, company)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=company.id,
        description=f"Created company {company.company_name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_company_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company.created",
        company_id=company.id,
        version=getattr(company, "version", None),
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource created successfully.")


@router.get("", summary="List companies")
async def list_companies(
    request: Request,
    query: ListQueryParams = Depends(get_list_query_params),
    category_id: uuid.UUID | None = None,
    sub_category_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
    service: CompanyService = Depends(get_company_service),
    _current_user: CurrentUser = Depends(require_any_permission("company.view", "supplier.view")),
) -> dict:
    """List companies with search/sort/filter/pagination."""
    companies, total = await service.list_paginated(
        query, category_id=category_id, sub_category_id=sub_category_id, product_id=product_id
    )
    meta = PageMeta.build(page=query.page.page, page_size=query.page.page_size, total_records=total).as_meta_dict()
    data = [_to_list_item(c) for c in companies]
    return build_success_response(data=data, request_id=request.state.request_id, meta=meta)


@router.get("/export", summary="Export companies to CSV/Excel")
async def export_companies(
    request: Request,
    format: str = "csv",
    service: CompanyService = Depends(get_company_service),
    current_user: CurrentUser = Depends(require_any_permission("company.export", "supplier.export")),
    audit_service: AuditService = Depends(get_audit_service),
) -> Response:
    """Export every company as a CSV or XLSX file."""
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
        description=f"Exported companies as {file_format}.",
    )
    media_type = "text/csv" if file_format == "csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    today_str = datetime.now().strftime("%d-%m-%Y")
    filename = f"Companies_{today_str}.{file_format}"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/import", summary="Import companies from CSV/Excel")
async def import_companies(
    request: Request,
    file: UploadFile = File(...),
    service: CompanyService = Depends(get_company_service),
    current_user: CurrentUser = Depends(require_any_permission("company.create", "supplier.create")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Import companies from an uploaded CSV/XLSX file, validating every row."""
    raw_bytes = await file.read()
    summary = await service.import_file(file.filename or "import.csv", raw_bytes)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Imported companies: {summary.created} created, {summary.failed} failed.",
        new_values=summary.as_dict(),
    )
    data = ImportSummaryRead(**summary.as_dict()).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/upload-media", summary="Upload visit photo or video")
async def upload_company_media(
    file: UploadFile = File(...),
    _current_user: CurrentUser = Depends(require_any_permission("company.create", "supplier.create")),
) -> dict:
    """Upload a company visit photo/video."""
    content = await file.read()
    media_url, _ = await save_uploaded_file(
        content=content,
        original_filename=file.filename or "company_media.jpg",
        bucket="supplier-media",
        local_subfolder="companies",
        content_type=file.content_type,
    )
    return {"success": True, "data": {"url": media_url}}


@router.get("/sales-persons", summary="List users for sales person selection")
async def list_sales_persons(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    _current_user: CurrentUser = Depends(require_any_permission("company.view", "company.create", "supplier.view", "supplier.create")),
) -> dict:
    """Return active users for sales person selection."""
    from app.users.models import User
    from sqlalchemy import select
    stmt = (
        select(User.id, User.username, User.full_name)
        .where(User.is_active == True, User.is_deleted == False)
        .order_by(User.full_name.asc(), User.username.asc())
    )
    result = await db.execute(stmt)
    users = [
        {"id": str(r.id), "username": r.username, "full_name": r.full_name or r.username}
        for r in result.all()
    ]
    return build_success_response(data=users, request_id=request.state.request_id)


@router.get("/{company_id}", summary="Get a company")
async def get_company(
    company_id: uuid.UUID,
    request: Request,
    service: CompanyService = Depends(get_company_service),
    _current_user: CurrentUser = Depends(require_any_permission("company.view", "supplier.view")),
) -> dict:
    """Fetch a single company profile by ID."""
    company = await service.get_by_id_or_raise(company_id)
    data = await _to_company_read(service, company)
    return build_success_response(data=data, request_id=request.state.request_id)


@router.patch("/{company_id}", summary="Update a company")
async def update_company(
    company_id: uuid.UUID,
    payload: CompanyUpdate,
    request: Request,
    service: CompanyService = Depends(get_company_service),
    current_user: CurrentUser = Depends(require_any_permission("company.update", "supplier.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update an existing company profile."""
    company = await service.update(company_id, **payload.model_dump())
    data = await _to_company_read(service, company)
    changes = payload.model_dump(exclude_none=True, exclude={"version"}, mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=company.id,
        description=f"Updated company {company.company_name!r}.",
        new_values=payload.model_dump(exclude_none=True, mode="json"),
    )
    await _publish_company_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company.updated",
        company_id=company.id,
        version=getattr(company, "version", None),
        user_id=current_user.id,
        changes=changes,
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.patch("/{company_id}/grade", summary="Update a company's grade")
async def update_company_grade(
    company_id: uuid.UUID,
    payload: CompanyGradeUpdate,
    request: Request,
    service: CompanyService = Depends(get_company_service),
    current_user: CurrentUser = Depends(require_any_permission("company.grade_edit", "supplier.grade_edit", "company.update", "supplier.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update company grade inline."""
    company = await service.update_grade(company_id, payload.company_grade)
    data = await _to_company_read(service, company)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=company.id,
        description=f"Updated grade for company {company.company_name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_company_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company.updated",
        company_id=company.id,
        version=getattr(company, "version", None),
        user_id=current_user.id,
        changes={"company_grade": payload.model_dump(mode="json").get("company_grade")},
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.patch("/{company_id}/potential", summary="Update a company's potential")
async def update_company_potential(
    company_id: uuid.UUID,
    payload: CompanyPotentialUpdate,
    request: Request,
    service: CompanyService = Depends(get_company_service),
    current_user: CurrentUser = Depends(require_any_permission("company.potential_edit", "supplier.potential_edit", "company.update", "supplier.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update company potential inline."""
    company = await service.update_potential(company_id, payload.potential)
    data = await _to_company_read(service, company)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=company.id,
        description=f"Updated potential for company {company.company_name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_company_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company.updated",
        company_id=company.id,
        version=getattr(company, "version", None),
        user_id=current_user.id,
        changes={"potential": payload.model_dump(mode="json").get("potential")},
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/{company_id}/activate", summary="Activate a company")
async def activate_company(
    company_id: uuid.UUID,
    request: Request,
    service: CompanyService = Depends(get_company_service),
    current_user: CurrentUser = Depends(require_any_permission("company.update", "supplier.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set a company's status to active."""
    company = await service.activate(company_id)
    data = await _to_company_read(service, company)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=company.id,
        description=f"Activated company {company.company_name!r}.",
    )
    await _publish_company_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company.updated",
        company_id=company.id,
        version=getattr(company, "version", None),
        user_id=current_user.id,
        changes={"is_active": True},
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/{company_id}/deactivate", summary="Deactivate a company")
async def deactivate_company(
    company_id: uuid.UUID,
    request: Request,
    service: CompanyService = Depends(get_company_service),
    current_user: CurrentUser = Depends(require_any_permission("company.update", "supplier.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set a company's status to inactive."""
    company = await service.deactivate(company_id)
    data = await _to_company_read(service, company)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=company.id,
        description=f"Deactivated company {company.company_name!r}.",
    )
    await _publish_company_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company.updated",
        company_id=company.id,
        version=getattr(company, "version", None),
        user_id=current_user.id,
        changes={"is_active": False},
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.delete("/{company_id}", summary="Delete a company")
async def delete_company(
    company_id: uuid.UUID,
    request: Request,
    service: CompanyService = Depends(get_company_service),
    current_user: CurrentUser = Depends(require_any_permission("company.delete", "supplier.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete a company."""
    await service.delete(company_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=company_id,
        description="Deleted company.",
    )
    await _publish_company_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company.deleted",
        company_id=company_id,
        version=None,
        user_id=current_user.id,
        changes={},
    )
    return build_success_response(data={"deleted": True}, request_id=request.state.request_id)


# ---------------------------------------------------------------------------
# Contacts sub-resource
# ---------------------------------------------------------------------------


@router.post(
    "/{company_id}/contacts",
    status_code=status.HTTP_201_CREATED,
    summary="Add a contact person to a company",
)
async def create_company_contact(
    company_id: uuid.UUID,
    payload: CompanyContactCreate,
    request: Request,
    service: CompanyService = Depends(get_company_service),
    current_user: CurrentUser = Depends(require_any_permission("company.update", "supplier.update")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Add a contact person to a company."""
    contact = await service.add_contact(company_id, **payload.model_dump())
    data = CompanyContactRead.model_validate(contact).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=contact.id,
        description=f"Added contact {contact.person_name!r} to company.",
        new_values=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource created successfully.")


@router.get("/{company_id}/contacts", summary="List a company's contacts")
async def list_company_contacts(
    company_id: uuid.UUID,
    request: Request,
    service: CompanyService = Depends(get_company_service),
    _current_user: CurrentUser = Depends(require_any_permission("company.view", "supplier.view")),
) -> dict:
    """List every contact person for a company."""
    await service.get_by_id_or_raise(company_id)
    contacts = await service.list_contacts(company_id)
    data = [CompanyContactRead.model_validate(c).model_dump(mode="json") for c in contacts]
    return build_success_response(data=data, request_id=request.state.request_id)


@router.patch("/{company_id}/contacts/{contact_id}", summary="Update a company contact")
async def update_company_contact(
    company_id: uuid.UUID,
    contact_id: uuid.UUID,
    payload: CompanyContactUpdate,
    request: Request,
    service: CompanyService = Depends(get_company_service),
    current_user: CurrentUser = Depends(require_any_permission("company.update", "supplier.update")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Update an existing contact person."""
    contact = await service.update_contact(company_id, contact_id, **payload.model_dump())
    data = CompanyContactRead.model_validate(contact).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=contact.id,
        description=f"Updated contact {contact.person_name!r}.",
        new_values=payload.model_dump(exclude_none=True, mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.delete("/{company_id}/contacts/{contact_id}", summary="Delete a company contact")
async def delete_company_contact(
    company_id: uuid.UUID,
    contact_id: uuid.UUID,
    request: Request,
    service: CompanyService = Depends(get_company_service),
    current_user: CurrentUser = Depends(require_any_permission("company.update", "supplier.update")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Remove a contact person from a company."""
    await service.delete_contact(company_id, contact_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=contact_id,
        description="Deleted company contact.",
    )
    return build_success_response(data={"deleted": True}, request_id=request.state.request_id)
