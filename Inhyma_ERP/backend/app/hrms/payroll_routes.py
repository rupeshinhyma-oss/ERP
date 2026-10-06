"""
HRMS Payroll Endpoints.

Mounts under ``/api/v1/hrms/payroll``:
- Setup:
  - GET    /hrms/payroll/components
  - POST   /hrms/payroll/components
  - PUT    /hrms/payroll/components/{id}
  - DELETE /hrms/payroll/components/{id}
  - POST   /hrms/payroll/preview
- Salary:
  - GET    /hrms/payroll/employees
  - POST   /hrms/payroll/salary/assign
  - GET    /hrms/payroll/salary/history/{employee_id}
- Monthly Payroll:
  - POST   /hrms/payroll/calculate
  - GET    /hrms/payroll/monthly/{payroll_month}
  - POST   /hrms/payroll/approve
  - POST   /hrms/payroll/reopen
  - POST   /hrms/payroll/adjustments
  - GET    /hrms/payroll/adjustments
- Payslips:
  - GET    /hrms/payroll/payslips
  - GET    /hrms/payroll/payslips/{item_id}
"""

from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.hrms.models import HrmsMonthlyPayroll, HrmsMonthlyPayrollItem
from app.hrms.payroll_service import HrmsPayrollService
from app.hrms.rbac import HrmsUserContext, get_hrms_user_context
from app.hrms.schemas import (
    EmployeeSalaryAssignRequest,
    EmployeeSalaryRead,
    MonthlyPayrollCalculateRequest,
    MonthlyPayrollItemEditRequest,
    MonthlyPayrollItemRead,
    MonthlyPayrollRead,
    MonthlyPayrollReopenRequest,
    PayrollAdjustmentCreate,
    PayrollAdjustmentRead,
    PayrollComponentCreate,
    PayrollComponentRead,
    PayrollComponentUpdate,
    SalaryPreviewRequest,
    SalaryPreviewResponse,
)

router = APIRouter(prefix="/hrms/payroll", tags=["HRMS - Payroll"])


def get_payroll_service(db: AsyncSession = Depends(get_db_session)) -> HrmsPayrollService:
    return HrmsPayrollService(db)


# ===========================================================================
# TAB 1: Global Setup & Components
# ===========================================================================

@router.get("/components")
async def list_components(
    include_inactive: bool = Query(True),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """Retrieve global payroll components (Admin/HR only)."""
    ctx.require_module_access("payroll")
    if not (ctx.is_admin or ctx.is_hr):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Payroll component configuration is restricted to Admin and HR.",
        )

    components = await service.get_components(include_inactive=include_inactive)
    return build_success_response(
        data=[
            {
                "id": str(c.id),
                "name": c.name,
                "code": c.code,
                "component_type": c.component_type,
                "calculation_type": c.calculation_type,
                "calculation_basis": getattr(c, "calculation_basis", None),
                "value": c.value,
                "is_taxable": c.is_taxable,
                "is_statutory": c.is_statutory,
                "display_order": c.display_order,
                "is_active": c.is_active,
                "description": c.description,
            }
            for c in components
        ],
        message="Payroll components retrieved successfully.",
    )


@router.post("/components", status_code=status.HTTP_201_CREATED)
async def create_component(
    payload: PayrollComponentCreate,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """Admin/authorized HR: Create a new global payroll component."""
    ctx.require_module_access("payroll")
    if not ctx.can_configure_salary():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Salary configuration rights required.",
        )
    comp = await service.create_component(payload)
    return build_success_response(
        data={
            "id": str(comp.id),
            "name": comp.name,
            "code": comp.code,
            "component_type": comp.component_type,
            "calculation_type": comp.calculation_type,
            "calculation_basis": getattr(comp, "calculation_basis", None),
            "value": comp.value,
            "is_taxable": comp.is_taxable,
            "is_statutory": comp.is_statutory,
            "display_order": comp.display_order,
            "is_active": comp.is_active,
            "description": comp.description,
        },
        message="Payroll component created successfully.",
    )


@router.put("/components/{component_id}")
async def update_component(
    component_id: uuid.UUID,
    payload: PayrollComponentUpdate,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """Admin/authorized HR: Update an existing global payroll component."""
    ctx.require_module_access("payroll")
    if not ctx.can_configure_salary():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Salary configuration rights required.",
        )
    comp = await service.update_component(component_id, payload)
    return build_success_response(
        data={
            "id": str(comp.id),
            "name": comp.name,
            "code": comp.code,
            "component_type": comp.component_type,
            "calculation_type": comp.calculation_type,
            "calculation_basis": getattr(comp, "calculation_basis", None),
            "value": comp.value,
            "is_taxable": comp.is_taxable,
            "is_statutory": comp.is_statutory,
            "display_order": comp.display_order,
            "is_active": comp.is_active,
            "description": comp.description,
        },
        message="Payroll component updated successfully.",
    )


@router.delete("/components/{component_id}")
async def delete_component(
    component_id: uuid.UUID,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """Admin/authorized HR: Deactivate / soft delete a payroll component."""
    ctx.require_module_access("payroll")
    if not ctx.can_configure_salary():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Salary configuration rights required.",
        )
    res = await service.delete_component(component_id)
    return build_success_response(data=res, message="Payroll component deactivated successfully.")


@router.post("/preview")
async def preview_salary_structure(
    payload: SalaryPreviewRequest,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """Calculate live salary structure preview based strictly on active database components."""
    ctx.require_module_access("payroll")
    preview = await service.calculate_preview(payload.annual_ctc)
    return build_success_response(data=preview.model_dump(), message="Salary preview computed successfully.")


# ===========================================================================
# TAB 2: Employee Salaries & Revisions
# ===========================================================================

@router.get("/employees")
async def list_employee_salaries(
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """List employees with current active salary structure and revision count (RBAC scoped)."""
    ctx.require_module_access("payroll")
    if not (ctx.is_admin or ctx.is_hr or ctx.is_manager):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Employee salary master is restricted to HR and Managers.",
        )

    allowed_ids = None if (ctx.is_admin or ctx.is_hr) else ctx.managed_employee_ids
    salaries = await service.get_employee_salaries(allowed_employee_ids=allowed_ids)
    return build_success_response(data=salaries, message="Employee salaries retrieved successfully.")


@router.post("/salary/assign", status_code=status.HTTP_201_CREATED)
async def assign_salary(
    payload: EmployeeSalaryAssignRequest,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """Admin/authorized HR: Assign or revise salary structure with effective date."""
    ctx.require_module_access("payroll")
    if not ctx.can_configure_salary():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Only Admin or authorized HR can configure employee salary.",
        )

    salary = await service.assign_employee_salary(payload, ctx.user_id)
    return build_success_response(
        data={
            "id": str(salary.id),
            "employee_id": str(salary.employee_id),
            "annual_ctc": salary.annual_ctc,
            "monthly_ctc": salary.monthly_ctc,
            "effective_from": str(salary.effective_from),
            "is_active": salary.is_active,
            "structure_breakdown": salary.structure_breakdown,
            "notes": salary.notes,
        },
        message="Salary structure assigned successfully.",
    )


@router.get("/salary/history/{employee_id}")
async def get_salary_history(
    employee_id: uuid.UUID,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """Admin/HR/Manager: Retrieve salary revision history for an employee."""
    ctx.require_module_access("payroll")
    ctx.require_employee_access(employee_id)

    history = await service.get_salary_history(employee_id)
    return build_success_response(
        data=[
            {
                "id": str(h.id),
                "employee_id": str(h.employee_id),
                "annual_ctc": h.annual_ctc,
                "monthly_ctc": h.monthly_ctc,
                "effective_from": str(h.effective_from),
                "is_active": h.is_active,
                "structure_breakdown": h.structure_breakdown,
                "notes": h.notes,
                "created_at": h.created_at.isoformat() if h.created_at else None,
            }
            for h in history
        ],
        message="Salary revision history retrieved successfully.",
    )


# ===========================================================================
# TAB 3: Monthly Payroll & Approval
# ===========================================================================

import re

MONTH_REGEX = re.compile(r"^\d{4}-\d{2}$")


def _validate_payroll_month(month: Optional[str]) -> str:
    if not month or not month.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="payroll_month is required (format: YYYY-MM, e.g. 2026-10).",
        )
    cleaned = month.strip()
    if not MONTH_REGEX.match(cleaned):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid payroll_month '{cleaned}'. Format must be YYYY-MM (e.g. 2026-10).",
        )
    return cleaned


