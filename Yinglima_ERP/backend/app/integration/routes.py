"""
Integration Telemetry & Operations Routes (Phase 7, Phase 8E, Phase 8F).

Provides authenticated machine-to-machine telemetry, peer event ingestion,
resumable snapshots, generic reconciliation, circuit breaker observation,
and audited dead-letter replay without cross-database access.
"""

from __future__ import annotations

import hmac
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.integration.models import (
    DeliveryStatus,
    IntegrationOutboxDelivery,
    IntegrationOutboxEvent,
    OutboxEventStatus,
    PeerHealthState,
    SnapshotJob,
)
from app.integration.reliability import PeerCircuitBreakerService
from app.integration.sync_models import SyncedEntityMapping

router = APIRouter(prefix="/integration", tags=["Integration Operations & Telemetry"])

_bearer_scheme = HTTPBearer(auto_error=False)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def require_service_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> None:
    """Verify machine-to-machine service token from ERP_Main or authorized peer."""
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing service credential.",
        )

    expected = settings.FEDERATION_SERVICE_CREDENTIAL
    token = credentials.credentials

    if not hmac.compare_digest(token.encode("utf-8"), expected.encode("utf-8")):
        fallback = getattr(settings, "SECRET_KEY", "")
        if not fallback or not hmac.compare_digest(token.encode("utf-8"), fallback.encode("utf-8")):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid service credential.",
            )


# -----------------------------------------------------------------------------
# Health & Operational Status (Phase 8F Sections 21, 22, 23)
# -----------------------------------------------------------------------------

