"""API routes for the Financial Planning Report module."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import CurrentUser
from app.common.storage import save_uploaded_file
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.financial_planning.schemas import (
    FinancialPlanningAttachmentUpdate,
    FinancialPlanningPaymentRecord,
    FinancialPlanningTermsUpdate,
)
from app.financial_planning.service import FinancialPlanningService
from app.rbac.dependencies import require_any_permission

router = APIRouter(prefix="/financial-planning", tags=["Reports - Financial Planning"])

_VIEW_PERMS = (
    "report.view",
    "purchase.view",
    "saleorder.view",
    "saleorder.accounts",
    "saleorder.approve",
)

_WRITE_PERMS = (
    "report.view",
    "purchase.view",
    "purchase.create",
    "purchase.update",
    "localpurchase.update",
    "importpurchase.update",
    "saleorder.accounts",
    "saleorder.update",
    "saleorder.approve",
)


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def _actor_name(user: CurrentUser) -> str:
    return (
        getattr(user, "full_name", None)
        or getattr(user, "username", None)
        or getattr(user, "email", None)
        or "Finance User"
    )


def get_financial_planning_service(
    session: AsyncSession = Depends(get_db_session),
) -> FinancialPlanningService:
    return FinancialPlanningService(session)


@router.get("", summary="List live Financial Planning Report entries across confirmed modules")
async def list_financial_planning_report(
    request: Request,
    service: FinancialPlanningService = Depends(get_financial_planning_service),
    _current_user: CurrentUser = Depends(require_any_permission(*_VIEW_PERMS)),
) -> dict[str, Any]:
    data = await service.list_report()
    return build_success_response(data=data, request_id=_rid(request))


@router.post("/upload", summary="Upload an invoice or payment attachment for Financial Planning")
async def upload_financial_planning_file(
    request: Request,
    file: UploadFile = File(...),
    _current_user: CurrentUser = Depends(require_any_permission(*_WRITE_PERMS)),
) -> dict[str, Any]:
    content = await file.read()
    original_name = file.filename or "attachment.pdf"
    file_url, stored_name = await save_uploaded_file(
        content=content,
        original_filename=original_name,
        bucket="financial-planning",
        local_subfolder="financial_planning",
        content_type=file.content_type,
    )
    return build_success_response(
        data={
            "file_url": file_url,
            "file_name": file.filename or stored_name,
        },
        message="Attachment uploaded.",
        request_id=_rid(request),
    )


@router.patch(
    "/entries/{entry_key}/terms",
    summary="Update Payment Terms, Due Date, and Remarks on a Financial Planning entry",
)
async def update_entry_terms(
    entry_key: str,
    payload: FinancialPlanningTermsUpdate,
    request: Request,
    service: FinancialPlanningService = Depends(get_financial_planning_service),
    current_user: CurrentUser = Depends(require_any_permission(*_WRITE_PERMS)),
) -> dict[str, Any]:
    record = await service.update_terms(entry_key, payload, actor_name=_actor_name(current_user))
    return build_success_response(
        data=record,
        message="Payment terms updated.",
        request_id=_rid(request),
    )


@router.post(
    "/entries/{entry_key}/record-payment",
    summary="Record a partial or full payment against a Financial Planning entry",
)
async def record_entry_payment(
    entry_key: str,
    payload: FinancialPlanningPaymentRecord,
    request: Request,
    service: FinancialPlanningService = Depends(get_financial_planning_service),
    current_user: CurrentUser = Depends(require_any_permission(*_WRITE_PERMS)),
) -> dict[str, Any]:
    record = await service.record_payment(entry_key, payload, actor_name=_actor_name(current_user))
    return build_success_response(
        data=record,
        message="Payment recorded.",
        request_id=_rid(request),
    )


@router.patch(
    "/entries/{entry_key}/attachment",
    summary="Attach an invoice or payment voucher URL to a Financial Planning entry",
)
async def update_entry_attachment(
    entry_key: str,
    payload: FinancialPlanningAttachmentUpdate,
    request: Request,
    service: FinancialPlanningService = Depends(get_financial_planning_service),
    current_user: CurrentUser = Depends(require_any_permission(*_WRITE_PERMS)),
) -> dict[str, Any]:
    record = await service.update_attachment(entry_key, payload, actor_name=_actor_name(current_user))
    return build_success_response(
        data=record,
        message="Attachment saved.",
        request_id=_rid(request),
    )

