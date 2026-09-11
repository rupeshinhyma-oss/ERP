"""
Reporting, Projections, Search, Metrics, and Unified Operations Routes (Phase 7).

Endpoints:
- Unified Search: GET /global/search, GET /global/search/{entity}
- Projections Inspection: GET /global/projections/{entity_type}/{id}
- Rebuild Projections: POST /global/projections/rebuild
- Reports Catalog: GET /global/reports/definitions
- Report Preview: GET /global/reports/{report_key}/preview
- Report Export Request: POST /global/reports/export
- Report Export Jobs: GET /global/reports/export, GET /global/reports/export/{id}
- Report Export Download: GET /global/reports/export/{id}/download
- Report Export Cleanup: POST /global/reports/export/cleanup
- Dashboard & Health: GET /global/dashboard, GET /global/health/erps/{id}, GET /global/health/subsystems
- Operations & Metrics: GET /global/metrics, POST /global/reconciliation/erps/{id}
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenException, NotFoundException, ValidationException
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.erp_registry.repository import ErpInstanceRepository
from app.platform_authz.dependencies import (
    AuthorizedPrincipal,
    require_authenticated_principal,
    require_platform_permission,
)
from app.reporting.dependencies import (
    get_dashboard_service,
    get_export_cleanup_service,
    get_export_service,
    get_health_service,
    get_metrics_service,
    get_projection_service,
    get_reconciliation_service,
    get_report_engine,
    get_search_service,
)
from app.reporting.schemas import (
    ExportJobRead,
    ExportRequest,
    GlobalBuyerProjectionDetail,
    GlobalBuyerProjectionRead,
    GlobalDashboardRead,
    GlobalInquiryProjectionDetail,
    GlobalInquiryProjectionRead,
    GlobalMetricsResponse,
    GlobalProductProjectionDetail,
    GlobalProductProjectionRead,
    GlobalSupplierProjectionDetail,
    GlobalSupplierProjectionRead,
    ReportDefinitionRead,
    ReportPreviewResponse,
    SearchResponse,
    SubsystemsHealthResponse,
    UnifiedSearchResponse,
)
from app.reporting.service import (
    DashboardService,
    ExportCleanupService,
    ExportService,
    HealthService,
    MetricsService,
    ProjectionService,
    ReconciliationService,
    ReportEngine,
    SearchService,
)

router = APIRouter(prefix="/global", tags=["Global Reporting, Search & Operations"])


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "")


async def _all_erp_ids(db: AsyncSession) -> list[uuid.UUID]:
    instances = await ErpInstanceRepository(db).list_all()
    return [i.id for i in instances]


# ---------------------------------------------------------------------------
# Search Endpoints
# ---------------------------------------------------------------------------


@router.get("/search", summary="Unified search across all business projections")
async def search_all(
    request: Request,
    q: str | None = Query(default=None, description="Search term across entities."),
    entity_type: list[str] | None = Query(default=None, description="Optional entity filters (buyer, supplier, product, inquiry)."),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    service: SearchService = Depends(get_search_service),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    all_erp_ids = await _all_erp_ids(db)
    response = await service.search_all(
        global_user_id=principal.global_user.id if principal.global_user else None,
        all_erp_ids=all_erp_ids,
        is_platform_admin=principal.is_platform_admin,
        query=q,
        entity_types=entity_type,
        limit=limit,
        offset=offset,
    )
    return build_success_response(response.model_dump(mode="json"), request_id=_request_id(request))


@router.get("/search/buyers", summary="Search over global buyer projections")
async def search_buyers(
    request: Request,
    q: str | None = Query(default=None, description="Search by company name."),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    service: SearchService = Depends(get_search_service),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    all_erp_ids = await _all_erp_ids(db)
    if principal.is_platform_admin:
        results, total = await service.buyer_projection_repository.search(
            allowed_erp_ids=all_erp_ids, query=q, status=status_filter, limit=limit, offset=offset
        )
    else:
        results, total = await service.search_buyers(
            global_user_id=principal.global_user.id,
            all_erp_ids=all_erp_ids,
            query=q,
            status=status_filter,
            limit=limit,
            offset=offset,
        )

    response = SearchResponse(
        results=[GlobalBuyerProjectionRead.model_validate(r) for r in results],
        total=total,
        limit=limit,
        offset=offset,
        data_as_of=datetime.now(timezone.utc),
    )
    return build_success_response(response.model_dump(mode="json"), request_id=_request_id(request))


@router.get("/search/suppliers", summary="Search over global supplier projections")
async def search_suppliers(
    request: Request,
    q: str | None = Query(default=None, description="Search by supplier name or code."),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    service: SearchService = Depends(get_search_service),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    all_erp_ids = await _all_erp_ids(db)
    if principal.is_platform_admin:
        results, total = await service.supplier_projection_repository.search(
            allowed_erp_ids=all_erp_ids, query=q, status=status_filter, limit=limit, offset=offset
        )
    else:
        results, total = await service.search_suppliers(
            global_user_id=principal.global_user.id,
            all_erp_ids=all_erp_ids,
            query=q,
            status=status_filter,
            limit=limit,
            offset=offset,
        )
    return build_success_response(
        {
            "results": [GlobalSupplierProjectionRead.model_validate(r).model_dump(mode="json") for r in results],
            "total": total,
            "limit": limit,
            "offset": offset,
            "data_as_of": datetime.now(timezone.utc).isoformat(),
        },
        request_id=_request_id(request),
    )


@router.get("/search/products", summary="Search over global product projections")
async def search_products(
    request: Request,
    q: str | None = Query(default=None, description="Search by product name or code."),
    category: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    service: SearchService = Depends(get_search_service),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    all_erp_ids = await _all_erp_ids(db)
    if principal.is_platform_admin:
        results, total = await service.product_projection_repository.search(
            allowed_erp_ids=all_erp_ids, query=q, category=category, limit=limit, offset=offset
        )
    else:
        results, total = await service.search_products(
            global_user_id=principal.global_user.id,
            all_erp_ids=all_erp_ids,
            query=q,
            category=category,
            limit=limit,
            offset=offset,
        )
    return build_success_response(
        {
            "results": [GlobalProductProjectionRead.model_validate(r).model_dump(mode="json") for r in results],
            "total": total,
            "limit": limit,
            "offset": offset,
            "data_as_of": datetime.now(timezone.utc).isoformat(),
        },
        request_id=_request_id(request),
    )


@router.get("/search/inquiries", summary="Search over global inquiry projections")
async def search_inquiries(
    request: Request,
    q: str | None = Query(default=None, description="Search by inquiry number or buyer name."),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    service: SearchService = Depends(get_search_service),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    all_erp_ids = await _all_erp_ids(db)
    if principal.is_platform_admin:
        results, total = await service.inquiry_projection_repository.search(
            allowed_erp_ids=all_erp_ids, query=q, status=status_filter, limit=limit, offset=offset
        )
    else:
        results, total = await service.search_inquiries(
            global_user_id=principal.global_user.id,
            all_erp_ids=all_erp_ids,
            query=q,
            status=status_filter,
            limit=limit,
            offset=offset,
        )
    return build_success_response(
        {
            "results": [GlobalInquiryProjectionRead.model_validate(r).model_dump(mode="json") for r in results],
            "total": total,
            "limit": limit,
            "offset": offset,
            "data_as_of": datetime.now(timezone.utc).isoformat(),
        },
        request_id=_request_id(request),
    )


# ---------------------------------------------------------------------------
# Detailed Projection Inspection
# ---------------------------------------------------------------------------


@router.get("/projections/{entity_type}/{projection_id}", summary="Get detailed projection by entity type and ID")
async def get_projection_detail(
    request: Request,
    entity_type: str,
    projection_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    service: SearchService = Depends(get_search_service),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    all_erp_ids = await _all_erp_ids(db)
    allowed_erp_ids = all_erp_ids if principal.is_platform_admin else await service.resolve_allowed_erp_ids(
        principal.principal_id, all_erp_ids
    )

    entity_lower = entity_type.lower()
    if entity_lower in ("buyer", "buyers"):
        p = await service.buyer_projection_repository.get_by_id(projection_id)
        if p is None or p.source_erp_id not in allowed_erp_ids:
            raise NotFoundException(f"No buyer projection found with id {projection_id}.")
        data = GlobalBuyerProjectionDetail.model_validate(p).model_dump(mode="json")

    elif entity_lower in ("supplier", "suppliers"):
        p = await service.supplier_projection_repository.get_by_id(projection_id)
        if p is None or p.source_erp_id not in allowed_erp_ids:
            raise NotFoundException(f"No supplier projection found with id {projection_id}.")
        data = GlobalSupplierProjectionDetail.model_validate(p).model_dump(mode="json")

    elif entity_lower in ("product", "products"):
        p = await service.product_projection_repository.get_by_id(projection_id)
        if p is None or p.source_erp_id not in allowed_erp_ids:
            raise NotFoundException(f"No product projection found with id {projection_id}.")
        data = GlobalProductProjectionDetail.model_validate(p).model_dump(mode="json")

    elif entity_lower in ("inquiry", "inquiries"):
        p = await service.inquiry_projection_repository.get_by_id(projection_id)
        if p is None or p.source_erp_id not in allowed_erp_ids:
            raise NotFoundException(f"No inquiry projection found with id {projection_id}.")
        data = GlobalInquiryProjectionDetail.model_validate(p).model_dump(mode="json")

    else:
        raise ValidationException(f"Unsupported projection entity type: {entity_type}")

    return build_success_response(data, request_id=_request_id(request))


# Backward compatibility route
@router.get("/projections/buyers/{projection_id}", summary="Get detailed single buyer projection")
async def get_buyer_projection(
    request: Request,
    projection_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    service: SearchService = Depends(get_search_service),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    return await get_projection_detail(
        request=request,
        entity_type="buyer",
        projection_id=projection_id,
        principal=principal,
        service=service,
        db=db,
    )


# ---------------------------------------------------------------------------
# Projection Rebuild
# ---------------------------------------------------------------------------


@router.post("/projections/rebuild", summary="Rebuild global projections")
async def rebuild_projections(
    request: Request,
    principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.projection.rebuild")),
    service: ProjectionService = Depends(get_projection_service),
) -> dict:
    summary = await service.rebuild()
    return build_success_response(summary, request_id=_request_id(request), message="Projections rebuild completed.")


@router.post("/projections/buyers/rebuild", summary="Rebuild global buyer projection (backward compatibility)")
async def rebuild_buyer_projection(
    request: Request,
    principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.projection.rebuild")),
    service: ProjectionService = Depends(get_projection_service),
) -> dict:
    summary = await service.rebuild()
    return build_success_response(summary, request_id=_request_id(request), message="Buyer projection rebuild completed.")


# ---------------------------------------------------------------------------
# Reports Catalog & Preview
# ---------------------------------------------------------------------------


@router.get("/reports/definitions", summary="List available report definitions")
async def list_report_definitions(
    request: Request,
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    engine: ReportEngine = Depends(get_report_engine),
) -> dict:
    reports = engine.list_reports()
    return build_success_response(
        [r.model_dump(mode="json") for r in reports],
        request_id=_request_id(request),
    )


@router.get("/reports/{report_key}/preview", summary="Preview report data")
async def preview_report(
    request: Request,
    report_key: str,
    query: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    engine: ReportEngine = Depends(get_report_engine),
    search_service: SearchService = Depends(get_search_service),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    all_erp_ids = await _all_erp_ids(db)
    allowed_erp_ids = all_erp_ids if principal.is_platform_admin else await search_service.resolve_allowed_erp_ids(
        principal.principal_id, all_erp_ids
    )

    filters = {"query": query, "status": status}
    preview = await engine.preview_report(report_key, filters=filters, allowed_erp_ids=allowed_erp_ids, limit=limit)
    return build_success_response(preview.model_dump(mode="json"), request_id=_request_id(request))


# ---------------------------------------------------------------------------
# Report Exports & Delivery
# ---------------------------------------------------------------------------


@router.post("/reports/export", status_code=status.HTTP_201_CREATED, summary="Request report export")
async def request_export(
    request: Request,
    payload: ExportRequest,
    principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.report.export")),
    service: ExportService = Depends(get_export_service),
) -> dict:
    job = await service.request_export(
        payload, requested_by=principal.principal_id, actor_label=principal.principal_label
    )
    return build_success_response(
        ExportJobRead.model_validate(job).model_dump(mode="json"),
        request_id=_request_id(request),
        message="Export requested. Poll GET /global/reports/export/{id} for status.",
    )


@router.post("/reports/export/{job_id}/process", summary="Execute and fulfill a pending export job")
async def process_export_job(
    request: Request,
    job_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.report.export")),
    service: ExportService = Depends(get_export_service),
) -> dict:
    job = await service.execute_export_job(job_id)
    return build_success_response(
        ExportJobRead.model_validate(job).model_dump(mode="json"),
        request_id=_request_id(request),
        message="Export job processed.",
    )


@router.get("/reports/export", summary="List requesting user's own export jobs")
async def list_export_jobs(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    service: ExportService = Depends(get_export_service),
) -> dict:
    jobs = await service.list_my_jobs(principal.principal_id)
    return build_success_response(
        [ExportJobRead.model_validate(j).model_dump(mode="json") for j in jobs[:limit]],
        request_id=_request_id(request),
    )


@router.get("/reports/export/{job_id}", summary="Fetch an export job's status")
async def get_export_job(
    request: Request,
    job_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    service: ExportService = Depends(get_export_service),
) -> dict:
    job = await service.get_job(job_id, requested_by=principal.principal_id)
    return build_success_response(
        ExportJobRead.model_validate(job).model_dump(mode="json"), request_id=_request_id(request)
    )


@router.get("/reports/export/{job_id}/download", summary="Download report export file")
async def download_export(
    request: Request,
    job_id: uuid.UUID,
    token: str | None = Query(default=None),
    service: ExportService = Depends(get_export_service),
) -> FileResponse:
    user_id = None
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.startswith("Bearer "):
        try:
            from app.platform_authz.security import decode_platform_token
            decoded = decode_platform_token(auth_header.split(" ")[1])
            sub = decoded.get("sub")
            if sub:
                user_id = uuid.UUID(sub)
        except Exception:
            pass

    file_path, content_type, filename = await service.resolve_export_download(
        job_id=job_id, download_token=token, user_id=user_id
    )

    return FileResponse(
        path=file_path,
        media_type=content_type,
        filename=filename,
    )


@router.post("/reports/export/cleanup", summary="Prune expired report export files")
async def cleanup_expired_exports(
    request: Request,
    principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.report.export")),
    service: ExportCleanupService = Depends(get_export_cleanup_service),
) -> dict:
    summary = await service.prune_expired_exports()
    return build_success_response(summary, request_id=_request_id(request), message="Expired exports pruned.")


# ---------------------------------------------------------------------------
# Dashboard & Health
# ---------------------------------------------------------------------------


@router.get("/dashboard", summary="Platform dashboard summary")
async def get_dashboard(
    request: Request,
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    service: DashboardService = Depends(get_dashboard_service),
) -> dict:
    dashboard = await service.get_dashboard()
    return build_success_response(dashboard.model_dump(mode="json"), request_id=_request_id(request))


@router.get("/health/erps/{erp_id}", summary="Single ERP's health summary")
async def get_erp_health(
    request: Request,
    erp_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    service: DashboardService = Depends(get_dashboard_service),
) -> dict:
    erp = await service.erp_instance_repository.get_by_id(erp_id)
    if erp is None:
        raise NotFoundException(f"No ERP instance found with id {erp_id}.")
    health = await service.get_erp_health(erp)
    return build_success_response(health.model_dump(mode="json"), request_id=_request_id(request))


@router.get("/health/subsystems", summary="Subsystem health status across control plane")
async def get_subsystems_health(
    request: Request,
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    service: HealthService = Depends(get_health_service),
) -> dict:
    health = await service.check_subsystems()
    return build_success_response(health.model_dump(mode="json"), request_id=_request_id(request))


# ---------------------------------------------------------------------------
# Operations, Metrics & Reconciliation
# ---------------------------------------------------------------------------


@router.get("/metrics", summary="Real point-in-time operations metrics")
async def get_metrics(
    request: Request,
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    service: MetricsService = Depends(get_metrics_service),
) -> dict:
    metrics = await service.get_metrics()
    return build_success_response(metrics.model_dump(mode="json"), request_id=_request_id(request))


@router.post("/reconciliation/erps/{erp_id}", summary="Run reconciliation pass for an ERP")
async def reconcile_erp(
    request: Request,
    erp_id: uuid.UUID,
    entity_type: str | None = Query(default=None, description="Optional entity to reconcile (buyer, supplier, product, inquiry)"),
    principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.reconciliation.execute")),
    service: ReconciliationService = Depends(get_reconciliation_service),
) -> dict:
    result = await service.reconcile_erp(
        erp_id,
        actor_id=principal.principal_id,
        actor_label=principal.principal_label,
        entity_type=entity_type,
    )
    return build_success_response(result.model_dump(mode="json"), request_id=_request_id(request))
