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


_FEDERATION_PROBE_CACHE: tuple[float, list[dict]] | None = None
_FEDERATION_PROBE_TTL_SECONDS = 15.0


async def _is_authorized_diagnostics_caller(request: Request, db: AsyncSession | None = None) -> bool:
    """Return True if caller holds a valid service credential or super-admin/operator JWT."""
    import hmac

    from app.auth.dependencies import get_auth_service
    from app.auth.security import InvalidTokenError, TokenType, decode_token
    from app.cache.dependency import get_cache
    from app.core.config import settings

    auth_header = (request.headers.get("authorization") or "").strip()
    token = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
    if not token:
        return False

    expected_service_creds = set(settings.get_expected_erp_main_credentials())
    if any(hmac.compare_digest(token, cred) for cred in expected_service_creds if cred):
        return True

    try:
        claims = decode_token(token, expected_type=TokenType.ACCESS)
    except InvalidTokenError:
        return False
    perms = set(claims.get("perms") or [])
    if "*" in perms or "organization.manage" in perms or "audit.view" in perms:
        return True
    if db is not None:
        try:
            auth_service = get_auth_service(db=db, cache=get_cache())
            user = await auth_service.get_current_user_from_token(token)
            if user.is_super_admin or "organization.manage" in user.permissions or "audit.view" in user.permissions:
                return True
        except Exception:
            return False
    return False


async def _probe_erp_main_urls() -> list[dict]:
    """Probe ERP_Main health endpoints in parallel with bounded timeout + 15s cache (BUG-026)."""
    global _FEDERATION_PROBE_CACHE
    import asyncio
    import time as _time

    import httpx

    from app.federation.erp_main_client import _client_for_erp_main, erp_main_api_base_urls

    now = _time.monotonic()
    if _FEDERATION_PROBE_CACHE is not None and (now - _FEDERATION_PROBE_CACHE[0]) < _FEDERATION_PROBE_TTL_SECONDS:
        return _FEDERATION_PROBE_CACHE[1]

    async def _probe_one(base: str) -> dict:
        started = _time.monotonic()
        try:
            async with _client_for_erp_main(httpx.Timeout(2.0, connect=1.5)) as http_client:
                r = await http_client.get(f"{base}/health/live")
            return {"url": base, "reachable": True, "status": r.status_code, "ms": round((_time.monotonic() - started) * 1000)}
        except Exception as exc:  # diagnostics only
            return {"url": base, "reachable": False, "error": f"{type(exc).__name__}: {str(exc)[:160]}"}

    urls = erp_main_api_base_urls()
    probes = list(await asyncio.gather(*(_probe_one(u) for u in urls))) if urls else []
    _FEDERATION_PROBE_CACHE = (_time.monotonic(), probes)
    return probes


@router.get("/federation", summary="Cross-ERP sign-in diagnostics (no secrets)")
async def federation_health(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Reports SSO readiness minimally to public callers (0 outbound probes, <5ms)
    and cached parallel ERP_Main diagnostics to authorized operators. Never returns credentials.
    """
    from app.core.config import settings
    from app.federation.erp_main_client import VERIFY_DIAGNOSTICS

    problems = settings.federation_config_problems()
    if not await _is_authorized_diagnostics_caller(request, db=db):
        return build_success_response(
            data={
                "status": "healthy" if not problems else "degraded",
                "sso_enabled": bool(settings.ERP_MAIN_API_BASE_URL or settings.ERP_MAIN_URL),
            },
            request_id=getattr(request.state, "request_id", "-"),
        )

    probes = await _probe_erp_main_urls()
    data = {
        "environment": str(getattr(settings.ENVIRONMENT, "value", settings.ENVIRONMENT)),
        "erp_key": settings.ERP_KEY,
        "central_verification_required": settings.SSO_HANDOVER_REQUIRE_CENTRAL_VERIFICATION,
        "service_credential_configured": bool(settings.get_expected_erp_main_credentials()),
        "config_problems": problems,
        "erp_main_probes": probes,
        "last_session_verification": dict(VERIFY_DIAGNOSTICS),
    }
    return build_success_response(data=data, request_id=getattr(request.state, "request_id", "-"))