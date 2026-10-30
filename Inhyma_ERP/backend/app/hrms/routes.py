"""
HRMS Setup Endpoints.

Mounts under ``/api/v1/hrms/setup``:
- Office Locations (Geo Fencing parameters)
- Leave Types & Entitlements
- Expense Categories
- Expense Approval Workflow & Claim Rules
"""

from __future__ import annotations

import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.hrms.rbac import HrmsUserContext, get_hrms_user_context
from app.hrms.schemas import (
    DetailedTrackingEmployeeItem,
    DetailedTrackingEmployeeUpdate,
    EmployeeTrackingSettingsResponse,
    ExpenseCategoryCreate,
    ExpenseCategoryRead,
    ExpenseCategoryStatusUpdate,
    ExpenseCategoryUpdate,
    ExpenseSettingsRead,
    ExpenseSettingsUpdate,
    LeaveTypeCreate,
    LeaveTypeRead,
    LeaveTypeStatusUpdate,
    LeaveTypeUpdate,
    LocationCreate,
    LocationRead,
    LocationStatusUpdate,
    LocationUpdate,
    ReturnTimerEmployeeItem,
    ReturnTimerEmployeeUpdate,
    TrackingSettingsOverviewResponse,
    TrackingSettingsRead,
    TrackingSettingsUpdate,
)
from app.hrms.service import HrmsSetupService

router = APIRouter(prefix="/hrms/setup", tags=["HRMS - Setup"])


def get_hrms_setup_service(db: AsyncSession = Depends(get_db_session)) -> HrmsSetupService:
    return HrmsSetupService(db)


def require_setup_read(ctx: HrmsUserContext = Depends(get_hrms_user_context)) -> HrmsUserContext:
    if not (ctx.is_admin or (ctx.is_hr and ("hrms.manage" in ctx.permissions or "hrms.view" in ctx.permissions or "hrms.setup" in ctx.permissions))):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. You do not have access to view HRMS Setup configuration.",
        )
    return ctx


def require_setup_manage(ctx: HrmsUserContext = Depends(get_hrms_user_context)) -> HrmsUserContext:
    if not (ctx.is_admin or (ctx.is_hr and "hrms.manage" in ctx.permissions)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Administrative or explicitly delegated setup permissions required.",
        )
    return ctx


# ===========================================================================
# Office Locations (Geo Fencing)
# ===========================================================================

@router.get("/locations")
async def list_locations(
    active_only: bool = Query(default=False),
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_read),
):
    locations = await service.list_locations(active_only=active_only)
    return build_success_response(
        data=[loc.model_dump(mode="json") for loc in locations],
        message="Office locations retrieved successfully.",
    )


@router.post("/locations", status_code=status.HTTP_201_CREATED)
async def create_location(
    payload: LocationCreate,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_manage),
):
    loc = await service.create_location(payload)
    return build_success_response(
        data=loc.model_dump(mode="json"),
        message="Office location created successfully.",
    )


@router.get("/locations/{location_id}")
async def get_location(
    location_id: uuid.UUID,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_read),
):
    loc = await service.get_location(location_id)
    return build_success_response(
        data=LocationRead.model_validate(loc).model_dump(mode="json"),
        message="Office location retrieved successfully.",
    )


@router.put("/locations/{location_id}")
async def update_location(
    location_id: uuid.UUID,
    payload: LocationUpdate,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_manage),
):
    loc = await service.update_location(location_id, payload)
    return build_success_response(
        data=loc.model_dump(mode="json"),
        message="Office location updated successfully.",
    )


@router.patch("/locations/{location_id}/status")
async def set_location_status(
    location_id: uuid.UUID,
    payload: LocationStatusUpdate,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_manage),
):
    loc = await service.set_location_status(location_id, payload.is_active)
    return build_success_response(
        data=loc.model_dump(mode="json"),
        message="Office location status updated successfully.",
    )


@router.delete("/locations/{location_id}", status_code=status.HTTP_200_OK)
async def delete_location(
    location_id: uuid.UUID,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_manage),
):
    await service.delete_location(location_id)
    return build_success_response(
        data=None,
        message="Office location soft-deleted successfully.",
    )


# ===========================================================================
# Leave Types & Entitlements
# ===========================================================================

@router.get("/leave-types")
async def list_leave_types(
    active_only: bool = Query(default=False),
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_read),
):
    leaves = await service.list_leave_types(active_only=active_only)
    return build_success_response(
        data=[LeaveTypeRead.model_validate(l).model_dump(mode="json") for l in leaves],
        message="Leave types retrieved successfully.",
    )


@router.post("/leave-types", status_code=status.HTTP_201_CREATED)
async def create_leave_type(
    payload: LeaveTypeCreate,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_manage),
):
    leave = await service.create_leave_type(payload)
    return build_success_response(
        data=LeaveTypeRead.model_validate(leave).model_dump(mode="json"),
        message="Leave type created successfully.",
    )


@router.get("/leave-types/{leave_type_id}")
async def get_leave_type(
    leave_type_id: uuid.UUID,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_read),
):
    leave = await service.get_leave_type(leave_type_id)
    return build_success_response(
        data=LeaveTypeRead.model_validate(leave).model_dump(mode="json"),
        message="Leave type retrieved successfully.",
    )


