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


@router.get("", summary="Liveness check (legacy)", operation_id="health_liveness_legacy")
async def liveness_legacy(request: Request) -> dict:
    """Legacy root liveness endpoint."""
    request_id = getattr(request.state, "request_id", "")
    return build_success_response({"status": "ok", "service": "erp_main"}, request_id=request_id)


@router.head("", include_in_schema=False)
@router.head("/live", include_in_schema=False)
async def liveness_head(request: Request) -> dict:
    """HEAD liveness probe (excluded from OpenAPI to prevent duplicate operation IDs)."""
    request_id = getattr(request.state, "request_id", "")
    return build_success_response({"status": "ok", "service": "erp_main"}, request_id=request_id)


@router.get("/live", summary="Liveness probe", operation_id="health_liveness")
async def liveness(request: Request) -> dict:
    """
    Report whether the application process itself is alive.
    Fast, does not check external dependencies.
    """
    request_id = getattr(request.state, "request_id", "")
    return build_success_response({"status": "ok", "service": "erp_main"}, request_id=request_id)


@router.get("/ready", summary="Readiness probe", operation_id="health_readiness")
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
            {
                "status": "ok",
                "service": "erp_main",
                "database": "healthy",
            },
            request_id=request_id,
        )
    except Exception as exc:
        logger.error(f"Readiness probe failed database check: {exc}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"status": "degraded", "database": "unhealthy", "error": "Database connectivity failed"},
        )


@router.head("/ready", include_in_schema=False)
async def readiness_head(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """HEAD readiness probe."""
    return await readiness(request=request, session=session)


def _is_authorized_platform_diagnostics_caller(request: Request) -> bool:
    """Return True if caller presents a valid platform admin/global JWT or spoke service credential."""
    import hmac
    from app.core.config import settings
    from app.global_auth.security import decode_global_access_token
    from app.platform_auth.security import decode_platform_access_token

    auth_header = (request.headers.get("authorization") or "").strip()
    token = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
    if not token:
        return False

    for erp_key in ("yinglima", "inhyma"):
        cred = settings.get_service_credential_for_erp(erp_key)
        if cred and hmac.compare_digest(token, cred):
            return True

    try:
        claims = decode_platform_access_token(token)
        if claims and claims.get("sub"):
            return True
    except Exception:
        pass

    try:
        claims = decode_global_access_token(token)
        if claims and claims.get("sub"):
            return True
    except Exception:
        pass
    return False


@router.get(
    "/dependencies",
    summary="Federation & Subsystem Dependency Health",
    operation_id="health_dependencies",
)
async def dependency_health(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Report minimal safe status publicly and detailed subsystem diagnostics only
    to authenticated platform admins / authorized spoke services (BUG-028).
    Never exposes secrets, credentials, or private tokens.
    """
    from app.core.config import settings

    request_id = getattr(request.state, "request_id", "")
    db_healthy = False
    try:
        await session.execute(text("SELECT 1"))
        db_healthy = True
    except Exception as exc:
        logger.warning("Database connectivity check failed during dependency health check: %s", exc)

    if not _is_authorized_platform_diagnostics_caller(request):
        return build_success_response(
            {
                "status": "healthy" if db_healthy else "degraded",
                "service": "erp_main",
            },
            request_id=request_id,
        )

    yinglima_cred_configured = bool(settings.get_service_credential_for_erp("yinglima"))
    inhyma_cred_configured = bool(settings.get_service_credential_for_erp("inhyma"))
    reconciliation_enabled = bool(getattr(settings, "PROVISIONING_RECONCILIATION_ENABLED", True))

    data = {
        "status": "healthy" if db_healthy else "degraded",
        "service": "erp_main",
        "database": "healthy" if db_healthy else "unhealthy",
        "federation_credentials": {
            "yinglima": "configured" if yinglima_cred_configured else "not_configured",
            "inhyma": "configured" if inhyma_cred_configured else "not_configured",
            "erp-02": "configured" if yinglima_cred_configured else "not_configured",
            "erp-01": "configured" if inhyma_cred_configured else "not_configured",
        },
        "background_reconciliation": "enabled" if reconciliation_enabled else "disabled",
    }
    return build_success_response(data, request_id=request_id)
