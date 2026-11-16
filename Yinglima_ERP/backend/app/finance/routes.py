"""
API Routes for the Financial Report & Payment Planner Module.
"""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.rbac.dependencies import require_any_permission, require_permission
from app.core.logging import get_logger
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.finance.schemas import (
    ConsignmentChecklistUpdatePayload,
    FinanceMetaUpdate,
    FinancePaymentCreate,
    SourceTypeLiteral,
    StageLiteral,
    VatReturnManualCreatePayload,
    VatReturnReceiptCreate,
    VatReturnStageFilterLiteral,
    VatReturnUpdatePayload,
)
from app.finance.service import FinanceService

logger = get_logger(__name__)

router = APIRouter(prefix="/finance", tags=["Finance - Financial Report & Payment Planner"])


def get_service(session: AsyncSession = Depends(get_db_session)) -> FinanceService:
    return FinanceService(session)


@router.get("/report", summary="Get full Financial Report for confirmed Local Purchases and Sale Orders")
async def get_financial_report(
    request: Request,
    stage: StageLiteral = Query(default="all", description="Filter by stage: pending | cleared | all"),
    search: str | None = Query(default=None),
    party_name: str | None = Query(default=None),
    consignment_code: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    current_user: CurrentUser = Depends(require_permission("finance_report.view")),
    service: FinanceService = Depends(get_service),
):
    report = await service.get_report(
        stage=stage,
        search=search,
        party_name=party_name,
        consignment_code=consignment_code,
        date_from=date_from,
        date_to=date_to,
    )
    return build_success_response(
        data=report.model_dump(mode="json"),
        message="Financial report fetched successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post(
    "/{source_type}/{source_id}/payments",
    status_code=status.HTTP_201_CREATED,
    summary="Record a payment installment (advance, partial, or full) against a Local Purchase or Sale Order",
)
async def add_payment(
    request: Request,
    source_type: SourceTypeLiteral,
    source_id: uuid.UUID,
    payload: FinancePaymentCreate,
    current_user: CurrentUser = Depends(require_permission("finance_report.create")),
    service: FinanceService = Depends(get_service),
):
    payment = await service.add_payment(
        source_type=source_type,
        source_id=source_id,
        payload=payload,
        user_id=current_user.id,
        user_name=getattr(current_user, "full_name", None) or getattr(current_user, "email", None),
    )
    return build_success_response(
        data=payment.model_dump(mode="json"),
        message="Payment recorded successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get(
    "/{source_type}/{source_id}/payments",
    summary="List all recorded payment installments for a Local Purchase or Sale Order",
)
async def list_payments(
    request: Request,
    source_type: SourceTypeLiteral,
    source_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission("finance_report.view")),
    service: FinanceService = Depends(get_service),
):
    payments = await service.list_payments(source_type=source_type, source_id=source_id)
    return build_success_response(
        data=[p.model_dump(mode="json") for p in payments],
        message="Payment history fetched successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.delete(
    "/payments/{payment_id}",
    summary="Delete a recorded payment installment and recalculate balance",
)
async def delete_payment(
    request: Request,
    payment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission("finance_report.delete")),
    service: FinanceService = Depends(get_service),
):
    await service.delete_payment(payment_id=payment_id)
    return build_success_response(
        data={"deleted": True, "id": str(payment_id)},
        message="Payment installment deleted and balance recalculated.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.patch(
    "/{source_type}/{source_id}/meta",
    summary="Update financial schedule, payment terms, due date, or agent freight bill info",
)
async def update_finance_meta(
    request: Request,
    source_type: SourceTypeLiteral,
    source_id: uuid.UUID,
    payload: FinanceMetaUpdate,
    current_user: CurrentUser = Depends(require_permission("finance_report.update")),
    service: FinanceService = Depends(get_service),
):
    updated = await service.update_meta(
        source_type=source_type,
        source_id=source_id,
        payload=payload,
        user_id=current_user.id,
        user_name=getattr(current_user, "full_name", None) or getattr(current_user, "email", None),
    )
    return build_success_response(
        data=updated,
        message="Financial metadata updated successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/export", summary="Export multi-sheet Financial Planner Excel workbook")
async def export_financial_report(
    format: str = Query(default="xlsx"),
    stage: StageLiteral = Query(default="all"),
    search: str | None = Query(default=None),
    party_name: str | None = Query(default=None),
    consignment_code: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    current_user: CurrentUser = Depends(require_permission("finance_report.export")),
    service: FinanceService = Depends(get_service),
):
    excel_bytes = await service.export_excel(
        stage=stage,
        search=search,
        party_name=party_name,
        consignment_code=consignment_code,
        date_from=date_from,
        date_to=date_to,
    )
    filename = f"Financial_Planner_Report_{date.today().isoformat()}.xlsx"
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ==============================================================================
# Consignment Overview Endpoints (Finance Planning + Gallery + Cargo Status)
# ==============================================================================

