"""API routes for Technician Gatepass, Wallet & Warranty Management."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.technician_operations.schemas import (
    GatepassCreate,
    GatepassLinkSOPayload,
    GatepassRead,
    GatepassReturnPayload,
    WalletTransactionCreate,
    WarrantyRegisterPayload,
)
from app.technician_operations.service import TechnicianOperationsService

router = APIRouter(prefix="/technician-operations", tags=["Technician Operations"])


def get_service(session: AsyncSession = Depends(get_db_session)) -> TechnicianOperationsService:
    return TechnicianOperationsService(session)


# ---------------------------------------------------------------------------
# High-Level Metrics
# ---------------------------------------------------------------------------

@router.get("/metrics", summary="Get high-level operations KPI metrics")
async def get_metrics(
    service: TechnicianOperationsService = Depends(get_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    metrics = await service.get_metrics()
    return build_success_response(data=metrics.model_dump(mode="json"))


# ---------------------------------------------------------------------------
# Machine Warranty Endpoints
# ---------------------------------------------------------------------------

@router.get("/warranty", summary="List machine warranties")
async def list_warranties(
    search: str | None = Query(default=None),
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    service: TechnicianOperationsService = Depends(get_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    items, total = await service.list_warranties(
        search=search,
        status=status,
        page=page,
        page_size=page_size,
    )
    total_pages = (total + page_size - 1) // page_size if total > 0 else 1
    return build_success_response(
        data=[item.model_dump(mode="json") for item in items],
        meta={
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": total_pages,
            }
        },
    )


@router.post("/warranty", status_code=status.HTTP_201_CREATED, summary="Register machine warranty")
async def register_warranty(
    payload: WarrantyRegisterPayload,
    service: TechnicianOperationsService = Depends(get_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    warranty = await service.register_warranty(payload)
    return build_success_response(
        data=warranty.model_dump(mode="json"),
        message="Machine warranty registered successfully",
    )


@router.get("/warranty/validate", summary="Validate serial number warranty coverage")
async def validate_serial(
    serial: str = Query(..., min_length=1, description="Machine Serial Number"),
    service: TechnicianOperationsService = Depends(get_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    result = await service.validate_serial(serial)
    return build_success_response(data=result.model_dump(mode="json"))


# ---------------------------------------------------------------------------
# Spare Parts Gatepass & Returns Endpoints
# ---------------------------------------------------------------------------

@router.get("/gatepasses", summary="List technician spare parts gatepasses")
async def list_gatepasses(
    technician_name: str | None = Query(default=None),
    status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    service: TechnicianOperationsService = Depends(get_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    items, total = await service.list_gatepasses(
        technician_name=technician_name,
        status=status,
        search=search,
        page=page,
        page_size=page_size,
    )
    total_pages = (total + page_size - 1) // page_size if total > 0 else 1
    return build_success_response(
        data=[item.model_dump(mode="json") for item in items],
        meta={
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": total_pages,
            }
        },
    )


@router.post("/gatepasses", status_code=status.HTTP_201_CREATED, summary="Create Outward Gatepass for technician")
async def create_gatepass(
    payload: GatepassCreate,
    service: TechnicianOperationsService = Depends(get_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    gatepass = await service.create_gatepass(payload, current_user=current_user)
    return build_success_response(
        data=gatepass.model_dump(mode="json"),
        message=f"Outward Gatepass {gatepass.gatepass_number} created successfully",
    )


@router.get("/gatepasses/{gatepass_id}", summary="Get gatepass details")
async def get_gatepass(
    gatepass_id: uuid.UUID,
    service: TechnicianOperationsService = Depends(get_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    gatepass = await service.get_gatepass(gatepass_id)
    return build_success_response(data=gatepass.model_dump(mode="json"))


@router.post("/gatepasses/{gatepass_id}/return", summary="Record partial or full return of spare parts")
async def record_parts_return(
    gatepass_id: uuid.UUID,
    payload: GatepassReturnPayload,
    service: TechnicianOperationsService = Depends(get_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    updated_gp = await service.record_parts_return(gatepass_id, payload)
    return build_success_response(
        data=updated_gp.model_dump(mode="json"),
        message="Parts return processed and gatepass reconciled",
    )


@router.post("/gatepasses/{gatepass_id}/link-so", summary="Link Sales Order created for consumed parts")
async def link_sales_order(
    gatepass_id: uuid.UUID,
    payload: GatepassLinkSOPayload,
    service: TechnicianOperationsService = Depends(get_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    updated_gp = await service.link_sales_order(gatepass_id, payload)
    return build_success_response(
        data=updated_gp.model_dump(mode="json"),
        message=f"Sales Order '{payload.sales_order_number}' linked to Gatepass successfully",
    )


@router.get("/gatepasses/{gatepass_id}/draft-so", summary="Generate draft Sales Order payload for consumed parts")
async def get_draft_so(
    gatepass_id: uuid.UUID,
    service: TechnicianOperationsService = Depends(get_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    draft = await service.get_draft_so_payload(gatepass_id)
    return build_success_response(data=draft.model_dump(mode="json"))


# ---------------------------------------------------------------------------
# Technician Payment & Wallet Management Endpoints
# ---------------------------------------------------------------------------

@router.get("/wallet/summaries", summary="Get technician wallet cash in hand balances")
async def get_wallet_summaries(
    service: TechnicianOperationsService = Depends(get_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    summaries = await service.get_technician_wallet_summaries()
    return build_success_response(data=[s.model_dump(mode="json") for s in summaries])


@router.get("/wallet/transactions", summary="List wallet transactions")
async def list_wallet_transactions(
    technician_name: str | None = Query(default=None),
    transaction_type: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    service: TechnicianOperationsService = Depends(get_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    items, total = await service.list_wallet_transactions(
        technician_name=technician_name,
        transaction_type=transaction_type,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )
    total_pages = (total + page_size - 1) // page_size if total > 0 else 1
    return build_success_response(
        data=[item.model_dump(mode="json") for item in items],
        meta={
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": total_pages,
            }
        },
    )


@router.post("/wallet/transactions", status_code=status.HTTP_201_CREATED, summary="Record a wallet transaction")
async def record_wallet_transaction(
    payload: WalletTransactionCreate,
    service: TechnicianOperationsService = Depends(get_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    txn = await service.record_wallet_transaction(payload)
    return build_success_response(
        data=txn.model_dump(mode="json"),
        message=f"Wallet transaction '{txn.transaction_number}' recorded successfully",
    )