@router.get("/health", summary="Integration System Health (Phase 8F)")
async def get_integration_health(
    request: Request,
    _auth: None = Depends(require_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Detailed health check for cross-ERP integration components.
    Differentiates local database health from remote peer circuit states.
    """
    circuit_service = PeerCircuitBreakerService(db)
    peer_states = await circuit_service.list_all_states()

    # Delivery counts by status
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


@router.get("/status", summary="Integration Operations Overview (Phase 8F)")
async def get_integration_status(
    request: Request,
    _auth: None = Depends(require_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Comprehensive operational metrics: queue depth, oldest pending age,
    circuit breaker statuses, and conflict statistics.
    """
    circuit_service = PeerCircuitBreakerService(db)
    peer_states = await circuit_service.list_all_states()

    # Delivery status counts
    counts_stmt = select(
        IntegrationOutboxDelivery.status,
        func.count(IntegrationOutboxDelivery.id),
    ).group_by(IntegrationOutboxDelivery.status)
    counts = {s.value if hasattr(s, "value") else str(s): cnt for s, cnt in (await db.execute(counts_stmt)).all()}

    # Oldest pending delivery age
    oldest_stmt = select(func.min(IntegrationOutboxDelivery.created_at)).where(
        IntegrationOutboxDelivery.status.in_([DeliveryStatus.PENDING, DeliveryStatus.RETRYING])
    )
    oldest_ts = (await db.execute(oldest_stmt)).scalar_one_or_none()
    oldest_age_seconds = (_utcnow() - oldest_ts).total_seconds() if oldest_ts else 0.0

    # Conflict mappings count
    conflict_stmt = select(func.count(SyncedEntityMapping.id)).where(
        SyncedEntityMapping.sync_status == "CONFLICT"
    )
    conflict_count = (await db.execute(conflict_stmt)).scalar_one()

    # Active snapshot jobs
    snapshot_jobs_stmt = select(func.count(SnapshotJob.id)).where(
        SnapshotJob.status == "IN_PROGRESS"
    )
    active_snapshots = (await db.execute(snapshot_jobs_stmt)).scalar_one()

    data = {
        "queue_depth": counts.get("PENDING", 0) + counts.get("RETRYING", 0),
        "pending_count": counts.get("PENDING", 0),
        "retrying_count": counts.get("RETRYING", 0),
        "processing_count": counts.get("PROCESSING", 0),
        "delivered_count": counts.get("DELIVERED", 0),
        "dead_letter_count": counts.get("DEAD_LETTER", 0),
        "oldest_pending_age_seconds": round(max(0.0, oldest_age_seconds), 1),
        "active_conflicts": conflict_count,
        "active_snapshot_jobs": active_snapshots,
        "peers": [
            {
                "peer_id": p.peer_id,
                "circuit_state": p.circuit_state,
                "consecutive_failures": p.consecutive_failures,
                "cooldown_until": p.cooldown_until.isoformat() if p.cooldown_until else None,
                "last_failure_at": p.last_failure_at.isoformat() if p.last_failure_at else None,
                "last_success_at": p.last_success_at.isoformat() if p.last_success_at else None,
            }
            for p in peer_states
        ],
    }
    return build_success_response(data=data, request_id=getattr(request.state, "request_id", "-"))


# -----------------------------------------------------------------------------
# Dead-Letter Inspection & Safe Replay (Phase 8F Sections 9, 10)
# -----------------------------------------------------------------------------

@router.get("/dead-letters", summary="List Dead-Letter Deliveries (Phase 8F)")
async def list_dead_letters(
    request: Request,
    target_erp: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    _auth: None = Depends(require_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """List dead-letter deliveries with sanitized diagnostics for authorized inspection."""
    from app.integration.repository import IntegrationOutboxRepository

    repo = IntegrationOutboxRepository(db)
    deliveries = await repo.list_dead_letters(limit=limit, target_erp=target_erp)

    items = [
        {
            "delivery_id": str(d.id),
            "outbox_event_id": str(d.outbox_event_id),
            "event_id": str(d.outbox_event.event_id) if d.outbox_event else None,
            "event_type": d.outbox_event.event_type if d.outbox_event else None,
            "entity_type": d.outbox_event.aggregate_type if d.outbox_event else None,
            "entity_id": str(d.outbox_event.aggregate_id) if d.outbox_event else None,
            "correlation_id": str(d.outbox_event.correlation_id) if d.outbox_event else None,
            "target_erp": d.target_erp,
            "attempt_count": d.attempt_count,
            "max_attempts": d.max_attempts,
            "last_error_code": d.last_error_code,
            "last_error_message": d.last_error_message,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        }
        for d in deliveries
    ]
    return build_success_response(data={"items": items, "count": len(items)}, request_id=getattr(request.state, "request_id", "-"))


@router.post("/dead-letters/{delivery_id}/replay", summary="Replay Single Dead-Letter Delivery (Phase 8F)")
async def replay_dead_letter(
    delivery_id: uuid.UUID,
    request: Request,
    _auth: None = Depends(require_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Reset a dead-letter delivery back to PENDING, preserving original event identity."""
    from app.integration.repair import RepairService

    service = RepairService(db)
    success = await service.replay_dead_letter_delivery(delivery_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Dead-letter delivery '{delivery_id}' not found.")
    return build_success_response(data={"replayed": True, "delivery_id": str(delivery_id)}, request_id=getattr(request.state, "request_id", "-"))


@router.post("/dead-letters/bulk-replay", summary="Bulk Replay Dead-Letter Deliveries (Phase 8F)")
async def bulk_replay_dead_letters(
    request: Request,
    target_erp: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    _auth: None = Depends(require_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Bounded bulk replay of dead-letter deliveries."""
    from app.integration.repair import RepairService

    service = RepairService(db)
    count = await service.bulk_replay_dead_letters(target_erp=target_erp, limit=limit)
    return build_success_response(data={"replayed_count": count}, request_id=getattr(request.state, "request_id", "-"))


# -----------------------------------------------------------------------------
# Outbox Telemetry & Reconciliation (Phase 6, Phase 7, Phase 8E)
# -----------------------------------------------------------------------------

@router.get("/telemetry", summary="Outbox Telemetry for Global Operations")
async def get_integration_telemetry(
    request: Request,
    _auth: None = Depends(require_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Return outbox event counts and status metrics."""
    total_query = select(func.count(IntegrationOutboxEvent.id))
    total_count = (await db.execute(total_query)).scalar_one()

    status_query = select(
        IntegrationOutboxEvent.status,
        func.count(IntegrationOutboxEvent.id),
    ).group_by(IntegrationOutboxEvent.status)
    status_rows = (await db.execute(status_query)).all()
    by_status = {s.value if hasattr(s, "value") else str(s): cnt for s, cnt in status_rows}

    agg_query = select(
        IntegrationOutboxEvent.aggregate_type,
        func.count(IntegrationOutboxEvent.id),
    ).group_by(IntegrationOutboxEvent.aggregate_type)
    agg_rows = (await db.execute(agg_query)).all()
    by_aggregate_type = {agg: cnt for agg, cnt in agg_rows}

    last_event_query = select(func.max(IntegrationOutboxEvent.created_at))
    last_event_at = (await db.execute(last_event_query)).scalar_one_or_none()

    data = {
        "total_outbox_events": total_count,
        "published_count": by_status.get("PUBLISHED", 0),
        "pending_count": by_status.get("PENDING", 0),
        "failed_count": by_status.get("FAILED", 0),
        "dead_letter_count": by_status.get("DEAD_LETTER", 0),
        "by_aggregate_type": by_aggregate_type,
        "by_status": by_status,
        "last_event_at": last_event_at.isoformat() if last_event_at else None,
    }

    return build_success_response(data=data, request_id=getattr(request.state, "request_id", "-"))


@router.get("/reconciliation/buyer-sync", summary="Buyer Sync Reconciliation Report")
async def get_buyer_sync_reconciliation(
    request: Request,
    _auth: None = Depends(require_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Return local reconciliation report for the buyer synchronization pilot."""
    from app.integration.reconciliation import ReconciliationService

    report = await ReconciliationService(db).reconcile_buyer_sync()
    return build_success_response(data=report.to_dict(), request_id=getattr(request.state, "request_id", "-"))


@router.get("/reconciliation/{entity_type}", summary="Generic Entity Reconciliation Report")
async def get_generic_reconciliation(
    entity_type: str,
    request: Request,
    source_erp_id: str | None = None,
    _auth: None = Depends(require_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Return machine-readable reconciliation report for the specified entity type."""
    from app.integration.reconciliation import ReconciliationService

    report = await ReconciliationService(db).reconcile_entity(entity_type, source_erp_id=source_erp_id)
    return build_success_response(data=report.to_dict(), request_id=getattr(request.state, "request_id", "-"))


# -----------------------------------------------------------------------------
# Direct Peer Event Ingestion (Phase 8E & Phase 8F)
# -----------------------------------------------------------------------------

@router.post("/events", summary="Ingest Direct Peer Integration Event")
async def ingest_direct_event(
    envelope: dict[str, Any],
    request: Request,
    _auth: None = Depends(require_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Ingest a cross-ERP integration event delivered directly from a peer ERP.
    Processes atomically through GenericSyncEngine.
    """
    from app.integration.sync_engine import GenericSyncEngine

    engine = GenericSyncEngine()
    result = await engine.process_event(db, envelope)
    await db.commit()
    return build_success_response(data=result.to_dict(), request_id=getattr(request.state, "request_id", "-"))


# -----------------------------------------------------------------------------
# Resumable Snapshots (Phase 8E & Phase 8F Sections 15, 16)
# -----------------------------------------------------------------------------

@router.get("/snapshots/{entity_type}", summary="Export Entity Snapshot")
async def export_entity_snapshot(
    entity_type: str,
    request: Request,
    limit: int = 100,
    offset: int = 0,
    _auth: None = Depends(require_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Export active records of the given entity type as a versioned snapshot."""
    from app.integration.snapshots import SnapshotService

    service = SnapshotService(db)
    data = await service.export_snapshot(entity_type, limit=limit, offset=offset)
    return build_success_response(data=data, request_id=getattr(request.state, "request_id", "-"))


@router.post("/snapshots/{entity_type}/jobs", summary="Start Resumable Snapshot Job (Phase 8F)")
async def start_snapshot_job(
    entity_type: str,
    target_erp: str,
    request: Request,
    batch_size: int = 100,
    _auth: None = Depends(require_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Initialize a checkpointed, resumable snapshot export job."""
    from app.integration.snapshots import SnapshotService

    service = SnapshotService(db)
    job = await service.start_snapshot_job(entity_type, target_erp, batch_size=batch_size)
    return build_success_response(
        data={
            "job_id": str(job.id),
            "entity_type": job.entity_type,
            "target_erp": job.target_erp,
            "total_records": job.total_records,
            "batch_size": job.batch_size,
            "status": job.status,
        },
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/snapshots/jobs/{job_id}/chunk", summary="Export Next Snapshot Chunk (Phase 8F)")
async def export_snapshot_chunk(
    job_id: uuid.UUID,
    request: Request,
    _auth: None = Depends(require_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Fetch the next chunk for a snapshot job, advancing the cursor."""
    from app.integration.snapshots import SnapshotService

    service = SnapshotService(db)
    data = await service.export_snapshot_chunk(job_id)
    return build_success_response(data=data, request_id=getattr(request.state, "request_id", "-"))


@router.post("/snapshots/{entity_type}/ingest", summary="Ingest Entity Snapshot")
async def ingest_entity_snapshot(
    entity_type: str,
    snapshot_data: dict[str, Any],
    request: Request,
    _auth: None = Depends(require_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Ingest a batch snapshot through the generic synchronization engine."""
    from app.integration.snapshots import SnapshotService
    from app.integration.sync_engine import GenericSyncEngine

    service = SnapshotService(db)
    engine = GenericSyncEngine()
    summary = await service.ingest_snapshot(engine, snapshot_data)
    return build_success_response(data=summary, request_id=getattr(request.state, "request_id", "-"))


# -----------------------------------------------------------------------------
# Entity Repair & Outbox Retry (Phase 8E)
# -----------------------------------------------------------------------------

@router.post("/repair/{entity_type}/missing-mapping", summary="Repair Missing Mapping")
async def repair_missing_mapping(
    entity_type: str,
    repair_data: dict[str, Any],
    request: Request,
    _auth: None = Depends(require_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Discover and establish missing identity mapping without creating duplicates."""
    from app.integration.repair import RepairService

    service = RepairService(db)
    mapping = await service.repair_missing_mapping(
        source_erp_id=repair_data.get("source_erp_id", ""),
        entity_type=entity_type,
        source_entity_id=repair_data.get("source_entity_id", ""),
        payload=repair_data.get("payload", {}),
    )
    return build_success_response(
        data={"repaired": mapping is not None, "local_id": str(mapping.local_entity_id) if mapping else None},
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/outbox/{event_id}/retry", summary="Retry Outbox Event")
async def retry_outbox_event(
    event_id: uuid.UUID,
    request: Request,
    _auth: None = Depends(require_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Reset a dead-letter or failed outbox event and its deliveries back to PENDING."""
    from app.integration.repair import RepairService

    service = RepairService(db)
    success = await service.retry_outbox_event(event_id)
    return build_success_response(data={"retried": success}, request_id=getattr(request.state, "request_id", "-"))