@router.get(
    "/consignment-overview",
    summary="List all Consignment Overview records (combining Finance Planning, Document Gallery, and Cargo Status)",
)
async def list_consignment_overviews(
    request: Request,
    stage: StageLiteral = Query(default="all", description="Filter by stage: pending | cleared | all"),
    search: str | None = Query(default=None),
    branch_name: str | None = Query(default=None),
    current_user: CurrentUser = Depends(require_permission("consignment_overview.view")),
    service: FinanceService = Depends(get_service),
):
    result = await service.list_consignment_overviews(
        stage=stage,
        search=search,
        branch_name=branch_name,
    )
    return build_success_response(
        data=result.model_dump(mode="json"),
        message="Consignment overviews fetched successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get(
    "/consignment-overview/detail",
    summary="Get single Consignment Overview detail by consignment_key",
)
async def get_consignment_overview_detail(
    request: Request,
    key: str = Query(..., description="Consignment key (e.g. 'MUM 51' or 'LP:INV-384')"),
    current_user: CurrentUser = Depends(require_permission("consignment_overview.view")),
    service: FinanceService = Depends(get_service),
):
    row = await service.get_consignment_overview(consignment_key=key)
    return build_success_response(
        data=row.model_dump(mode="json"),
        message="Consignment overview detail fetched successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.patch(
    "/consignment-overview/checklist",
    summary="Update Cargo Status shipment checklist toggles (Yes/No), remarks, or ETD/ETA dates",
)
async def update_consignment_checklist(
    request: Request,
    payload: ConsignmentChecklistUpdatePayload,
    key: str = Query(..., description="Consignment key"),
    current_user: CurrentUser = Depends(require_permission("consignment_overview.cargo_status.edit")),
    service: FinanceService = Depends(get_service),
):
    updated = await service.update_consignment_checklist(
        consignment_key=key,
        payload=payload,
        user_id=current_user.id,
        user_name=getattr(current_user, "full_name", None) or getattr(current_user, "email", None),
    )
    return build_success_response(
        data=updated,
        message="Cargo status checklist updated successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post(
    "/consignment-overview/documents",
    status_code=status.HTTP_201_CREATED,
    summary="Upload a document file to a Consignment Gallery slot in Supabase Storage",
)
async def upload_consignment_document(
    request: Request,
    key: str = Query(..., description="Consignment key"),
    slot_key: str = Query(..., description="Document slot key (e.g. 'proforma_invoice', 'final_bl')"),
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_permission("consignment_overview.gallery.upload")),
    service: FinanceService = Depends(get_service),
):
    file_bytes = await file.read()
    slot = await service.upload_consignment_document(
        consignment_key=key,
        slot_key=slot_key,
        file_bytes=file_bytes,
        filename=file.filename or f"{slot_key}.pdf",
        content_type=file.content_type,
        user_id=current_user.id,
        user_name=getattr(current_user, "full_name", None) or getattr(current_user, "email", None),
    )
    return build_success_response(
        data=slot.model_dump(mode="json"),
        message="Consignment document uploaded to Supabase Storage.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.delete(
    "/consignment-overview/documents",
    summary="Delete a manually uploaded document from a Consignment Gallery slot",
)
async def delete_consignment_document(
    request: Request,
    key: str = Query(..., description="Consignment key"),
    slot_key: str = Query(..., description="Document slot key"),
    current_user: CurrentUser = Depends(require_permission("consignment_overview.gallery.delete")),
    service: FinanceService = Depends(get_service),
):
    res = await service.delete_consignment_document(
        consignment_key=key,
        slot_key=slot_key,
        user_id=current_user.id,
        user_name=getattr(current_user, "full_name", None) or getattr(current_user, "email", None),
    )
    return build_success_response(
        data=res,
        message="Consignment document removed.",
        request_id=getattr(request.state, "request_id", "-"),
    )


# ==============================================================================
# VAT Return (China Export Tax Rebate / 出口退税) Endpoints
# ==============================================================================


