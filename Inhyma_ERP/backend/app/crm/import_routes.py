"""
CRM CSV Lead Import Routes.

Endpoints under /crm/import:
- GET /crm/import/template: Download sample CSV template.
- POST /crm/import/preview: Parse, validate, normalize, detect duplicates, and preview without writing.
- POST /crm/import/confirm: Atomic transactional execution of lead import and batch creation.
- GET /crm/import/batches: List import batches within caller's permitted scope.
- GET /crm/import/batches/{batch_id}: Get specific import batch detail and error summary.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile, status

from app.audit.constants import AuditAction
from app.audit.dependencies import get_audit_service
from app.audit.service import AuditService
from app.auth.service import CurrentUser
from app.core.exceptions import BadRequestException
from app.core.logging import get_logger
from app.core.responses import build_success_response
from app.crm.dependencies import get_crm_import_service
from app.crm.import_service import CrmImportService
from app.rbac.dependencies import require_any_permission

router = APIRouter(prefix="/crm/import", tags=["CRM Lead Import"])
logger = get_logger(__name__)


async def _record_import_audit(
    *,
    audit_service: AuditService,
    request: Request,
    action: AuditAction,
    actor: CurrentUser,
    entity_id: uuid.UUID | str,
    description: str,
    new_values: dict | None = None,
) -> None:
    """Record an audit log entry for lead import operations."""
    await audit_service.record(
        action=action,
        module="crm",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="CrmImportBatch",
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


@router.get("/template", summary="Download sample CSV import template")
async def download_template(
    _current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.import", "crm.leads.manage", "crm.leads.view")
    ),
) -> Response:
    """Provide a standard CSV template for CRM lead imports."""
    csv_content = CrmImportService.generate_csv_template()
    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="inhyma_crm_leads_template.csv"',
            "Cache-Control": "no-cache",
        },
    )


@router.post("/preview", summary="Validate and preview CSV lead import")
async def preview_lead_import(
    request: Request,
    pipeline_id: uuid.UUID = Form(..., description="Target CRM pipeline UUID"),
    file: UploadFile = File(..., description="Uploaded CSV file"),
    service: CrmImportService = Depends(get_crm_import_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.import", "crm.leads.manage", "crm.leads.view")
    ),
) -> dict:
    """
    Validate uploaded CSV rows against destination pipeline, check existing CRM contacts,
    detect repeated contacts within the file, and return actionable validation metrics without saving.
    """
    raw_bytes = await file.read()
    preview = await service.preview_import(
        pipeline_id=pipeline_id,
        raw_bytes=raw_bytes,
        actor=current_user,
    )
    return build_success_response(
        data=preview.model_dump(),
        message="CSV preview generated successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/confirm", summary="Confirm and commit CRM lead import", status_code=status.HTTP_201_CREATED)
async def confirm_lead_import(
    request: Request,
    pipeline_id: uuid.UUID = Form(..., description="Target CRM pipeline UUID"),
    file: UploadFile = File(..., description="Uploaded CSV file"),
    batch_name: str | None = Form(default=None, description="Optional custom import batch name"),
    auto_assign: bool = Form(default=True, description="Whether to automatically distribute new leads via Assignment Engine"),
    distribution_mode: str = Form(default="default_rules", description="Distribution mode: default_rules, selected_reps, single_salesperson, none"),
    distribution_strategy: str | None = Form(default="round_robin", description="Distribution strategy for selected_reps: round_robin or least_active"),
    selected_salesperson_ids: str | None = Form(default=None, description="Comma-separated or JSON array of salesperson UUIDs"),
    target_salesperson_id: uuid.UUID | None = Form(default=None, description="Target salesperson UUID for single_salesperson mode"),
    service: CrmImportService = Depends(get_crm_import_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.import", "crm.leads.manage", "crm.leads.view")
    ),
) -> dict:
    """
    Execute transactional CRM lead import:
    - Creates valid non-duplicate leads in selected pipeline and its initial open stage.
    - Preserves existing leads, leaving ownership and stage unchanged, recording campaign attribution.
    - Distributes new leads according to the chosen distribution mode.
    - Persists batch metrics and row outcomes in CrmImportBatch.
    """
    raw_bytes = await file.read()

    parsed_selected_ids: list[uuid.UUID] | None = None
    if selected_salesperson_ids:
        raw_ids = selected_salesperson_ids.strip()
        if raw_ids.startswith("[") and raw_ids.endswith("]"):
            import json
            try:
                id_list = json.loads(raw_ids)
                parsed_selected_ids = [uuid.UUID(str(x)) for x in id_list]
            except Exception:
                raise BadRequestException("Invalid JSON format for selected_salesperson_ids.")
        else:
            try:
                parsed_selected_ids = [uuid.UUID(x.strip()) for x in raw_ids.split(",") if x.strip()]
            except Exception:
                raise BadRequestException("Invalid UUID format in selected_salesperson_ids.")

    result = await service.confirm_import(
        pipeline_id=pipeline_id,
        raw_bytes=raw_bytes,
        actor=current_user,
        batch_name=batch_name,
        auto_assign=auto_assign,
        distribution_mode=distribution_mode,
        distribution_strategy=distribution_strategy,
        selected_salesperson_ids=parsed_selected_ids,
        target_salesperson_id=target_salesperson_id,
    )

    await _record_import_audit(
        audit_service=audit_service,
        request=request,
        action=AuditAction.IMPORT,
        actor=current_user,
        entity_id=result.batch_id,
        description=f"Imported leads batch '{result.batch_name}': {result.success_count} created, {result.duplicate_skipped_count} duplicates skipped, {result.failed_count} failed.",
        new_values={
            "batch_id": str(result.batch_id),
            "batch_name": result.batch_name,
            "pipeline_id": str(result.pipeline_id),
            "total_rows": result.total_rows,
            "success_count": result.success_count,
            "duplicate_skipped_count": result.duplicate_skipped_count,
            "failed_count": result.failed_count,
            "assigned_count": result.assigned_count,
            "unassigned_count": result.unassigned_count,
        },
    )

    if result.failed_count > 0:
        if result.success_count == 0 and result.duplicate_skipped_count == 0:
            response_msg = f"Import failed: 0 leads created, {result.failed_count} rows failed."
        else:
            response_msg = f"Import completed with warnings: {result.success_count} leads created, {result.duplicate_skipped_count} skipped, {result.failed_count} rows failed."
    else:
        response_msg = f"Import completed: {result.success_count} leads created, {result.duplicate_skipped_count} skipped."

    return build_success_response(
        data=result.model_dump(),
        message=response_msg,
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/batches", summary="List lead import batches")
async def list_import_batches(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    service: CrmImportService = Depends(get_crm_import_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.import", "crm.leads.manage", "crm.leads.view")
    ),
) -> dict:
    """Retrieve history of CRM lead import batches within actor's permission scope."""
    batches = await service.list_batches(
        actor=current_user,
        limit=limit,
        offset=offset,
    )
    return build_success_response(
        data=[b.model_dump() for b in batches],
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/batches/{batch_id}", summary="Get lead import batch detail")
async def get_import_batch(
    request: Request,
    batch_id: uuid.UUID,
    service: CrmImportService = Depends(get_crm_import_service),
    current_user: CurrentUser = Depends(
        require_any_permission("crm.leads.import", "crm.leads.manage", "crm.leads.view")
    ),
) -> dict:
    """Retrieve details and row error summary for an individual lead import batch."""
    batch = await service.get_batch_by_id(batch_id, actor=current_user)
    return build_success_response(
        data=batch.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )
