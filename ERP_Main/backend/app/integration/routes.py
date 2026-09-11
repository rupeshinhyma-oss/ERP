"""
Integration Control-Plane Routes (Phase 6).

Two trust boundaries, mirroring the same pattern `app.service_identity`
and `app.federation` already established:

- `internal_router`: `POST /internal/integration/events` -- the ONLY way
  an event enters ERP_Main. Gated by `require_erp_service` (machine
  credential only, Section 36) -- never a human session. The caller's
  `source_erp` claim in the request body is cross-checked against its
  verified credential's own `erp_instance_id` and REJECTED on mismatch
  (Section 22: never trust source from the payload alone).
- `admin_router`: subscriptions, inbox inspection, dead letters, replay,
  entity mappings -- all gated by Phase 5's `require_platform_permission`
  (Section 47: "All privileged actions must use Phase 5 authorization").
"""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, Request, status

from app.core.exceptions import ForbiddenException, NotFoundException
from app.core.responses import build_success_response
from app.erp_registry.repository import ErpInstanceRepository
from app.integration.dependencies import get_integration_service
from app.integration.schemas import (
    DeadLetterRead,
    EntityMappingCreate,
    EntityMappingRead,
    IncomingEventEnvelope,
    IntegrationSubscriptionCreate,
    IntegrationSubscriptionRead,
    IntegrationSubscriptionUpdate,
)
from app.integration.service import IntegrationService
from app.platform_authz.dependencies import AuthorizedPrincipal, require_platform_permission
from app.service_identity.dependencies import require_erp_service
from app.service_identity.models import ErpServiceCredential

internal_router = APIRouter(prefix="/internal/integration", tags=["Integration (internal)"])
admin_router = APIRouter(prefix="/global/integration", tags=["Integration Administration"])

_MANAGE = "platform.system.manage"
_SENSITIVE_PATTERNS = {"password", "secret", "token", "key", "credential", "private_key", "api_key", "access_token", "refresh_token", "hash"}


def _request_id(request: Request) -> str:
    """Return the request's correlation ID set by `RequestIdMiddleware`."""
    return getattr(request.state, "request_id", "")


def _sanitize_payload(data):
    """Recursively redact sensitive fields from integration payloads (Prompt 6 Section 8/37)."""
    if isinstance(data, dict):
        sanitized = {}
        for k, v in data.items():
            k_lower = str(k).lower()
            if any(p in k_lower for p in _SENSITIVE_PATTERNS):
                sanitized[k] = "[REDACTED]"
            else:
                sanitized[k] = _sanitize_payload(v)
        return sanitized
    if isinstance(data, list):
        return [_sanitize_payload(item) for item in data]
    return data


def _inbox_to_dict(event, include_payload: bool = False) -> dict:
    """Build an inbox event response dict, decoding the stored JSON `routed_to` list and optional sanitized payload."""
    res = {
        "id": str(event.id),
        "event_id": str(event.event_id),
        "event_type": event.event_type,
        "event_version": event.event_version,
        "source_erp_id": str(event.source_erp_id),
        "source_entity_type": event.source_entity_type,
        "source_entity_id": str(event.source_entity_id),
        "correlation_id": str(event.correlation_id),
        "causation_id": str(event.causation_id) if event.causation_id else None,
        "status": event.status.value,
        "routed_to": json.loads(event.routed_to) if event.routed_to else [],
        "attempt_count": event.attempt_count,
        "last_error": event.last_error,
        "created_at": event.created_at.isoformat(),
    }
    if include_payload:
        raw_payload = getattr(event, "payload", None)
        if isinstance(raw_payload, str):
            try:
                parsed = json.loads(raw_payload)
            except Exception:
                parsed = {"raw": raw_payload}
        elif isinstance(raw_payload, dict):
            parsed = raw_payload
        else:
            parsed = {}
        res["payload"] = _sanitize_payload(parsed)
    return res


@internal_router.post(
    "/events", status_code=status.HTTP_201_CREATED, summary="Receive a cross-ERP integration event"
)
async def receive_event(
    request: Request,
    envelope: IncomingEventEnvelope,
    credential: ErpServiceCredential = Depends(require_erp_service),
    service: IntegrationService = Depends(get_integration_service),
) -> dict:
    """
    Ingest one integration event from a producer ERP's own backend.

    The caller's identity comes entirely from its verified service
    credential (`credential.erp_instance_id`), never from
    `envelope.source_erp` -- if a caller's credential belongs to a
    DIFFERENT ERP than the one it claims in the envelope, the request is
    rejected outright (Section 22/38: no token can spoof another ERP's
    identity). Idempotent: a duplicate `event_id` is safe to resend.
    """
    instance_repo = ErpInstanceRepository(service.inbox_repository.db)
    verified_instance = await instance_repo.get_by_id(credential.erp_instance_id)
    if verified_instance is None or verified_instance.key != envelope.source_erp:
        raise ForbiddenException(
            "The envelope's source_erp does not match the authenticated service credential's own ERP identity."
        )

    result = await service.ingest_event(envelope, verified_source_erp_id=credential.erp_instance_id)
    return build_success_response(result.model_dump(mode="json"), request_id=_request_id(request))


@internal_router.get("/inbox", summary="Poll for events routed to the calling ERP")
async def poll_inbox(
    request: Request,
    since: str | None = None,
    limit: int = 200,
    credential: ErpServiceCredential = Depends(require_erp_service),
    service: IntegrationService = Depends(get_integration_service),
) -> dict:
    """
    Poll for ROUTED events destined for the calling ERP, for its own consumer to process (Section 14).

    `since` is an ISO-8601 timestamp (defaults to the Unix epoch, i.e.
    "everything") -- the caller's own consumer is expected to persist
    the `created_at` of the last event it successfully processed and
    pass that back on the next poll, exactly like a cursor. The calling
    ERP's identity comes only from its verified service credential
    (never a query parameter), so an ERP can only ever poll for events
    routed to itself.
    """
    from datetime import datetime, timezone

    instance_repo = ErpInstanceRepository(service.inbox_repository.db)
    verified_instance = await instance_repo.get_by_id(credential.erp_instance_id)
    if verified_instance is None:
        raise ForbiddenException("This service credential's ERP instance no longer exists.")

    since_dt = datetime.fromisoformat(since) if since else datetime(1970, 1, 1, tzinfo=timezone.utc)
    events = await service.poll_inbox_for_consumer(consumer_erp_key=verified_instance.key, since=since_dt, limit=limit)
    return build_success_response([_inbox_to_dict(e) for e in events], request_id=_request_id(request))


@admin_router.post("/subscriptions", status_code=status.HTTP_201_CREATED, summary="Create a routing subscription")
async def create_subscription(
    request: Request,
    payload: IntegrationSubscriptionCreate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: IntegrationService = Depends(get_integration_service),
) -> dict:
    """Create a routing subscription: which event_type from which source ERP goes to which target."""
    subscription = await service.create_subscription(
        payload, actor_id=principal.principal_id, actor_label=principal.principal_label
    )
    return build_success_response(
        IntegrationSubscriptionRead.model_validate(subscription).model_dump(mode="json"),
        request_id=_request_id(request),
    )


@admin_router.get("/subscriptions", summary="List every configured routing subscription")
async def list_subscriptions(
    request: Request,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: IntegrationService = Depends(get_integration_service),
) -> dict:
    """List every configured subscription, enabled or not."""
    subscriptions = await service.list_subscriptions()
    data = [IntegrationSubscriptionRead.model_validate(s).model_dump(mode="json") for s in subscriptions]
    return build_success_response(data, request_id=_request_id(request))


@admin_router.patch("/subscriptions/{subscription_id}", summary="Update a routing subscription")
async def update_subscription(
    request: Request,
    subscription_id: uuid.UUID,
    payload: IntegrationSubscriptionUpdate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: IntegrationService = Depends(get_integration_service),
) -> dict:
    """Update a subscription's enabled flag or required capability."""
    subscription = await service.update_subscription(
        subscription_id, payload, actor_id=principal.principal_id, actor_label=principal.principal_label
    )
    return build_success_response(
        IntegrationSubscriptionRead.model_validate(subscription).model_dump(mode="json"),
        request_id=_request_id(request),
        message="Subscription updated.",
    )


@admin_router.get("/inbox", summary="List recent received integration events")
async def list_inbox(
    request: Request,
    limit: int = 100,
    status_filter: str | None = None,
    event_type: str | None = None,
    correlation_id: uuid.UUID | None = None,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: IntegrationService = Depends(get_integration_service),
) -> dict:
    """List recent inbox events, optionally filtered by status, event_type, or correlation_id."""
    events = await service.list_inbox(
        limit=limit, status=status_filter, event_type=event_type, correlation_id=correlation_id
    )
    return build_success_response([_inbox_to_dict(e) for e in events], request_id=_request_id(request))