@router.post("/calculate")
@router.post("/monthly/{payroll_month}/calculate")
async def calculate_monthly_payroll(
    payroll_month: Optional[str] = None,
    payload: Optional[MonthlyPayrollCalculateRequest] = None,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """Admin/HR: Calculate and save monthly payroll snapshot for all eligible employees."""
    ctx.require_module_access("payroll")
    if not (ctx.is_admin or ctx.is_hr):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Only Admin or HR can calculate monthly payroll.",
        )

    raw_month = (payload.payroll_month if payload and payload.payroll_month else None) or payroll_month
    month = _validate_payroll_month(raw_month)

    payroll = await service.calculate_monthly_payroll(month, ctx.user_id)
    full_payroll = await service.get_monthly_payroll(month)
    return build_success_response(
        data=_serialize_payroll(full_payroll or payroll),
        message=f"Payroll for {month} calculated successfully.",
    )


@router.get("/monthly")
@router.get("/monthly/{payroll_month}")
async def get_monthly_payroll(
    payroll_month: Optional[str] = None,
    month_query: Optional[str] = Query(None, alias="payroll_month"),
    auto_calculate: bool = Query(True),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """Admin/HR/Manager: View monthly payroll review snapshot."""
    ctx.require_module_access("payroll")
    if not (ctx.is_admin or ctx.is_hr or ctx.is_manager):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Please view your approved payslips under My Payslips.",
        )

    raw_month = payroll_month or month_query
    month = _validate_payroll_month(raw_month)

    payroll = await service.get_monthly_payroll(month)
    if auto_calculate and (not payroll or payroll.status in ("DRAFT", "REVIEW", "PROCESSED")):
        if ctx.is_admin or ctx.is_hr:
            try:
                await service.calculate_monthly_payroll(month, ctx.user_id)
                payroll = await service.get_monthly_payroll(month)
            except Exception:
                pass

    if not payroll:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No payroll calculated yet for {month}. Click Calculate Payroll to process.",
        )

    allowed_ids = None if (ctx.is_admin or ctx.is_hr) else ctx.managed_employee_ids
    return build_success_response(
        data=_serialize_payroll(payroll, allowed_employee_ids=allowed_ids),
        message="Monthly payroll snapshot retrieved successfully.",
    )


@router.post("/approve")
@router.post("/monthly/{payroll_month}/approve")
async def approve_monthly_payroll(
    payroll_month: Optional[str] = None,
    payload: Optional[MonthlyPayrollCalculateRequest] = None,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """Admin/authorized HR: Approve monthly payroll and lock records."""
    ctx.require_module_access("payroll")
    if not ctx.can_approve_payroll():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Only Admin or HR with approval permission can approve payroll.",
        )

    raw_month = (payload.payroll_month if payload and payload.payroll_month else None) or payroll_month
    month = _validate_payroll_month(raw_month)

    payroll = await service.approve_monthly_payroll(month, ctx.user_id)
    return build_success_response(
        data={"payroll_month": payroll.payroll_month, "status": payroll.status},
        message=f"Payroll for {month} approved successfully.",
    )


@router.put("/items/{item_id}")
async def edit_payroll_item(
    item_id: uuid.UUID,
    payload: MonthlyPayrollItemEditRequest,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """Admin/HR: Edit an employee payroll item before approval with mandatory audit reason."""
    ctx.require_module_access("payroll")
    if not ctx.can_configure_salary():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Salary configuration rights required to edit payroll items.",
        )

    item = await service.edit_payroll_item(item_id, payload, ctx.user_id)
    parent_month = getattr(getattr(item, "payroll", None), "payroll_month", None)
    return build_success_response(
        data=_serialize_payroll_item(item, fallback_month=parent_month),
        message="Employee payroll record adjusted and recalculated successfully.",
    )


@router.post("/reopen")
@router.post("/monthly/{payroll_month}/reopen")
async def reopen_monthly_payroll(
    payroll_month: Optional[str] = None,
    payload: Optional[MonthlyPayrollReopenRequest] = None,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """Admin/authorized HR: Reopen an approved monthly payroll for corrections with audit history."""
    ctx.require_module_access("payroll")
    if not ctx.can_approve_payroll():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Only Admin or HR with approval permission can reopen payroll.",
        )

    raw_month = (payload.payroll_month if payload and payload.payroll_month else None) or payroll_month
    month = _validate_payroll_month(raw_month)
    reason = payload.reason if payload and getattr(payload, "reason", None) else "Reopened for review and corrections"
    payroll = await service.reopen_monthly_payroll(month, ctx.user_id, reason=reason)
    return build_success_response(
        data={"payroll_month": payroll.payroll_month, "status": payroll.status},
        message=f"Payroll for {month} reopened for adjustments.",
    )


@router.post("/adjustments", status_code=status.HTTP_201_CREATED)
async def create_adjustment(
    payload: PayrollAdjustmentCreate,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """Admin/HR: Add a one-off monthly bonus or deduction adjustment."""
    ctx.require_module_access("payroll")
    if not ctx.can_configure_salary():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Salary configuration rights required.",
        )

    adj = await service.create_adjustment(payload, ctx.user_id)
    return build_success_response(
        data={
            "id": str(adj.id),
            "employee_id": str(adj.employee_id),
            "payroll_month": adj.payroll_month,
            "adjustment_type": adj.adjustment_type,
            "title": adj.title,
            "amount": adj.amount,
            "reason": adj.reason,
            "created_at": adj.created_at.isoformat() if adj.created_at else None,
        },
        message="Monthly adjustment created successfully.",
    )


@router.get("/adjustments")
async def list_adjustments(
    payroll_month: Optional[str] = Query(None),
    employee_id: Optional[uuid.UUID] = Query(None),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """Admin/HR/Manager: List adjustments filtered by month and/or employee."""
    ctx.require_module_access("payroll")
    if not (ctx.is_admin or ctx.is_hr or ctx.is_manager):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied to view payroll adjustments.",
        )

    if employee_id:
        ctx.require_employee_access(employee_id)

    adjs = await service.get_adjustments(payroll_month=payroll_month, employee_id=employee_id)
    if not (ctx.is_admin or ctx.is_hr):
        adjs = [a for a in adjs if a.employee_id in ctx.managed_employee_ids]

    return build_success_response(
        data=[
            {
                "id": str(a.id),
                "employee_id": str(a.employee_id),
                "payroll_month": a.payroll_month,
                "adjustment_type": a.adjustment_type,
                "title": a.title,
                "amount": a.amount,
                "reason": a.reason,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in adjs
        ],
        message="Payroll adjustments retrieved successfully.",
    )


# ===========================================================================
# Employee Payslips & PDF Retrieval
# ===========================================================================

@router.get("/payslips")
async def get_payslips(
    payroll_month: Optional[str] = Query(None),
    employee_id: Optional[uuid.UUID] = Query(None),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """
    Retrieve payslips.
    - Employees can ONLY see their own APPROVED payslips.
    - Department Manager can see approved payslips for their department employees.
    - Admin/HR can see all payslips.
    """
    ctx.require_module_access("payroll")

    if not (ctx.is_admin or ctx.is_hr):
        if ctx.is_manager:
            if employee_id and employee_id not in ctx.managed_employee_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not have access to payslips of employees outside your department.",
                )
        else:
            if employee_id and employee_id != ctx.user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You can only access your own salary slips.",
                )

    target_emp_id = employee_id if (ctx.is_admin or ctx.is_hr or (ctx.is_manager and employee_id)) else ctx.user_id

    items = await service.get_employee_payslips(
        employee_id=target_emp_id,
        is_admin=ctx.is_admin or ctx.is_hr,
        payroll_month=payroll_month,
    )

    # For department manager viewing all dept payslips:
    if ctx.is_manager and not (ctx.is_admin or ctx.is_hr) and not employee_id:
        items = [i for i in items if i.employee_id in ctx.managed_employee_ids]

    # Non-admin non-HR callers must ONLY see APPROVED payslips
    if not (ctx.is_admin or ctx.is_hr):
        items = [i for i in items if i.status == "APPROVED"]

    return build_success_response(
        data=[_serialize_payroll_item(item) for item in items],
        message="Payslips retrieved successfully.",
    )