@router.put("/leave-types/{leave_type_id}")
async def update_leave_type(
    leave_type_id: uuid.UUID,
    payload: LeaveTypeUpdate,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_manage),
):
    leave = await service.update_leave_type(leave_type_id, payload)
    return build_success_response(
        data=LeaveTypeRead.model_validate(leave).model_dump(mode="json"),
        message="Leave type updated successfully.",
    )


@router.patch("/leave-types/{leave_type_id}/status")
async def set_leave_type_status(
    leave_type_id: uuid.UUID,
    payload: LeaveTypeStatusUpdate,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_manage),
):
    leave = await service.set_leave_type_status(leave_type_id, payload.is_active)
    return build_success_response(
        data=LeaveTypeRead.model_validate(leave).model_dump(mode="json"),
        message="Leave type status updated successfully.",
    )


@router.delete("/leave-types/{leave_type_id}", status_code=status.HTTP_200_OK)
async def delete_leave_type(
    leave_type_id: uuid.UUID,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_manage),
):
    await service.delete_leave_type(leave_type_id)
    return build_success_response(
        data=None,
        message="Leave type soft-deleted successfully.",
    )


# ===========================================================================
# Expense Categories
# ===========================================================================

@router.get("/expense-categories")
async def list_expense_categories(
    active_only: bool = Query(default=False),
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_read),
):
    cats = await service.list_expense_categories(active_only=active_only)
    return build_success_response(
        data=[ExpenseCategoryRead.model_validate(c).model_dump(mode="json") for c in cats],
        message="Expense categories retrieved successfully.",
    )


@router.post("/expense-categories", status_code=status.HTTP_201_CREATED)
async def create_expense_category(
    payload: ExpenseCategoryCreate,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_manage),
):
    cat = await service.create_expense_category(payload)
    return build_success_response(
        data=ExpenseCategoryRead.model_validate(cat).model_dump(mode="json"),
        message="Expense category created successfully.",
    )


@router.get("/expense-categories/{category_id}")
async def get_expense_category(
    category_id: uuid.UUID,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_read),
):
    cat = await service.get_expense_category(category_id)
    return build_success_response(
        data=ExpenseCategoryRead.model_validate(cat).model_dump(mode="json"),
        message="Expense category retrieved successfully.",
    )


@router.put("/expense-categories/{category_id}")
async def update_expense_category(
    category_id: uuid.UUID,
    payload: ExpenseCategoryUpdate,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_manage),
):
    cat = await service.update_expense_category(category_id, payload)
    return build_success_response(
        data=ExpenseCategoryRead.model_validate(cat).model_dump(mode="json"),
        message="Expense category updated successfully.",
    )


@router.patch("/expense-categories/{category_id}/status")
async def set_expense_category_status(
    category_id: uuid.UUID,
    payload: ExpenseCategoryStatusUpdate,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_manage),
):
    cat = await service.set_expense_category_status(category_id, payload.is_active)
    return build_success_response(
        data=ExpenseCategoryRead.model_validate(cat).model_dump(mode="json"),
        message="Expense category status updated successfully.",
    )


@router.delete("/expense-categories/{category_id}", status_code=status.HTTP_200_OK)
async def delete_expense_category(
    category_id: uuid.UUID,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_manage),
):
    await service.delete_expense_category(category_id)
    return build_success_response(
        data=None,
        message="Expense category soft-deleted successfully.",
    )


# ===========================================================================
# Expense Settings (Approval Workflow & Claim Rules)
# ===========================================================================

@router.get("/expense-settings")
async def get_expense_settings(
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_read),
):
    settings = await service.get_expense_settings()
    return build_success_response(
        data=ExpenseSettingsRead.model_validate(settings).model_dump(mode="json"),
        message="Expense settings retrieved successfully.",
    )


@router.put("/expense-settings")
async def update_expense_settings(
    payload: ExpenseSettingsUpdate,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
    ctx: HrmsUserContext = Depends(require_setup_manage),
):
    settings = await service.update_expense_settings(payload)
    return build_success_response(
        data=ExpenseSettingsRead.model_validate(settings).model_dump(mode="json"),
        message="Expense settings updated successfully.",
    )


# ===========================================================================
# Tracking Settings (Org Defaults & Per-Employee Overrides)
# ===========================================================================

@router.get("/tracking-settings")
async def get_all_tracking_settings(
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsSetupService = Depends(get_hrms_setup_service),
):
    """Retrieve organization defaults and all employee overrides (Admin/HR only)."""
    if not (ctx.is_admin or ctx.is_hr):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Only Admin and HR can view tracking configuration.",
        )
    overview = await service.list_all_tracking_settings()
    return build_success_response(
        data=overview.model_dump(mode="json"),
        message="Tracking settings retrieved successfully.",
    )