@admin_router.get("/inbox/{event_id}", summary="Get detailed inbox event including sanitized payload")
async def get_inbox_event(
    request: Request,
    event_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: IntegrationService = Depends(get_integration_service),
) -> dict:
    """Fetch an inbox event by row id or producer event_id with sanitized payload for safe operator inspection."""
    event = await service.get_inbox_event(event_id)
    if event is None:
        raise NotFoundException(f"No integration event found with ID {event_id}.")
    return build_success_response(_inbox_to_dict(event, include_payload=True), request_id=_request_id(request))


@admin_router.get("/dead-letters", summary="List unreplayed dead-lettered events")
async def list_dead_letters(
    request: Request,
    limit: int = 100,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: IntegrationService = Depends(get_integration_service),
) -> dict:
    """List every dead-lettered event that has not yet been successfully replayed."""
    dead_letters = await service.list_dead_letters(limit=limit)
    data = [DeadLetterRead.model_validate(d).model_dump(mode="json") for d in dead_letters]
    return build_success_response(data, request_id=_request_id(request))


@admin_router.post("/dead-letters/{dead_letter_id}/replay", summary="Replay a dead-lettered event")
async def replay_dead_letter(
    request: Request,
    dead_letter_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: IntegrationService = Depends(get_integration_service),
) -> dict:
    """
    Re-attempt routing for a dead-lettered event.

    Requires `platform.system.manage` (or PlatformAdmin) -- Section 19:
    "Do not allow arbitrary users to replay events." Every replay is
    audited with the acting principal's identity.
    """
    inbox_event = await service.replay_dead_letter(
        dead_letter_id, actor_id=principal.principal_id, actor_label=principal.principal_label
    )
    return build_success_response(
        _inbox_to_dict(inbox_event), request_id=_request_id(request), message="Replay attempted."
    )


@admin_router.post("/mappings", status_code=status.HTTP_201_CREATED, summary="Create a cross-ERP entity mapping")
async def create_entity_mapping(
    request: Request,
    payload: EntityMappingCreate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: IntegrationService = Depends(get_integration_service),
) -> dict:
    """Create an explicit cross-ERP identity mapping (Section 30). Idempotent for an identical mapping."""
    mapping = await service.create_entity_mapping(
        payload, actor_id=principal.principal_id, actor_label=principal.principal_label
    )
    return build_success_response(
        EntityMappingRead.model_validate(mapping).model_dump(mode="json"), request_id=_request_id(request)
    )


@admin_router.get(
    "/mappings/{source_erp_id}/{source_entity_type}/{source_entity_id}",
    summary="List every known mapping for a source entity",
)
async def list_entity_mappings(
    request: Request,
    source_erp_id: uuid.UUID,
    source_entity_type: str,
    source_entity_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: IntegrationService = Depends(get_integration_service),
) -> dict:
    """List every known cross-ERP mapping for a given source entity."""
    mappings = await service.list_mappings_for_source_entity(source_erp_id, source_entity_type, source_entity_id)
    data = [EntityMappingRead.model_validate(m).model_dump(mode="json") for m in mappings]
    return build_success_response(data, request_id=_request_id(request))


@admin_router.get(
    "/mesh-status",
    summary="Cross-ERP integration mesh status (Phase 8F Control-Plane Operations View)",
)
async def get_mesh_status(
    request: Request,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: IntegrationService = Depends(get_integration_service),
) -> dict:
    """
    Control-plane operational view (Phase 8F Section 24).
    Aggregates ERP registry status, dead-letter totals, and subscription topology.
    Does NOT act as a runtime relay or synchronous dependency.
    """
    from sqlalchemy import select

    from app.erp_registry.models import ErpInstance

    instances_res = await service.session.execute(select(ErpInstance))
    instances = instances_res.scalars().all()

    dead_letters = await service.list_dead_letters(limit=100)
    subs = await service.list_subscriptions(limit=100)

    mesh_nodes = [
        {
            "erp_id": str(inst.id),
            "erp_key": inst.erp_key,
            "name": inst.name,
            "status": inst.status.value if hasattr(inst.status, "value") else str(inst.status),
            "base_url": inst.base_url,
        }
        for inst in instances
    ]

    data = {
        "node_count": len(mesh_nodes),
        "nodes": mesh_nodes,
        "active_subscriptions": len(subs),
        "total_unreplayed_dead_letters": len(dead_letters),
        "supported_contract_versions": [1, 2],
    }
    return build_success_response(data, request_id=_request_id(request))

