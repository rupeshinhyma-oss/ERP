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


@router.get("/ready", summary="Readiness probe")
async def readiness(
    request: Request,
    health_service: HealthService = Depends(get_health_service),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Report whether the application is ready to serve traffic.

    Includes a live database connectivity check. Returns HTTP 503 when any
    critical dependency is down, which is what most orchestrators expect in
    order to pull an instance out of a load-balancer rotation.
    """
    report = await health_service.check_readiness(db_session)
    payload = build_success_response(data=asdict(report), request_id=request.state.request_id)

    if report.status != ComponentStatus.UP:
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content=payload)

    return payload


@router.get("/integration", summary="Cross-ERP integration health probe (Phase 8F)")
async def integration_health(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Integration subsystem health probe (Phase 8F Section 22).
    A remote peer being unavailable degrades integration health, but does NOT make local ERP dead.
    """
    from sqlalchemy import func, select

    from app.integration.models import IntegrationOutboxDelivery
    from app.integration.reliability import PeerCircuitBreakerService

    circuit_service = PeerCircuitBreakerService(db)
    peer_states = await circuit_service.list_all_states()

    status_counts_stmt = select(
        IntegrationOutboxDelivery.status,
        func.count(IntegrationOutboxDelivery.id),
    ).group_by(IntegrationOutboxDelivery.status)
    rows = (await db.execute(status_counts_stmt)).all()
    counts = {s.value if hasattr(s, "value") else str(s): cnt for s, cnt in rows}

    has_open_circuit = any(p.circuit_state == "OPEN" for p in peer_states)
    dead_letters = counts.get("DEAD_LETTER", 0)

    overall_status = "healthy"
    if has_open_circuit or dead_letters > 10:
        overall_status = "degraded"

    data = {
        "status": overall_status,
        "liveness": "healthy",
        "peer_circuits": {p.peer_id: p.circuit_state for p in peer_states},
        "deliveries": {
            "pending": counts.get("PENDING", 0),
            "processing": counts.get("PROCESSING", 0),
            "retrying": counts.get("RETRYING", 0),
            "delivered": counts.get("DELIVERED", 0),
            "dead_letter": counts.get("DEAD_LETTER", 0),
        },
    }
    return build_success_response(data=data, request_id=getattr(request.state, "request_id", "-"))