@router.get("/payslips/{item_id}")
async def get_payslip_detail(
    item_id: uuid.UUID,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsPayrollService = Depends(get_payroll_service),
):
    """Retrieve detailed payslip for view or PDF download with strict RBAC."""
    ctx.require_module_access("payroll")

    query = (
        select(HrmsMonthlyPayrollItem)
        .options(
            selectinload(HrmsMonthlyPayrollItem.employee),
            selectinload(HrmsMonthlyPayrollItem.payroll),
            selectinload(HrmsMonthlyPayrollItem.salary),
        )
        .where(HrmsMonthlyPayrollItem.id == item_id)
    )
    item = (await service.db.execute(query)).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payslip not found.")

    if not (ctx.is_admin or ctx.is_hr):
        if item.employee_id != ctx.user_id:
            if not (ctx.is_manager and item.employee_id in ctx.managed_employee_ids):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to another employee's payslip.")

        if item.status != "APPROVED":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Payslip is not yet approved.")

    return build_success_response(
        data=_serialize_payroll_item(item),
        message="Payslip detail retrieved successfully.",
    )


# ---------------------------------------------------------------------------
# Serialization Helpers
# ---------------------------------------------------------------------------

def _serialize_payroll_item(item: HrmsMonthlyPayrollItem, fallback_month: str | None = None) -> dict:
    emp = item.employee
    month = fallback_month
    try:
        payroll = getattr(item, "payroll", None)
        if payroll and getattr(payroll, "payroll_month", None):
            month = payroll.payroll_month
    except Exception:
        pass

    dept = "General"
    desig = "Staff"
    if emp:
        if getattr(emp, "department", None):
            dept = emp.department
        if getattr(emp, "designation", None):
            desig = emp.designation
        elif getattr(emp, "employment_type", None):
            desig = emp.employment_type.value if hasattr(emp.employment_type, "value") else str(emp.employment_type)
    return {
        "id": str(item.id),
        "payroll_id": str(item.payroll_id),
        "employee_id": str(item.employee_id),
        "employee_name": emp.full_name if emp else "Unknown",
        "employee_code": (emp.employee_code if emp else None) or f"EMP-{str(item.employee_id)[:6].upper()}",
        "department": dept,
        "designation": desig,
        "payroll_month": month,
        "annual_ctc": item.annual_ctc,
        "monthly_ctc": item.monthly_ctc,
        "working_days": item.working_days,
        "present_days": item.present_days,
        "paid_leave_days": item.paid_leave_days,
        "holiday_days": item.holiday_days,
        "weekend_days": item.weekend_days,
        "lop_days": item.lop_days,
        "earnings_breakdown": item.earnings_breakdown or [],
        "deductions_breakdown": item.deductions_breakdown or [],
        "additions_breakdown": item.additions_breakdown or [],
        "lop_deduction": item.lop_deduction,
        "gross_amount": item.gross_amount,
        "total_deductions": item.total_deductions,
        "net_salary": item.net_salary,
        "status": item.status,
        "calculation_details": item.calculation_details or {},
        "edit_history": item.edit_history or [],
    }


def _serialize_payroll(payroll: HrmsMonthlyPayroll, allowed_employee_ids: Optional[set[uuid.UUID]] = None) -> dict:
    items = payroll.items or []
    if allowed_employee_ids is not None:
        items = [i for i in items if i.employee_id in allowed_employee_ids]

    serialized_items = [_serialize_payroll_item(item, fallback_month=payroll.payroll_month) for item in items]

    return {
        "id": str(payroll.id),
        "payroll_month": payroll.payroll_month,
        "payroll_year": payroll.payroll_year,
        "month_number": payroll.month_number,
        "status": payroll.status,
        "total_employees": len(serialized_items),
        "total_gross": round(sum(it["gross_amount"] for it in serialized_items), 2),
        "total_deductions": round(sum(it["total_deductions"] for it in serialized_items), 2),
        "total_net": round(sum(it["net_salary"] for it in serialized_items), 2),
        "working_days": payroll.working_days,
        "weekend_days": payroll.weekend_days,
        "holiday_days": payroll.holiday_days,
        "processed_at": payroll.processed_at.isoformat() if payroll.processed_at else None,
        "approved_at": payroll.approved_at.isoformat() if payroll.approved_at else None,
        "notes": payroll.notes,
        "items": serialized_items,
    }