@router.put("/tracking-settings/org-default")
async def update_org_tracking_settings(
    payload: TrackingSettingsUpdate,
    ctx: HrmsUserContext = Depends(require_setup_manage),
    service: HrmsSetupService = Depends(get_hrms_setup_service),
):
    """Update organization default tracking settings (Admin/HR only)."""
    updated = await service.update_org_tracking_settings(payload, user_id=ctx.user_id)
    return build_success_response(
        data=updated.model_dump(mode="json"),
        message="Organization default tracking settings updated successfully.",
    )


@router.get("/tracking-settings/employee/{employee_id}")
async def get_employee_tracking_settings(
    employee_id: uuid.UUID,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsSetupService = Depends(get_hrms_setup_service),
):
    """
    Get tracking settings for a specific employee.
    Accessible to Admin, HR, Manager (for direct reports), or the employee himself.
    """
    if not (ctx.is_admin or ctx.is_hr):
        if employee_id != ctx.user_id and employee_id not in ctx.managed_employee_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied. You cannot view tracking settings for another employee.",
            )
    res = await service.get_employee_tracking_settings(employee_id)
    return build_success_response(
        data=res.model_dump(mode="json"),
        message="Employee tracking settings retrieved successfully.",
    )


@router.put("/tracking-settings/employee/{employee_id}")
async def update_employee_tracking_settings(
    employee_id: uuid.UUID,
    payload: TrackingSettingsUpdate,
    ctx: HrmsUserContext = Depends(require_setup_manage),
    service: HrmsSetupService = Depends(get_hrms_setup_service),
):
    """
    Set employee-specific tracking settings override.
    Restricted strictly to Admin and HR with manage rights.
    """
    res = await service.update_employee_tracking_settings(employee_id, payload, user_id=ctx.user_id)
    return build_success_response(
        data=res.model_dump(mode="json"),
        message="Employee tracking settings override saved successfully.",
    )


@router.delete("/tracking-settings/employee/{employee_id}")
async def delete_employee_tracking_settings(
    employee_id: uuid.UUID,
    ctx: HrmsUserContext = Depends(require_setup_manage),
    service: HrmsSetupService = Depends(get_hrms_setup_service),
):
    """
    Remove employee-specific override so employee inherits organization defaults again.
    Restricted strictly to Admin and HR with manage rights.
    """
    res = await service.delete_employee_tracking_settings(employee_id)
    return build_success_response(
        data=res.model_dump(mode="json"),
        message="Employee tracking settings override cleared. Organization defaults inherited.",
    )


# ---------------------------------------------------------------------------
# Dedicated Endpoints for Setup Sub-Tabs
# ---------------------------------------------------------------------------

@router.get("/detailed-tracking/employees")
async def list_detailed_tracking_employees(
    search: str | None = Query(None, description="Search employee name, ID, or department"),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsSetupService = Depends(get_hrms_setup_service),
):
    """
    List all eligible PostgreSQL employees with their detailed tracking toggle and interval.
    Filtered by requester's authorized employee scope.
    """
    allowed_ids = None if (ctx.is_admin or ctx.is_hr) else ctx.managed_employee_ids
    items = await service.list_detailed_tracking_employees(search=search, allowed_employee_ids=allowed_ids)
    return build_success_response(
        data=[it.model_dump(mode="json") for it in items],
        message="Detailed tracking employee list retrieved.",
    )


@router.put("/detailed-tracking/employee/{employee_id}")
async def update_employee_detailed_tracking(
    employee_id: uuid.UUID,
    payload: DetailedTrackingEmployeeUpdate,
    ctx: HrmsUserContext = Depends(require_setup_manage),
    service: HrmsSetupService = Depends(get_hrms_setup_service),
):
    """Update detailed tracking toggle (OFF/ON) and interval for an employee."""
    item = await service.update_employee_detailed_tracking(employee_id, payload, user_id=ctx.user_id)
    return build_success_response(
        data=item.model_dump(mode="json"),
        message=f"Detailed tracking for {item.employee_name} updated successfully.",
    )


@router.get("/return-timer/employees")
async def list_return_timer_employees(
    search: str | None = Query(None, description="Search employee name, ID, or department"),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsSetupService = Depends(get_hrms_setup_service),
):
    """
    List all eligible PostgreSQL employees with their return timer override and effective duration.
    Filtered by requester's authorized employee scope.
    """
    allowed_ids = None if (ctx.is_admin or ctx.is_hr) else ctx.managed_employee_ids
    items = await service.list_return_timer_employees(search=search, allowed_employee_ids=allowed_ids)
    return build_success_response(
        data=[it.model_dump(mode="json") for it in items],
        message="Return timer employee list retrieved.",
    )


@router.put("/return-timer/employee/{employee_id}")
async def update_employee_return_timer(
    employee_id: uuid.UUID,
    payload: ReturnTimerEmployeeUpdate,
    ctx: HrmsUserContext = Depends(require_setup_manage),
    service: HrmsSetupService = Depends(get_hrms_setup_service),
):
    """Update return timer override or revert to organization default for an employee."""
    item = await service.update_employee_return_timer(employee_id, payload, user_id=ctx.user_id)
    return build_success_response(
        data=item.model_dump(mode="json"),
        message=f"Return timer for {item.employee_name} updated successfully.",
    )


