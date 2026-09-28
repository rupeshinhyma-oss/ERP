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

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.hrms.schemas import (
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
)
from app.hrms.service import HrmsSetupService

router = APIRouter(prefix="/hrms/setup", tags=["HRMS - Setup"])


def get_hrms_setup_service(db: AsyncSession = Depends(get_db_session)) -> HrmsSetupService:
    return HrmsSetupService(db)


# ===========================================================================
# Office Locations (Geo Fencing)
# ===========================================================================

@router.get("/locations")
async def list_locations(service: HrmsSetupService = Depends(get_hrms_setup_service)):
    locations = await service.list_locations()
    return build_success_response(
        data=[loc.model_dump(mode="json") for loc in locations],
        message="Office locations retrieved successfully.",
    )


@router.post("/locations", status_code=status.HTTP_201_CREATED)
async def create_location(
    payload: LocationCreate,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
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
async def list_leave_types(service: HrmsSetupService = Depends(get_hrms_setup_service)):
    leaves = await service.list_leave_types()
    return build_success_response(
        data=[LeaveTypeRead.model_validate(l).model_dump(mode="json") for l in leaves],
        message="Leave types retrieved successfully.",
    )


@router.post("/leave-types", status_code=status.HTTP_201_CREATED)
async def create_leave_type(
    payload: LeaveTypeCreate,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
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
async def list_expense_categories(service: HrmsSetupService = Depends(get_hrms_setup_service)):
    cats = await service.list_expense_categories()
    return build_success_response(
        data=[ExpenseCategoryRead.model_validate(c).model_dump(mode="json") for c in cats],
        message="Expense categories retrieved successfully.",
    )


@router.post("/expense-categories", status_code=status.HTTP_201_CREATED)
async def create_expense_category(
    payload: ExpenseCategoryCreate,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
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
async def get_expense_settings(service: HrmsSetupService = Depends(get_hrms_setup_service)):
    settings = await service.get_expense_settings()
    return build_success_response(
        data=ExpenseSettingsRead.model_validate(settings).model_dump(mode="json"),
        message="Expense settings retrieved successfully.",
    )


@router.put("/expense-settings")
async def update_expense_settings(
    payload: ExpenseSettingsUpdate,
    service: HrmsSetupService = Depends(get_hrms_setup_service),
):
    settings = await service.update_expense_settings(payload)
    return build_success_response(
        data=ExpenseSettingsRead.model_validate(settings).model_dump(mode="json"),
        message="Expense settings updated successfully.",
    )
