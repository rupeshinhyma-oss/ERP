"""
HRMS Asset Endpoints.

Mounts under ``/api/v1/hrms/assets``:
- List & search assets (filters: search, status, category, branch/location, assigned/unassigned, warranty, pagination)
- Summary statistics (GET /hrms/assets/summary)
- Get asset detail & history
- Create asset
- Edit asset (PATCH & PUT)
- Update asset status (PATCH /{id}/status)
- Assign asset to employee (POST /{id}/assign)
- Return asset (POST /{id}/return)
- List asset assignments (GET /{id}/assignments)
- Log maintenance (POST /{id}/maintenance)
- List maintenance records (GET /{id}/maintenance)
- Transfer branch / location (POST /{id}/move)
- Delete (soft-delete / retire) asset
"""

from __future__ import annotations

from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_auth_service
from app.auth.service import AuthService
from app.core.exceptions import ForbiddenException
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.hrms.asset_service import HrmsAssetService
from app.hrms.schemas import (
    AssetAssign,
    AssetAssignmentRead,
    AssetCreate,
    AssetHistoryRead,
    AssetMaintenanceCreate,
    AssetMaintenanceRead,
    AssetMove,
    AssetRead,
    AssetReturn,
    AssetStatusUpdate,
    AssetSummaryRead,
    AssetUpdate,
)

router = APIRouter(prefix="/hrms/assets", tags=["HRMS - Assets"])


def get_asset_service(db: AsyncSession = Depends(get_db_session)) -> HrmsAssetService:
    return HrmsAssetService(db)


from app.hrms.rbac import HrmsUserContext, get_hrms_user_context


async def get_current_user_context(
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
) -> tuple[uuid.UUID, bool]:
    ctx.require_module_access("assets")
    return ctx.user_id, ctx.is_admin or ctx.is_hr


# ===========================================================================
# Asset Summary & Collection Endpoints
# ===========================================================================

@router.get("/summary", response_model=None)
async def get_assets_summary(
    service: HrmsAssetService = Depends(get_asset_service),
    ctx: tuple[uuid.UUID, bool] = Depends(get_current_user_context),
):
    """Retrieve aggregate counts directly from the PostgreSQL database."""
    summary = await service.get_summary()
    return build_success_response(
        data=summary.model_dump(mode="json"),
        message="Asset summary statistics retrieved successfully.",
    )


