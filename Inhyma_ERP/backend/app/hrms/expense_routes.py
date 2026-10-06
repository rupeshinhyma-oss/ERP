"""
HRMS Expense Management Endpoints.

Mounts under ``/api/v1/hrms/expenses``:
- List & search expense claims (My Expenses vs Approvals)
- Summary statistics (GET /hrms/expenses/summary)
- Create expense claim (Save Draft or Direct Submit)
- Upload receipt attachment (POST /hrms/expenses/upload-receipt)
- Get expense claim by ID
- Update draft expense (PUT /hrms/expenses/{id})
- Delete / Cancel draft expense (DELETE /hrms/expenses/{id})
- Submit draft expense (POST /hrms/expenses/{id}/submit)
- Approve expense claim (POST /hrms/expenses/{id}/approve)
- Reject expense claim (POST /hrms/expenses/{id}/reject)
- Mark reimbursed (POST /hrms/expenses/{id}/reimburse)
"""

from __future__ import annotations

from datetime import date
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.storage import save_uploaded_file
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.hrms.expense_service import HrmsExpenseService
from app.hrms.rbac import HrmsUserContext, get_hrms_user_context
from app.hrms.schemas import (
    ExpenseCreate,
    ExpenseRead,
    ExpenseRejectPayload,
    ExpenseReimbursePayload,
    ExpenseSummaryRead,
    ExpenseUpdate,
)

router = APIRouter(prefix="/hrms/expenses", tags=["HRMS - Expenses"])


def get_expense_service(db: AsyncSession = Depends(get_db_session)) -> HrmsExpenseService:
    return HrmsExpenseService(db)


# ===========================================================================
# 1. Summary Statistics
# ===========================================================================

