"""
Health Routes.

A basic liveness check for ERP_Main itself -- separate from the ERP
Registry's `last_seen_at` field (Phase 2 Step 12), which is about tracking
the health of OTHER ERP instances, not this control-plane service's own.
"""

from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.responses import build_success_response
from app.database.session import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("", summary="Liveness check (legacy)")
@router.get("/live", summary="Liveness probe")
async def liveness(request: Request) -> dict:
    """
    Report whether the application process itself is alive.
    Fast, does not check external dependencies.
    """
    request_id = getattr(request.state, "request_id", "")
    return build_success_response({"status": "ok", "service": "erp_main"}, request_id=request_id)


@router.get("/ready", summary="Readiness probe")
async def readiness(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Report whether the application is ready to serve traffic.
    Validates live database connectivity. Returns HTTP 503 if down.
    """
    request_id = getattr(request.state, "request_id", "")
    try:
        await session.execute(text("SELECT 1"))
        return build_success_response(
            {"status": "ok", "service": "erp_main", "database": "healthy"},
            request_id=request_id,
        )
    except Exception as exc:
        logger.error(f"Readiness probe failed database check: {exc}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"status": "degraded", "database": "unhealthy", "error": "Database connectivity failed"},
        )
