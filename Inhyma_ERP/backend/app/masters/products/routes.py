"""Product Routes. Standard CRUD + activate/deactivate + import/export, with audit logging.

Phase 9: added live event publishing on every mutation so ProductMaster and
ProductGallery pages receive real-time updates. Uses the shared ``module:inventory``
channel (entity="product") that ``app.events.channels`` already maps to
``product.view`` -- matching the existing frontend ENTITY_TO_MODULE_CHANNEL
entry for ``"product" -> moduleChannel("inventory")``.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.constants import AuditAction
from app.audit.dependencies import get_audit_service
from app.audit.service import AuditService
from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.common.list_query import ListQueryParams, get_list_query_params
from app.common.pagination import PageMeta
from app.common.storage import MAX_FILE_SIZE, guess_content_type, sanitize_filename, save_uploaded_file
from app.core.config import settings
from app.core.exceptions import BadRequestException
from app.core.logging import get_logger
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.events.dependencies import get_event_dispatcher
from app.events.dispatcher import EventDispatcher
from app.masters.import_export import build_csv_export, build_excel_export
from app.masters.products.dependencies import get_product_service
from app.masters.products.schemas import (
    BulkDeletePayload,
    ImportSummaryRead,
    MachineSpareMappingIn,
    MachineSpareUnmapIn,
    MachineWithSparesRead,
    PackageDimensionReportRow,
    ProductCreate,
    ProductRead,
    ProductUpdate,
)
from app.masters.products.service import ProductService
from app.masters.products.models import ProductSpecificationDocument
from app.rbac.dependencies import require_any_permission, require_permission
from app.integration.jobs import enqueue_dispatch
from app.integration.repository import IntegrationOutboxRepository
from app.integration.service import IntegrationService
from app.queue.service import QueueService

router = APIRouter(prefix="/masters/products", tags=["Masters - Products"])
logger = get_logger(__name__)


async def _publish_product_integration_event(
    *,
    db: AsyncSession,
    event_type: str,
    product_id: uuid.UUID,
    user_id: uuid.UUID,
    payload: dict,
) -> None:
    """Write one Phase 6 cross-ERP integration outbox row for a product."""
    service = IntegrationService(IntegrationOutboxRepository(db))
    outbox_event = service.publish_event(
        event_type=event_type,
        aggregate_type="product",
        aggregate_id=product_id,
        payload=payload,
        actor_type="user",
        actor_id=user_id,
    )
    await db.flush()
    queue_service = QueueService(db)
    await enqueue_dispatch(queue_service, outbox_event_id=outbox_event.id)


async def _publish_product_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    product_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """
    Commit ``db``, then publish a ``product.*`` live event on ``module:inventory``.

    Phase 9: Products use entity="product" which the frontend
    ENTITY_TO_MODULE_CHANNEL table already maps to moduleChannel("inventory"),
    matching the MODULE_CHANNEL_PERMISSIONS entry ``module:inventory -> product.view``.
    No version field on Product yet -- passed as None (liveEntityStore handles
    missing versions by skipping the staleness check, still applying the event).
    """
    await dispatcher.publish_lifecycle_event(
        db,
        module="inventory",
        entity="product",
        entity_id=product_id,
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
    """Shared helper: record a product action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="masters.products",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="Product",
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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a product")
async def create_product(
    payload: ProductCreate,
    request: Request,
    service: ProductService = Depends(get_product_service),
    current_user: CurrentUser = Depends(require_permission("product.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new product."""
    product = await service.create(**payload.model_dump())
    data = ProductRead.model_validate(product).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=product.id,
        description=f"Created product {product.product_name!r} ({product.product_code}).",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_product_integration_event(
        db=db,
        event_type="product.created",
        product_id=product.id,
        user_id=current_user.id,
        payload={
            "product_id": str(product.id),
            "product_code": product.product_code,
            "product_name": product.product_name,
            "category": getattr(product, "category_id", None) and str(product.category_id),
            "is_active": getattr(product, "is_active", True),
            "version": getattr(product, "version", 1),
        },
    )
    await _publish_product_event(
        db=db,
        dispatcher=dispatcher,
        event_type="product.created",
        product_id=product.id,
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource created successfully.")


@router.get("", summary="List products")
async def list_products(
    request: Request,
    query: ListQueryParams = Depends(get_list_query_params),
    service: ProductService = Depends(get_product_service),
    _current_user: CurrentUser = Depends(require_permission("product.view")),
) -> dict:
    """List products, with search/sort/filter/pagination."""
    products, total = await service.list_paginated(query)
    meta = PageMeta.build(page=query.page.page, page_size=query.page.page_size, total_records=total).as_meta_dict()

    data = [ProductRead.model_validate(p) for p in products]
    return build_success_response(data=data, request_id=request.state.request_id, meta=meta)


@router.get("/export", summary="Export products to CSV/Excel")
async def export_products(
    request: Request,
    format: str = "csv",
    service: ProductService = Depends(get_product_service),
    current_user: CurrentUser = Depends(require_permission("product.export")),
    audit_service: AuditService = Depends(get_audit_service),
) -> Response:
    """Export every product as a CSV or XLSX file."""
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
        description=f"Exported products as {file_format}.",
    )
    media_type = "text/csv" if file_format == "csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    from datetime import datetime, timezone
    today_str = datetime.now(timezone.utc).strftime("%d-%m-%Y")
    filename = f"Product_{today_str}.{file_format}"
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f"attachment; filename={filename}"})


@router.post("/import", summary="Import products from CSV/Excel")
async def import_products(
    request: Request,
    file: UploadFile = File(...),
    update_existing: bool = False,
    service: ProductService = Depends(get_product_service),
    current_user: CurrentUser = Depends(require_permission("product.import")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Import products from an uploaded CSV/XLSX file, validating every row."""
    raw_bytes = await file.read()
    summary = await service.import_file(
        file.filename or "import.csv",
        raw_bytes,
        update_existing=update_existing,
    )
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=(
            f"Imported products: {summary.created} created, {summary.updated} updated, "
            f"{summary.unchanged} unchanged, {summary.failed} failed."
        ),
        new_values=summary.as_dict(),
    )
    data = ImportSummaryRead(**summary.as_dict()).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/upload-image", summary="Upload product image to Supabase Storage")
async def upload_product_image(
    file: UploadFile = File(...),
    _current_user: CurrentUser = Depends(require_permission("product.create")),
) -> dict:
    """
    Upload a product image to Supabase Storage (bucket 'product-images'),
    falling back to local disk (uploads/products/) if Supabase is unavailable.
    """
    content = await file.read()
    image_url, _ = await save_uploaded_file(
        content=content,
        original_filename=file.filename or "product_image.jpg",
        bucket="product-images",
        local_subfolder="products",
        content_type=file.content_type,
    )
    return {"success": True, "data": {"url": image_url}}


ALLOWED_SPEC_DOC_EXTENSIONS: set[str] = {
    "pdf", "doc", "docx", "xls", "xlsx", "csv", "txt", "rtf", "odt", "ods", "ppt", "pptx",
}


def _resolve_public_api_origin(request: Request) -> str:
    """Resolve externally reachable base origin for DB-served specification document links."""
    if settings.BACKEND_URL and settings.BACKEND_URL.strip():
        return settings.BACKEND_URL.strip().rstrip("/")
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "http").split(",")[0].strip()
    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.url.netloc
        or ""
    ).split(",")[0].strip()
    if host.startswith("127.0.0.1:"):
        origin_hdr = f"{request.headers.get('origin', '')} {request.headers.get('referer', '')}"
        if "localhost" in origin_hdr:
            host = "localhost:" + host.split(":", 1)[1]
    if host:
        return f"{proto}://{host}"
    return str(request.base_url).rstrip("/")


@router.post("/specification-document", summary="Upload product specification document to DB")
async def upload_product_specification_document(
    request: Request,
    file: UploadFile = File(...),
    product_id: str | None = Form(None),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_any_permission("product.create", "product.update")),
) -> dict:
    """
    Store any uploaded Product Specification document directly in the database.
    When a PDF is uploaded, automatically generates a direct link to that DB-stored PDF.
    """
    content = await file.read()
    if not content:
        raise BadRequestException("Uploaded document file cannot be empty.")
    if len(content) > MAX_FILE_SIZE:
        raise BadRequestException(f"File size exceeds maximum allowed limit ({MAX_FILE_SIZE // (1024 * 1024)} MB).")

    original_filename = (file.filename or "specification.pdf").strip()
    ext = original_filename.rsplit(".", 1)[-1].lower() if "." in original_filename else ""
    if not ext or ext not in ALLOWED_SPEC_DOC_EXTENSIONS:
        raise BadRequestException(
            f"Unsupported document format '.{ext}'. Allowed formats: {', '.join(sorted(ALLOWED_SPEC_DOC_EXTENSIONS))}."
        )

    is_pdf = ext == "pdf" or (file.content_type or "").lower() == "application/pdf"
    mime = "application/pdf" if is_pdf else (file.content_type or guess_content_type(original_filename))
    clean_name = sanitize_filename(original_filename)

    parsed_product_id: uuid.UUID | None = None
    if product_id and product_id.strip():
        try:
            parsed_product_id = uuid.UUID(product_id.strip())
        except ValueError:
            parsed_product_id = None

    doc = ProductSpecificationDocument(
        product_id=parsed_product_id,
        filename=original_filename[:255],
        content_type=mime[:120],
        file_size=len(content),
        file_data=content,
        uploaded_by=current_user.id,
    )
    db.add(doc)
    await db.flush()

    origin = _resolve_public_api_origin(request)
    doc_url = f"{origin}{settings.API_V1_PREFIX}/masters/products/specification-documents/{doc.id}/{clean_name}"

    if parsed_product_id is not None:
        from app.masters.products.models import Product as ProductModel
        existing_prod = await db.get(ProductModel, parsed_product_id)
        if existing_prod is not None and getattr(existing_prod, "deleted_at", None) is None:
            existing_prod.specification_doc_id = doc.id
            existing_prod.specification_doc_name = doc.filename
            existing_prod.specification_doc_mime = doc.content_type
            existing_prod.specification_doc_url = doc_url
            existing_prod.specification = doc_url

    await db.commit()
    await db.refresh(doc)

    return build_success_response(
        data={
            "doc_id": str(doc.id),
            "filename": doc.filename,
            "clean_filename": clean_name,
            "content_type": doc.content_type,
            "file_size": doc.file_size,
            "is_pdf": is_pdf,
            "url": doc_url,
            "pdf_link": doc_url if is_pdf else None,
        },
        request_id=request.state.request_id,
        message="Specification document stored in database.",
    )


async def _serve_specification_document(doc_id: uuid.UUID, db: AsyncSession) -> Response:
    doc = await db.get(ProductSpecificationDocument, doc_id)
    if doc is None or not doc.file_data:
        raise HTTPException(status_code=404, detail="Specification document not found.")
    is_pdf = (doc.content_type or "").lower() == "application/pdf" or doc.filename.lower().endswith(".pdf")
    media_type = "application/pdf" if is_pdf else (doc.content_type or "application/octet-stream")
    disposition = "inline" if is_pdf else "attachment"
    safe_name = sanitize_filename(doc.filename or ("specification.pdf" if is_pdf else "specification.bin"))
    return Response(
        content=doc.file_data,
        media_type=media_type,
        headers={
            "Content-Disposition": f'{disposition}; filename="{safe_name}"',
            "Cache-Control": "public, max-age=86400",
        },
    )


@router.get("/specification-documents/{doc_id}", summary="Stream specification document from DB")
async def get_product_specification_document(
    doc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """Serve a DB-stored product specification document by ID."""
    return await _serve_specification_document(doc_id, db)


@router.get("/specification-documents/{doc_id}/{filename}", summary="Stream named specification document from DB")
async def get_product_specification_document_named(
    doc_id: uuid.UUID,
    filename: str,
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """Serve a DB-stored product specification document with clean filename in URL."""
    return await _serve_specification_document(doc_id, db)


@router.post("/bulk-delete", summary="Bulk delete products with zero-stock enforcement (admin level)")
async def bulk_delete_products(
    payload: BulkDeletePayload,
    request: Request,
    service: ProductService = Depends(get_product_service),
    current_user: CurrentUser = Depends(require_permission("product.delete")),
    # Spec: Bulk Delete is admin level -> needs the Bulk Actions permission as well as the delete permission.
    _bulk_allowed: CurrentUser = Depends(require_permission("product.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete multiple products, strictly enforcing zero-stock across all warehouses."""
    result = await service.bulk_delete(payload.product_ids)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id="bulk",
        description=f"Bulk deleted {result['deleted_count']} products.",
    )
    for pid in payload.product_ids:
        await _publish_product_event(
            db=db,
            dispatcher=dispatcher,
            event_type="product.deleted",
            product_id=pid,
            user_id=current_user.id,
            changes={},
        )
    return build_success_response(data=result, request_id=request.state.request_id)


@router.get("/machine-spares/universal-view", summary="Universal view showing machine-wise spare parts mapping")
async def get_machine_spares_universal_view(
    request: Request,
    search: str | None = None,
    service: ProductService = Depends(get_product_service),
    _current_user: CurrentUser = Depends(require_permission("product.view")),
) -> dict:
    """Return machine-wise spare parts mapping."""
    data = await service.get_machine_spares_universal_view(search=search)
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/machine-spares/map", summary="Link a spare part to a machine")
async def map_machine_spare(
    payload: MachineSpareMappingIn,
    request: Request,
    service: ProductService = Depends(get_product_service),
    _current_user: CurrentUser = Depends(require_permission("product.update")),
) -> dict:
    """Link a spare part to a machine."""
    mapping = await service.map_machine_spare(
        machine_id=payload.machine_id,
        spare_part_id=payload.spare_part_id,
        remarks=payload.remarks,
    )
    return build_success_response(data={"mapped": True, "id": str(mapping.id)}, request_id=request.state.request_id)


@router.post("/machine-spares/unmap", summary="Unlink a spare part from a machine")
@router.delete("/machine-spares/unmap", summary="Unlink a spare part alias")
async def unmap_machine_spare(
    payload: MachineSpareUnmapIn,
    request: Request,
    service: ProductService = Depends(get_product_service),
    _current_user: CurrentUser = Depends(require_permission("product.update")),
) -> dict:
    """Unlink a spare part from a machine."""
    success = await service.unmap_machine_spare(
        machine_id=payload.machine_id,
        spare_part_id=payload.spare_part_id,
    )
    return build_success_response(data={"unmapped": success}, request_id=request.state.request_id)


@router.get("/package-dimensions/report", summary="Separate report for dimensions of each package")
async def get_package_dimensions_report(
    request: Request,
    search: str | None = None,
    service: ProductService = Depends(get_product_service),
    _current_user: CurrentUser = Depends(require_permission("product.view")),
) -> dict:
    """Return dimensions and weights for each package across multi-package products."""
    data = await service.get_package_dimensions_report(search=search)
    return build_success_response(data=data, request_id=request.state.request_id)


@router.get("/package-dimensions/export", summary="Export package dimensions report to CSV/Excel")
async def export_package_dimensions(
    format: str = "csv",
    search: str | None = None,
    service: ProductService = Depends(get_product_service),
    _current_user: CurrentUser = Depends(require_permission("product.export")),
) -> Response:
    """Export package dimensions to CSV or Excel."""
    rows = await service.get_package_dimensions_report(search=search)
    headers = [
        "Product Name", "Product Code", "Product Type", "Package Name",
        "Title / Description", "Length (cm)", "Width (cm)", "Height (cm)",
        "CBM", "Net Weight (kg)", "Gross Weight (kg)"
    ]
    export_rows = []
    for r in rows:
        export_rows.append({
            "Product Name": r["product_name"],
            "Product Code": r["product_code"] or "",
            "Product Type": r["product_type"],
            "Package Name": r["package_name"] or "",
            "Title / Description": r["title"] or "",
            "Length (cm)": r["length"] if r["length"] is not None else "",
            "Width (cm)": r["width"] if r["width"] is not None else "",
            "Height (cm)": r["height"] if r["height"] is not None else "",
            "CBM": r["cbm"] if r["cbm"] is not None else "",
            "Net Weight (kg)": r["net_weight"] if r["net_weight"] is not None else "",
            "Gross Weight (kg)": r["gross_weight"] if r["gross_weight"] is not None else "",
        })
    if format.lower() == "xlsx":
        content = build_excel_export(headers, export_rows)
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = "package_dimensions_report.xlsx"
    else:
        content = build_csv_export(headers, export_rows)
        media_type = "text/csv; charset=utf-8"
        filename = "package_dimensions_report.csv"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{product_id}", summary="Get a product")
async def get_product(
    product_id: uuid.UUID,
    request: Request,
    service: ProductService = Depends(get_product_service),
    _current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Fetch a single product by ID (authenticated lookup)."""
    product = await service.get_by_id_or_raise(product_id)
    data = ProductRead.model_validate(product).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.patch("/{product_id}", summary="Update a product")
async def update_product(
    product_id: uuid.UUID,
    payload: ProductUpdate,
    request: Request,
    service: ProductService = Depends(get_product_service),
    current_user: CurrentUser = Depends(require_permission("product.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    product = await service.update(product_id, **payload.model_dump(exclude_unset=True))
    data = ProductRead.model_validate(product).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=product.id,
        description=f"Updated product {product.product_name!r}.",
        new_values=payload.model_dump(exclude_none=True, mode="json"),
    )
    await _publish_product_integration_event(
        db=db,
        event_type="product.updated",
        product_id=product.id,
        user_id=current_user.id,
        payload={
            "product_id": str(product.id),
            "product_code": product.product_code,
            "product_name": product.product_name,
            "category": getattr(product, "category_id", None) and str(product.category_id),
            "is_active": getattr(product, "is_active", True),
            "version": getattr(product, "version", 1),
        },
    )
    await _publish_product_event(
        db=db,
        dispatcher=dispatcher,
        event_type="product.updated",
        product_id=product.id,
        user_id=current_user.id,
        changes=payload.model_dump(exclude_none=True, mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/{product_id}/activate", summary="Activate a product")
@router.patch("/{product_id}/activate", summary="Activate alias")
async def activate_product(
    product_id: uuid.UUID,
    request: Request,
    service: ProductService = Depends(get_product_service),
    current_user: CurrentUser = Depends(require_permission("product.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set a product's status to active."""
    product = await service.activate(product_id)
    data = ProductRead.model_validate(product).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=product.id,
        description=f"Activated product {product.product_name!r}.",
    )
    await _publish_product_event(
        db=db,
        dispatcher=dispatcher,
        event_type="product.updated",
        product_id=product.id,
        user_id=current_user.id,
        changes={"is_active": True},
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/{product_id}/deactivate", summary="Deactivate a product")
@router.patch("/{product_id}/deactivate", summary="Deactivate alias")
async def deactivate_product(
    product_id: uuid.UUID,
    request: Request,
    service: ProductService = Depends(get_product_service),
    current_user: CurrentUser = Depends(require_permission("product.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set a product's status to inactive."""
    product = await service.deactivate(product_id)
    data = ProductRead.model_validate(product).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=product.id,
        description=f"Deactivated product {product.product_name!r}.",
    )
    await _publish_product_event(
        db=db,
        dispatcher=dispatcher,
        event_type="product.updated",
        product_id=product.id,
        user_id=current_user.id,
        changes={"is_active": False},
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.delete("/{product_id}", summary="Delete a product")
async def delete_product(
    product_id: uuid.UUID,
    request: Request,
    service: ProductService = Depends(get_product_service),
    current_user: CurrentUser = Depends(require_permission("product.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete a product."""
    await service.delete(product_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=product_id,
        description="Deleted product.",
    )
    await _publish_product_event(
        db=db,
        dispatcher=dispatcher,
        event_type="product.deleted",
        product_id=product_id,
        user_id=current_user.id,
        changes={},
    )
    return build_success_response(data={"deleted": True}, request_id=request.state.request_id)