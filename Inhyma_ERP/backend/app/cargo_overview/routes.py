"""API routes for the Cargo Overview module."""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import CurrentUser
from app.cargo_overview.schemas import (
    CargoChecklistUpdatePayload,
    CargoOverviewCreatePayload,
    CargoStageLiteral,
)
from app.cargo_overview.service import CargoOverviewService
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.rbac.dependencies import require_any_permission

router = APIRouter(prefix="/cargo-overview", tags=["Reports - Cargo Overview"])

_VIEW_PERMS = (
    "cargo_overview.view",
    "report.view",
)

_EDIT_CARGO_PERMS = (
    "cargo_overview.cargo_status.edit",
    "report.view",
)

_UPLOAD_DOC_PERMS = (
    "cargo_overview.gallery.upload",
    "report.view",
)

_DELETE_DOC_PERMS = (
    "cargo_overview.gallery.delete",
    "report.view",
)


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def _actor_name(user: CurrentUser) -> str:
    return (
        getattr(user, "full_name", None)
        or getattr(user, "username", None)
        or getattr(user, "email", None)
        or "Admin"
    )


def get_cargo_overview_service(
    session: AsyncSession = Depends(get_db_session),
) -> CargoOverviewService:
    return CargoOverviewService(session)


@router.get("", summary="List Cargo Overview consignments (List View)")
async def list_cargo_overviews(
    request: Request,
    stage: CargoStageLiteral = Query(default="all", description="Filter by stage: pending | cleared | all"),
    warehouse: str | None = Query(default=None),
    search: str | None = Query(default=None),
    _current_user: CurrentUser = Depends(require_any_permission(*_VIEW_PERMS)),
    service: CargoOverviewService = Depends(get_cargo_overview_service),
) -> dict[str, Any]:
    res = await service.list_overviews(stage=stage, warehouse=warehouse, search=search)
    return build_success_response(
        data=res.model_dump(mode="json"),
        message="Cargo overviews fetched successfully.",
        request_id=_rid(request),
    )


@router.get("/export", summary="Export Cargo Overview list as CSV")
async def export_cargo_overviews(
    stage: CargoStageLiteral = Query(default="all"),
    warehouse: str | None = Query(default=None),
    search: str | None = Query(default=None),
    _current_user: CurrentUser = Depends(require_any_permission(*_VIEW_PERMS)),
    service: CargoOverviewService = Depends(get_cargo_overview_service),
) -> Response:
    csv_bytes = await service.export_csv(stage=stage, warehouse=warehouse, search=search)
    filename = f"Cargo_Overview_{date.today().isoformat()}.csv"
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/detail", summary="Get single Cargo Overview detail by consignment_key")
async def get_cargo_overview_detail(
    request: Request,
    key: str = Query(..., description="Consignment key"),
    _current_user: CurrentUser = Depends(require_any_permission(*_VIEW_PERMS)),
    service: CargoOverviewService = Depends(get_cargo_overview_service),
) -> dict[str, Any]:
    row = await service.get_overview(consignment_key=key)
    return build_success_response(
        data=row.model_dump(mode="json"),
        message="Cargo overview detail fetched successfully.",
        request_id=_rid(request),
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Create or update a Cargo Overview record",
)
async def upsert_cargo_overview(
    request: Request,
    payload: CargoOverviewCreatePayload,
    current_user: CurrentUser = Depends(require_any_permission(*_EDIT_CARGO_PERMS)),
    service: CargoOverviewService = Depends(get_cargo_overview_service),
) -> dict[str, Any]:
    row = await service.upsert_overview(
        payload=payload,
        user_id=current_user.id,
        user_name=_actor_name(current_user),
    )
    return build_success_response(
        data=row.model_dump(mode="json"),
        message="Cargo overview saved successfully.",
        request_id=_rid(request),
    )


@router.patch(
    "/checklist",
    summary="Update Cargo Status checklist toggles (Yes/No), remarks, ETD/ETA, or forwarder/agent",
)
async def update_cargo_status(
    request: Request,
    payload: CargoChecklistUpdatePayload,
    key: str = Query(..., description="Consignment key"),
    current_user: CurrentUser = Depends(require_any_permission(*_EDIT_CARGO_PERMS)),
    service: CargoOverviewService = Depends(get_cargo_overview_service),
) -> dict[str, Any]:
    updated = await service.update_cargo_status(
        consignment_key=key,
        payload=payload,
        user_id=current_user.id,
        user_name=_actor_name(current_user),
    )
    return build_success_response(
        data=updated,
        message="Cargo status updated successfully.",
        request_id=_rid(request),
    )


@router.post(
    "/documents",
    status_code=status.HTTP_201_CREATED,
    summary="Upload a document file to a Consignment Gallery slot",
)
async def upload_cargo_document(
    request: Request,
    key: str = Query(..., description="Consignment key"),
    slot_key: str = Query(..., description="Document slot key"),
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_any_permission(*_UPLOAD_DOC_PERMS)),
    service: CargoOverviewService = Depends(get_cargo_overview_service),
) -> dict[str, Any]:
    file_bytes = await file.read()
    slot = await service.upload_document(
        consignment_key=key,
        slot_key=slot_key,
        file_bytes=file_bytes,
        filename=file.filename or f"{slot_key}.pdf",
        content_type=file.content_type,
        user_id=current_user.id,
        user_name=_actor_name(current_user),
    )
    return build_success_response(
        data=slot.model_dump(mode="json"),
        message="Document uploaded to Consignment Gallery.",
        request_id=_rid(request),
    )


@router.delete(
    "/documents",
    summary="Delete a manually uploaded document from a Consignment Gallery slot",
)
async def delete_cargo_document(
    request: Request,
    key: str = Query(..., description="Consignment key"),
    slot_key: str = Query(..., description="Document slot key"),
    current_user: CurrentUser = Depends(require_any_permission(*_DELETE_DOC_PERMS)),
    service: CargoOverviewService = Depends(get_cargo_overview_service),
) -> dict[str, Any]:
    res = await service.delete_document(
        consignment_key=key,
        slot_key=slot_key,
        user_id=current_user.id,
        user_name=_actor_name(current_user),
    )
    return build_success_response(
        data=res,
        message="Document removed from Consignment Gallery.",
        request_id=_rid(request),
    )
