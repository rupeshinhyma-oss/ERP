"""
Health Check Routes.

Exposes liveness and readiness endpoints, standard in any production
deployment for use by load balancers, container orchestrators (e.g.
Kubernetes liveness/readiness probes), and uptime monitors.

These routes are intentionally thin: all actual logic lives in
:class:`app.core.health.HealthService`.
"""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.health import ComponentStatus, HealthService
from app.core.responses import build_success_response
from app.database.session import get_db_session

router = APIRouter(prefix="/health", tags=["Health"])


def get_health_service() -> HealthService:
    """Provide a :class:`HealthService` instance (stateless, so a fresh one is cheap)."""
    return HealthService()


@router.get("/live", summary="Liveness probe")
async def liveness(
    request: Request,
    health_service: HealthService = Depends(get_health_service),
) -> dict:
    """
    Report whether the application process itself is alive.

    Does not check external dependencies. A failing liveness probe should
    cause an orchestrator to restart the process; it should not be tripped
    by a transient database outage (that's what readiness is for).
    """
    report = await health_service.check_liveness()
    return build_success_response(data=asdict(report), request_id=request.state.request_id)


@router.get("/ready", summary="Readiness probe", response_model=None)
async def readiness(
    request: Request,
    health_service: HealthService = Depends(get_health_service),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict | JSONResponse:
    """
    Report whether the application is ready to serve traffic.

    Includes a live database connectivity check. Returns HTTP 503 when any
    critical dependency is down, which is what most orchestrators expect in
    order to pull an instance out of a load-balancer rotation.
    """
    report = await health_service.check_readiness(db_session)
    payload = build_success_response(data=asdict(report), request_id=request.state.request_id)

    if report.status != ComponentStatus.UP:
        return JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content=payload)

    return payload


@router.get("/federation", summary="Cross-ERP sign-in diagnostics (no secrets)")
async def federation_health(request: Request) -> dict:
    """
    Shows whether this ERP can reach ERP_Main for SSO, which URL it uses, and the reason for the latest failure.
    Probes ERP_Main live (short timeout).  Never returns credentials.
    """
    import time as _time

    import httpx

    from app.core.config import settings
    from app.federation.erp_main_client import VERIFY_DIAGNOSTICS, _client_for_erp_main, erp_main_api_base_urls

    probes = []
    for base in erp_main_api_base_urls():
        started = _time.monotonic()
        try:
            async with _client_for_erp_main(httpx.Timeout(8.0)) as http_client:
                r = await http_client.get(f"{base}/health/live")
            probes.append({"url": base, "reachable": True, "status": r.status_code, "ms": round((_time.monotonic() - started) * 1000)})
        except Exception as exc:  # diagnostics only
            probes.append({"url": base, "reachable": False, "error": f"{type(exc).__name__}: {str(exc)[:160]}"})
    data = {
        "environment": str(getattr(settings.ENVIRONMENT, "value", settings.ENVIRONMENT)),
        "erp_key": settings.ERP_KEY,
        "central_verification_required": settings.SSO_HANDOVER_REQUIRE_CENTRAL_VERIFICATION,
        "service_credential_configured": bool(settings.get_expected_erp_main_credentials()),
        "config_problems": settings.federation_config_problems(),
        "erp_main_probes": probes,
        "last_session_verification": dict(VERIFY_DIAGNOSTICS),
    }
    return build_success_response(data=data, request_id=request.state.request_id)