"""
Durable Events Admin Routes (Phase 3, Section 20).

Read-only inspection plus authorized replay of dead-lettered
deliveries. Gated by `require_super_admin` -- replay is a genuinely
privileged, side-effecting platform operation, matching how this
codebase already gates comparably sensitive actions (see
`app.rbac.dependencies.require_super_admin`, already used for other
platform-wide administrative operations) rather than inventing a new,
unregistered permission code.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import CurrentUser
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.durable_events.repository import DeadLetterEventRepository, EventDeliveryRepository
from app.durable_events.service import DurableEventService
from app.rbac.dependencies import require_super_admin

router = APIRouter(prefix="/durable-events", tags=["Durable Events (Admin)"])


def _dead_letter_to_dict(dl) -> dict:
    """Build a dead-letter response dict."""
    return {
        "id": str(dl.id),
        "delivery_id": str(dl.delivery_id),
        "event_id": str(dl.event_id),
        "consumer_id": str(dl.consumer_id),
        "event_type": dl.event_type,
        "attempt_count": dl.attempt_count,
        "first_failed_at": dl.first_failed_at.isoformat(),
        "last_failed_at": dl.last_failed_at.isoformat(),
        "failure_reason": dl.failure_reason,
        "replayed_at": dl.replayed_at.isoformat() if dl.replayed_at else None,
        "replayed_by": dl.replayed_by,
    }


@router.get("/dead-letters", summary="List unreplayed dead-lettered event deliveries")
async def list_dead_letters(
    request: Request,
    limit: int = Query(default=100, ge=1, le=1000),
    _current_user: CurrentUser = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """List dead-lettered deliveries not yet successfully replayed (Section 20)."""
    dead_letters = await DeadLetterEventRepository(db).list_unreplayed(limit=limit)
    return build_success_response(
        [_dead_letter_to_dict(dl) for dl in dead_letters], request_id=request.state.request_id
    )


@router.get("/deliveries/{event_id}", summary="List every consumer's delivery state for one event")
async def list_deliveries_for_event(
    request: Request,
    event_id: uuid.UUID,
    _current_user: CurrentUser = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Show one event's full delivery state across every consumer (Section 38 diagnostics)."""
    deliveries = await EventDeliveryRepository(db).list_for_event(event_id)
    data = [
        {
            "id": str(d.id),
            "consumer_id": str(d.consumer_id),
            "status": d.status.value,
            "attempt_count": d.attempt_count,
            "max_attempts": d.max_attempts,
            "available_at": d.available_at.isoformat(),
            "last_error": d.last_error,
            "processed_at": d.processed_at.isoformat() if d.processed_at else None,
        }
        for d in deliveries
    ]
    return build_success_response(data, request_id=request.state.request_id)


@router.post("/dead-letters/{dead_letter_id}/replay", summary="Replay a dead-lettered event delivery")
async def replay_dead_letter(
    request: Request,
    dead_letter_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Reset a dead-lettered delivery back to PENDING with a fresh attempt budget (Section 20)."""
    service = DurableEventService(db)
    delivery = await service.replay_dead_letter(dead_letter_id, replayed_by=str(current_user.id))
    await db.commit()
    return build_success_response(
        {"delivery_id": str(delivery.id), "status": delivery.status.value},
        request_id=request.state.request_id,
        message="Dead letter replay scheduled.",
    )