@router.get(
    "/vat-returns",
    summary="List all China Export VAT Return records (live Confirmed Sales Process orders + imported EXP rows)",
)
async def list_vat_returns(
    request: Request,
    stage: VatReturnStageFilterLiteral = Query(
        default="all",
        description="Filter by stage: all | pending | partial | received | no_vat",
    ),
    financial_year: str | None = Query(default=None, description="Financial year e.g. 2025-2026"),
    search: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    current_user: CurrentUser = Depends(require_permission("vat_return.view")),
    service: FinanceService = Depends(get_service),
):
    res = await service.list_vat_returns(
        stage=stage,
        financial_year=financial_year,
        search=search,
        date_from=date_from,
        date_to=date_to,
    )
    return build_success_response(
        data=res.model_dump(mode="json"),
        message="VAT return records fetched successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post(
    "/vat-returns/manual",
    status_code=status.HTTP_201_CREATED,
    summary="Create a manual / standalone EXP VAT Return entry",
)
async def create_manual_vat_return(
    request: Request,
    payload: VatReturnManualCreatePayload,
    current_user: CurrentUser = Depends(require_permission("vat_return.create")),
    service: FinanceService = Depends(get_service),
):
    res = await service.create_manual_vat_return(
        payload=payload,
        user_id=current_user.id,
        user_name=getattr(current_user, "full_name", None) or getattr(current_user, "email", None),
    )
    return build_success_response(
        data=res,
        message="VAT Return entry created successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.patch(
    "/vat-returns/record",
    summary="Update VAT Return metadata, filing date, status override, remarks, or product breakdown items",
)
async def update_vat_return_record(
    request: Request,
    payload: VatReturnUpdatePayload,
    key: str = Query(..., description="Record key (e.g. 'SO:<uuid>' or 'VR:<uuid>' or EXP No.)"),
    current_user: CurrentUser = Depends(require_permission("vat_return.update")),
    service: FinanceService = Depends(get_service),
):
    res = await service.update_vat_return(
        record_key=key,
        payload=payload,
        user_id=current_user.id,
        user_name=getattr(current_user, "full_name", None) or getattr(current_user, "email", None),
    )
    return build_success_response(
        data=res,
        message="VAT Return record updated successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post(
    "/vat-returns/receipts",
    status_code=status.HTTP_201_CREATED,
    summary="Record a full or partial VAT refund receipt from the China Tax Bureau",
)
async def add_vat_return_receipt(
    request: Request,
    payload: VatReturnReceiptCreate,
    key: str = Query(..., description="Record key (e.g. 'SO:<uuid>' or 'VR:<uuid>')"),
    current_user: CurrentUser = Depends(require_permission("vat_return.receipt")),
    service: FinanceService = Depends(get_service),
):
    rec = await service.add_vat_receipt(
        record_key=key,
        payload=payload,
        user_id=current_user.id,
        user_name=getattr(current_user, "full_name", None) or getattr(current_user, "email", None),
    )
    return build_success_response(
        data=rec.model_dump(mode="json"),
        message="VAT refund receipt recorded successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.delete(
    "/vat-returns/receipts/{receipt_id}",
    summary="Delete a recorded VAT refund receipt and recalculate balance",
)
async def delete_vat_return_receipt(
    request: Request,
    receipt_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission("vat_return.receipt")),
    service: FinanceService = Depends(get_service),
):
    res = await service.delete_vat_receipt(receipt_id=receipt_id)
    return build_success_response(
        data=res,
        message="VAT refund receipt deleted and balance recalculated.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get(
    "/vat-returns/sample-csv",
    summary="Download sample CSV template for importing VAT Return records",
)
async def download_vat_returns_sample_csv(
    current_user: CurrentUser = Depends(require_any_permission("vat_return.view", "vat_return.import")),
    service: FinanceService = Depends(get_service),
):
    csv_bytes = service.generate_vat_returns_sample_csv()
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="vat_return_sample.csv"'},
    )


@router.post(
    "/vat-returns/import",
    summary="Import VAT Return records from Excel (.xlsx) or CSV (.csv) file",
)
async def import_vat_returns_file(
    request: Request,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_permission("vat_return.import")),
    service: FinanceService = Depends(get_service),
):
    file_bytes = await file.read()
    res = await service.import_vat_returns_file(
        file_bytes=file_bytes,
        filename=file.filename or "import.xlsx",
        user_id=current_user.id,
        user_name=getattr(current_user, "full_name", None) or getattr(current_user, "email", None),
    )
    return build_success_response(
        data=res,
        message=f"Imported {res['total_processed']} VAT Return records ({res['created']} new, {res['updated']} updated).",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get(
    "/vat-returns/export",
    summary="Export 2-sheet VAT Return Summary & Product Breakdown Excel workbook",
)
async def export_vat_returns_excel(
    stage: VatReturnStageFilterLiteral = Query(default="all"),
    financial_year: str | None = Query(default=None),
    search: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    current_user: CurrentUser = Depends(require_permission("vat_return.export")),
    service: FinanceService = Depends(get_service),
):
    excel_bytes = await service.export_vat_returns_excel(
        stage=stage,
        financial_year=financial_year,
        search=search,
        date_from=date_from,
        date_to=date_to,
    )
    filename = f"Yinglima_VAT_Return_Report_{date.today().isoformat()}.xlsx"
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