@router.get("", response_model=None)
async def list_assets(
    search: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    assigned_to_user_id: Optional[uuid.UUID] = Query(default=None),
    location_id: Optional[uuid.UUID] = Query(default=None),
    branch_id: Optional[uuid.UUID] = Query(default=None),
    assigned_status: Optional[str] = Query(default=None),
    warranty_status: Optional[str] = Query(default=None),
    page: Optional[int] = Query(default=None, ge=1),
    page_size: Optional[int] = Query(default=None, ge=1, le=200),
    service: HrmsAssetService = Depends(get_asset_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    """Retrieve asset records with optional filtering and pagination."""
    ctx.require_module_access("assets")
    eff_location = location_id or branch_id

    target_assigned = assigned_to_user_id
    if not (ctx.is_admin or ctx.is_hr):
        if not ctx.is_manager:
            target_assigned = ctx.user_id
        else:
            if target_assigned:
                ctx.require_employee_access(target_assigned)

    assets = await service.list_assets(
        search=search,
        status=status,
        category=category,
        assigned_to_user_id=target_assigned,
        location_id=eff_location,
        assigned_status=assigned_status,
        warranty_status=warranty_status,
        page=page,
        page_size=page_size,
    )
    if ctx.is_manager and not (ctx.is_admin or ctx.is_hr):
        assets = [a for a in assets if not a.assigned_to_user_id or a.assigned_to_user_id in ctx.managed_employee_ids]

    return build_success_response(
        data=[a.model_dump(mode="json") for a in assets],
        message="Assets retrieved successfully.",
    )


# ===========================================================================
# Individual Asset Operations
# ===========================================================================

@router.get("/{asset_id}", response_model=None)
async def get_asset(
    asset_id: uuid.UUID,
    service: HrmsAssetService = Depends(get_asset_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    """Retrieve a single asset by ID with full history and assignments."""
    ctx.require_module_access("assets")
    asset = await service.get_asset(asset_id)
    if not (ctx.is_admin or ctx.is_hr):
        if asset.assigned_to_user_id and asset.assigned_to_user_id != ctx.user_id:
            if not (ctx.is_manager and asset.assigned_to_user_id in ctx.managed_employee_ids):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not have permission to view another employee's asset record.",
                )

    return build_success_response(
        data=asset.model_dump(mode="json"),
        message="Asset retrieved successfully.",
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=None)
async def create_asset(
    payload: AssetCreate,
    service: HrmsAssetService = Depends(get_asset_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("assets")
    if not (ctx.is_admin or ctx.is_hr):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied. Only Admin or HR can create assets.")
    """Create a new asset."""
    user_id = ctx.user_id
    created = await service.create_asset(payload, actor_id=user_id)
    return build_success_response(
        data=created.model_dump(mode="json"),
        message="Asset created successfully.",
    )


@router.patch("/{asset_id}", response_model=None)
async def update_asset_patch(
    asset_id: uuid.UUID,
    payload: AssetUpdate,
    service: HrmsAssetService = Depends(get_asset_service),
    ctx: tuple[uuid.UUID, bool] = Depends(get_current_user_context),
):
    """Update asset metadata and condition/status via PATCH."""
    user_id, _ = ctx
    updated = await service.update_asset(asset_id, payload, actor_id=user_id)
    return build_success_response(
        data=updated.model_dump(mode="json"),
        message="Asset updated successfully.",
    )


@router.put("/{asset_id}", response_model=None)
async def update_asset_put(
    asset_id: uuid.UUID,
    payload: AssetUpdate,
    service: HrmsAssetService = Depends(get_asset_service),
    ctx: tuple[uuid.UUID, bool] = Depends(get_current_user_context),
):
    """Update asset metadata via PUT."""
    user_id, _ = ctx
    updated = await service.update_asset(asset_id, payload, actor_id=user_id)
    return build_success_response(
        data=updated.model_dump(mode="json"),
        message="Asset updated successfully.",
    )


@router.patch("/{asset_id}/status", response_model=None)
async def update_asset_status_endpoint(
    asset_id: uuid.UUID,
    payload: AssetStatusUpdate,
    service: HrmsAssetService = Depends(get_asset_service),
    ctx: tuple[uuid.UUID, bool] = Depends(get_current_user_context),
):
    """Change asset status directly (e.g. Under Maintenance, Damaged, Lost, Retired)."""
    user_id, _ = ctx
    updated = await service.update_asset_status(asset_id, payload, actor_id=user_id)
    return build_success_response(
        data=updated.model_dump(mode="json"),
        message=f"Asset status updated to {payload.status.upper()} successfully.",
    )


@router.post("/{asset_id}/assign", response_model=None)
async def assign_asset(
    asset_id: uuid.UUID,
    payload: AssetAssign,
    service: HrmsAssetService = Depends(get_asset_service),
    ctx: tuple[uuid.UUID, bool] = Depends(get_current_user_context),
):
    """Assign asset to a real employee from the users table. Enforces one active assignment."""
    user_id, is_admin_or_hr = ctx
    if not is_admin_or_hr:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied. Only Admin or HR can assign assets.")
    assigned = await service.assign_asset(asset_id, payload, actor_id=user_id)
    return build_success_response(
        data=assigned.model_dump(mode="json"),
        message="Asset assigned to employee successfully.",
    )


@router.post("/{asset_id}/return", response_model=None)
async def return_asset(
    asset_id: uuid.UUID,
    payload: AssetReturn,
    service: HrmsAssetService = Depends(get_asset_service),
    ctx: tuple[uuid.UUID, bool] = Depends(get_current_user_context),
):
    """Return an assigned asset back to AVAILABLE status."""
    user_id, is_admin_or_hr = ctx
    if not is_admin_or_hr:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied. Only Admin or HR can process asset returns.")
    returned = await service.return_asset(asset_id, payload, actor_id=user_id)
    return build_success_response(
        data=returned.model_dump(mode="json"),
        message="Asset returned successfully.",
    )


@router.get("/{asset_id}/assignments", response_model=None)
async def get_asset_assignments(
    asset_id: uuid.UUID,
    service: HrmsAssetService = Depends(get_asset_service),
    ctx: tuple[uuid.UUID, bool] = Depends(get_current_user_context),
):
    """Fetch all assignment records for an asset."""
    assignments = await service.list_assignments(asset_id)
    return build_success_response(
        data=[a.model_dump(mode="json") for a in assignments],
        message="Asset assignments retrieved successfully.",
    )


@router.get("/{asset_id}/history", response_model=None)
async def get_asset_history(
    asset_id: uuid.UUID,
    service: HrmsAssetService = Depends(get_asset_service),
    ctx: tuple[uuid.UUID, bool] = Depends(get_current_user_context),
):
    """Fetch complete event and audit history for an asset."""
    history = await service.get_asset_history(asset_id)
    return build_success_response(
        data=[h.model_dump(mode="json") for h in history],
        message="Asset history retrieved successfully.",
    )


@router.post("/{asset_id}/maintenance", status_code=status.HTTP_201_CREATED, response_model=None)
async def create_asset_maintenance(
    asset_id: uuid.UUID,
    payload: AssetMaintenanceCreate,
    service: HrmsAssetService = Depends(get_asset_service),
    ctx: tuple[uuid.UUID, bool] = Depends(get_current_user_context),
):
    """Log a maintenance / servicing record for an asset."""
    user_id, is_admin_or_hr = ctx
    if not is_admin_or_hr:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied. Only Admin or HR can log asset maintenance.")
    maint = await service.create_maintenance(asset_id, payload, actor_id=user_id)
    return build_success_response(
        data=maint.model_dump(mode="json"),
        message="Asset maintenance record created successfully.",
    )


@router.get("/{asset_id}/maintenance", response_model=None)
async def get_asset_maintenance(
    asset_id: uuid.UUID,
    service: HrmsAssetService = Depends(get_asset_service),
    ctx: tuple[uuid.UUID, bool] = Depends(get_current_user_context),
):
    """Fetch all maintenance records for an asset."""
    records = await service.list_maintenance(asset_id)
    return build_success_response(
        data=[m.model_dump(mode="json") for m in records],
        message="Asset maintenance records retrieved successfully.",
    )


@router.post("/{asset_id}/move", response_model=None)
async def move_asset_branch(
    asset_id: uuid.UUID,
    payload: AssetMove,
    service: HrmsAssetService = Depends(get_asset_service),
    ctx: tuple[uuid.UUID, bool] = Depends(get_current_user_context),
):
    """Transfer an asset to a new office branch / location."""
    user_id, is_admin_or_hr = ctx
    if not is_admin_or_hr:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied. Only Admin or HR can transfer assets.")
    moved = await service.move_branch(asset_id, payload, actor_id=user_id)
    return build_success_response(
        data=moved.model_dump(mode="json"),
        message="Asset branch transferred successfully.",
    )


@router.delete("/{asset_id}", response_model=None)
async def delete_asset(
    asset_id: uuid.UUID,
    service: HrmsAssetService = Depends(get_asset_service),
    ctx: tuple[uuid.UUID, bool] = Depends(get_current_user_context),
):
    """Soft-delete / Retire an asset."""
    user_id, is_admin_or_hr = ctx
    if not is_admin_or_hr:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied. Only Admin or HR can retire assets.")
    await service.delete_asset(asset_id, actor_id=user_id)
    return build_success_response(
        data={"id": str(asset_id), "retired": True},
        message="Asset retired successfully.",
    )