@router.get("/summary", summary="Get expense summary metrics")
async def get_expense_summary(
    view_mode: str = Query(default="my", description="'my' for employee self-service, 'approvals' for organization"),
    service: HrmsExpenseService = Depends(get_expense_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("expenses")
    is_approver = ctx.is_admin or ctx.is_hr or ctx.is_manager
    allowed_ids = None if (ctx.is_admin or ctx.is_hr) else ctx.managed_employee_ids

    summary = await service.get_summary(
        current_user_id=ctx.user_id,
        is_admin=ctx.is_admin or ctx.is_hr,
        view_mode=view_mode,
        is_approver=is_approver,
        allowed_employee_ids=allowed_ids,
    )
    return build_success_response(
        data=summary.model_dump(mode="json"),
        message="Expense summary retrieved successfully.",
    )


# ===========================================================================
# 2. Receipt Attachment Upload
# ===========================================================================

@router.post("/upload-receipt", summary="Upload receipt file attachment")
async def upload_expense_receipt(
    file: UploadFile = File(...),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("expenses")
    content = await file.read()
    public_url, stored_name = await save_uploaded_file(
        content=content,
        original_filename=file.filename or "receipt.pdf",
        bucket="expense-receipts",
        local_subfolder="expenses",
        content_type=file.content_type,
    )
    return build_success_response(
        data={
            "file_url": public_url,
            "file_name": file.filename or stored_name,
            "file_size": len(content),
            "file_type": file.content_type or "application/octet-stream",
        },
        message="Receipt uploaded successfully.",
    )


# ===========================================================================
# 3. List Expenses
# ===========================================================================

@router.get("", summary="List expenses with filtering and scoping")
async def list_expenses(
    view_mode: str = Query(default="my", description="'my' or 'approvals'"),
    search: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    service: HrmsExpenseService = Depends(get_expense_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("expenses")
    is_approver = ctx.is_admin or ctx.is_hr or ctx.is_manager
    allowed_ids = None if (ctx.is_admin or ctx.is_hr) else ctx.managed_employee_ids

    expenses = await service.list_expenses(
        current_user_id=ctx.user_id,
        is_admin=ctx.is_admin or ctx.is_hr,
        view_mode=view_mode,
        search=search,
        status_filter=status,
        category=category,
        start_date=start_date,
        end_date=end_date,
        skip=skip,
        limit=limit,
        is_approver=is_approver,
        allowed_employee_ids=allowed_ids,
    )
    data = [service.to_read_dto(e).model_dump(mode="json") for e in expenses]
    return build_success_response(
        data=data,
        message="Expenses retrieved successfully.",
    )


# ===========================================================================
# 4. Create Expense
# ===========================================================================

@router.post("", status_code=status.HTTP_201_CREATED, summary="Create expense claim")
async def create_expense(
    payload: ExpenseCreate,
    submit: bool = Query(default=False, description="Set True to directly submit as PENDING"),
    service: HrmsExpenseService = Depends(get_expense_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("expenses")
    # Backend strictly sets employee_id to the authenticated caller
    exp = await service.create_expense(employee_id=ctx.user_id, payload=payload, is_submit=submit)
    dto = service.to_read_dto(exp)
    return build_success_response(
        data=dto.model_dump(mode="json"),
        message="Expense claim created successfully.",
    )


# ===========================================================================
# 5. Get Expense by ID
# ===========================================================================

@router.get("/{expense_id}", summary="Get expense detail by ID")
async def get_expense_by_id(
    expense_id: uuid.UUID,
    service: HrmsExpenseService = Depends(get_expense_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("expenses")
    allowed_ids = None if (ctx.is_admin or ctx.is_hr) else ctx.managed_employee_ids
    exp = await service.get_expense(
        expense_id=expense_id,
        current_user_id=ctx.user_id,
        is_admin=ctx.is_admin or ctx.is_hr,
        allowed_employee_ids=allowed_ids,
    )
    dto = service.to_read_dto(exp)
    return build_success_response(
        data=dto.model_dump(mode="json"),
        message="Expense claim retrieved successfully.",
    )


# ===========================================================================
# 6. Update Draft Expense
# ===========================================================================

@router.put("/{expense_id}", summary="Update draft expense")
async def update_expense(
    expense_id: uuid.UUID,
    payload: ExpenseUpdate,
    service: HrmsExpenseService = Depends(get_expense_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("expenses")
    exp = await service.update_expense(
        expense_id=expense_id,
        current_user_id=ctx.user_id,
        is_admin=ctx.is_admin,
        payload=payload,
    )
    dto = service.to_read_dto(exp)
    return build_success_response(
        data=dto.model_dump(mode="json"),
        message="Expense claim updated successfully.",
    )


# ===========================================================================
# 7. Delete / Cancel Draft Expense
# ===========================================================================

@router.delete("/{expense_id}", summary="Delete draft expense")
async def delete_expense(
    expense_id: uuid.UUID,
    service: HrmsExpenseService = Depends(get_expense_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("expenses")
    await service.delete_expense(expense_id=expense_id, current_user_id=ctx.user_id, is_admin=ctx.is_admin)
    return build_success_response(
        data={"deleted": True, "id": str(expense_id)},
        message="Expense claim deleted successfully.",
    )


# ===========================================================================
# 8. Submit Draft Expense
# ===========================================================================

@router.post("/{expense_id}/submit", summary="Submit draft expense claim")
async def submit_expense(
    expense_id: uuid.UUID,
    service: HrmsExpenseService = Depends(get_expense_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("expenses")
    exp = await service.submit_expense(expense_id=expense_id, current_user_id=ctx.user_id, is_admin=ctx.is_admin)
    dto = service.to_read_dto(exp)
    return build_success_response(
        data=dto.model_dump(mode="json"),
        message="Expense claim submitted successfully for approval.",
    )


# ===========================================================================
# 9. Approve Expense
# ===========================================================================

@router.post("/{expense_id}/approve", summary="Approve pending expense claim")
async def approve_expense(
    expense_id: uuid.UUID,
    service: HrmsExpenseService = Depends(get_expense_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("expenses")
    is_approver = ctx.is_admin or ctx.is_hr or ctx.is_manager
    allowed_ids = None if (ctx.is_admin or ctx.is_hr) else ctx.managed_employee_ids

    exp = await service.approve_expense(
        expense_id=expense_id,
        reviewer_id=ctx.user_id,
        is_admin=ctx.is_admin or ctx.is_hr,
        is_approver=is_approver,
        allowed_employee_ids=allowed_ids,
    )
    dto = service.to_read_dto(exp)
    return build_success_response(
        data=dto.model_dump(mode="json"),
        message="Expense claim approved successfully.",
    )


# ===========================================================================
# 10. Reject Expense
# ===========================================================================

@router.post("/{expense_id}/reject", summary="Reject pending expense claim")
async def reject_expense(
    expense_id: uuid.UUID,
    payload: ExpenseRejectPayload,
    service: HrmsExpenseService = Depends(get_expense_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("expenses")
    is_approver = ctx.is_admin or ctx.is_hr or ctx.is_manager
    allowed_ids = None if (ctx.is_admin or ctx.is_hr) else ctx.managed_employee_ids

    exp = await service.reject_expense(
        expense_id=expense_id,
        reviewer_id=ctx.user_id,
        is_admin=ctx.is_admin or ctx.is_hr,
        rejection_reason=payload.rejection_reason,
        is_approver=is_approver,
        allowed_employee_ids=allowed_ids,
    )
    dto = service.to_read_dto(exp)
    return build_success_response(
        data=dto.model_dump(mode="json"),
        message="Expense claim rejected successfully.",
    )


# ===========================================================================
# 11. Reimburse Expense
# ===========================================================================

@router.post("/{expense_id}/reimburse", summary="Mark approved expense as reimbursed")
async def reimburse_expense(
    expense_id: uuid.UUID,
    payload: ExpenseReimbursePayload = ExpenseReimbursePayload(),
    service: HrmsExpenseService = Depends(get_expense_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("expenses")
    if not (ctx.is_admin or ctx.is_hr):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin or HR can mark expenses as reimbursed.",
        )

    exp = await service.reimburse_expense(
        expense_id=expense_id,
        user_id=ctx.user_id,
        is_admin=True,
        notes=payload.notes,
    )
    dto = service.to_read_dto(exp)
    return build_success_response(
        data=dto.model_dump(mode="json"),
        message="Expense claim marked as reimbursed successfully.",
    )
