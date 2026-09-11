"""
Integration Control-Plane Service (Phase 6).

The core operation is `ingest_event`: a producer ERP (authenticated via
its service credential, Section 36) POSTs an event envelope; this
service deduplicates it by `event_id` (Section 15/16 -- at-least-once
delivery is assumed, never exactly-once), records it in the inbox, and
resolves routing purely from `IntegrationSubscription` + `ErpModule`
capability rows -- never a hardcoded `if erp_key == ...` branch anywhere
(Section 24/72).

Retry/dead-letter here is intentionally simple: routing itself (writing
`routed_to` and marking ROUTED) is synchronous and either fully succeeds
or fully fails within `ingest_event` -- there is no separate delivery
step to retry, because "routing" in this phase means "record which
target(s) this event is destined for," not "call the target ERP's API."
Actually notifying/pulling by the target ERP is the target's own
consumer's job (see each ERP's own `app/integration/worker.py`), which
polls `GET /internal/integration/inbox` for events routed to it -- so
"delivery failure" from ERP_Main's own point of view is only "I could
not even record/route the event," which is what `record_routing_failure`
below handles by escalating attempt_count and, past a threshold,
creating a dead letter.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

from app.core.exceptions import ConflictException, ForbiddenException, NotFoundException
from app.erp_registry.repository import ErpInstanceRepository, ErpModuleRepository
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService
from app.integration.models import (
    InboxEventStatus,
    IntegrationDeadLetter,
    IntegrationEntityMapping,
    IntegrationInboxEvent,
    IntegrationSubscription,
    IntegrationTarget,
)
from app.integration.repository import (
    IntegrationDeadLetterRepository,
    IntegrationEntityMappingRepository,
    IntegrationInboxRepository,
    IntegrationSubscriptionRepository,
)
from app.integration.schemas import (
    EntityMappingCreate,
    IncomingEventEnvelope,
    IngestResult,
    IntegrationSubscriptionCreate,
    IntegrationSubscriptionUpdate,
)

# Past this many recorded routing attempts, an event is dead-lettered
# rather than retried again (Phase 6 Section 17: "Do not retry forever").
_MAX_ROUTING_ATTEMPTS = 5


class IntegrationService:
    """Orchestrates event ingestion, capability-aware routing, dead-letter handling, and replay."""

    def __init__(
        self,
        subscription_repository: IntegrationSubscriptionRepository,
        inbox_repository: IntegrationInboxRepository,
        mapping_repository: IntegrationEntityMappingRepository,
        dead_letter_repository: IntegrationDeadLetterRepository,
        erp_instance_repository: ErpInstanceRepository,
        erp_module_repository: ErpModuleRepository,
        audit: GlobalAuditService,
    ) -> None:
        """Wire the service to its repositories and the global audit service."""
        self.subscription_repository = subscription_repository
        self.inbox_repository = inbox_repository
        self.mapping_repository = mapping_repository
        self.dead_letter_repository = dead_letter_repository
        self.erp_instance_repository = erp_instance_repository
        self.erp_module_repository = erp_module_repository
        self.audit = audit

    async def ingest_event(
        self, envelope: IncomingEventEnvelope, *, verified_source_erp_id: uuid.UUID
    ) -> IngestResult:
        """
        Ingest one event from an authenticated producer ERP.

        `verified_source_erp_id` comes from the caller's verified service
        credential (`require_erp_service`), NEVER from `envelope.source_erp`
        -- the route handler cross-checks the two match before calling
        this method at all (Section 22), so by the time this runs,
        `verified_source_erp_id` is the only trusted source identity.

        Deduplicates by `event_id` first (Section 15/16): a duplicate
        delivery returns the ALREADY-RECORDED result rather than
        re-routing or erroring, so a producer's at-least-once retry is
        always safe to resend.
        """
        existing = await self.inbox_repository.get_by_event_id(envelope.event_id)
        if existing is not None:
            await self.audit.record(
                event_type=AuditEventType.INTEGRATION_EVENT_DUPLICATE,
                actor_type=AuditActorType.ERP_SERVICE,
                actor_id=verified_source_erp_id,
                actor_label=f"erp:{verified_source_erp_id}",
                target_type="integration_inbox_event",
                target_id=existing.id,
                details={"event_id": str(envelope.event_id), "event_type": envelope.event_type},
            )
            return IngestResult(
                event_id=envelope.event_id,
                inbox_event_id=existing.id,
                duplicate=True,
                status=existing.status,
                routed_to=json.loads(existing.routed_to) if existing.routed_to else [],
            )

        inbox_event = IntegrationInboxEvent(
            event_id=envelope.event_id,
            event_type=envelope.event_type,
            event_version=envelope.event_version,
            source_erp_id=verified_source_erp_id,
            source_entity_type=envelope.source_entity_type,
            source_entity_id=envelope.source_entity_id,
            correlation_id=envelope.correlation_id,
            causation_id=envelope.causation_id,
            actor_type=envelope.actor_type,
            actor_id=envelope.actor_id,
            occurred_at=envelope.occurred_at,
            payload=json.dumps(envelope.payload),
            status=InboxEventStatus.RECEIVED,
        )
        created = await self.inbox_repository.create(inbox_event)
        await self.audit.record(
            event_type=AuditEventType.INTEGRATION_EVENT_RECEIVED,
            actor_type=AuditActorType.ERP_SERVICE,
            actor_id=verified_source_erp_id,
            actor_label=f"erp:{verified_source_erp_id}",
            target_type="integration_inbox_event",
            target_id=created.id,
            details={"event_id": str(envelope.event_id), "event_type": envelope.event_type},
        )

        if envelope.event_type == "user.created":
            try:
                from app.identity_linking.dependencies import get_identity_linking_service

                linking_service = get_identity_linking_service(
                    db=self.inbox_repository.db,
                    audit_service=self.audit,
                )
                payload = envelope.payload
                await linking_service.evaluate_and_link_user(
                    erp_instance_id=verified_source_erp_id,
                    local_user_id=str(payload.get("local_user_id", envelope.source_entity_id)),
                    email=payload.get("email", ""),
                    display_name=payload.get("display_name", ""),
                    username=payload.get("username"),
                    details=payload,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Identity linking evaluation failed for user.created event: %s", exc)

        # Phase 7: Real-time projection materialization for global reporting
        try:
            from app.reporting.dependencies import get_projection_service

            projection_service = get_projection_service(db=self.inbox_repository.db)
            await projection_service.handle_inbox_event(created)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Projection materialization failed for event %s: %s", envelope.event_id, exc)

        try:
            routed_to = await self._route(created)
        except Exception as exc:  # noqa: BLE001 - deliberately broad: any routing failure must be recorded, not raised
            await self._record_routing_failure(created, str(exc))
            return IngestResult(
                event_id=envelope.event_id,
                inbox_event_id=created.id,
                duplicate=False,
                status=created.status,
                routed_to=[],
            )

        return IngestResult(
            event_id=envelope.event_id,
            inbox_event_id=created.id,
            duplicate=False,
            status=created.status,
            routed_to=routed_to,
        )

    async def _route(self, inbox_event: IntegrationInboxEvent) -> list[str]:
        """
        Resolve every enabled subscription matching this event and record where it was routed.

        Capability-aware (Section 25): a SPECIFIC_ERP subscription with
        a `required_capability` is skipped -- not an error -- if the
        target ERP hasn't declared that `ErpModule.module_key`. A
        BROADCAST subscription expands to every ACTIVE, capability-
        matching ERP other than the source. An event matching zero
        subscriptions is marked IGNORED, which is a valid, non-error
        outcome (Section 6's spirit runs both ways -- not every received
        event needs a home).
        """
        subscriptions = await self.subscription_repository.list_matching(
            inbox_event.event_type, inbox_event.source_erp_id
        )
        target_keys: list[str] = []

        for subscription in subscriptions:
            if subscription.target_kind == IntegrationTarget.SPECIFIC_ERP:
                target = await self.erp_instance_repository.get_by_id(subscription.target_erp_id)
                if target is None or target.status.value != "ACTIVE":
                    continue  # target gone or not eligible: skip, not an error
                if not await self._erp_has_capability(target.id, subscription.required_capability):
                    continue
                target_keys.append(target.key)
            else:  # BROADCAST
                target_keys.extend(await self._resolve_broadcast_targets(inbox_event.source_erp_id, subscription))

        inbox_event.routed_to = json.dumps(sorted(set(target_keys)))
        inbox_event.status = InboxEventStatus.ROUTED if target_keys else InboxEventStatus.IGNORED
        await self.inbox_repository.create(inbox_event)  # flush + refresh

        if target_keys:
            await self.audit.record(
                event_type=AuditEventType.INTEGRATION_EVENT_ROUTED,
                actor_type=AuditActorType.SYSTEM,
                actor_id=inbox_event.source_erp_id,
                actor_label=f"erp:{inbox_event.source_erp_id}",
                target_type="integration_inbox_event",
                target_id=inbox_event.id,
                details={"routed_to": sorted(set(target_keys))},
            )
        return sorted(set(target_keys))

    async def _erp_has_capability(self, erp_instance_id: uuid.UUID, required_capability: str | None) -> bool:
        """Return True if no capability is required, or the ERP has declared the required module_key."""
        if required_capability is None:
            return True
        module = await self.erp_module_repository.get_by_instance_and_key(erp_instance_id, required_capability)
        return module is not None and module.enabled

    async def _resolve_broadcast_targets(
        self, source_erp_id: uuid.UUID, subscription: IntegrationSubscription
    ) -> list[str]:
        """Resolve every ACTIVE, capability-matching ERP (other than the source) for a BROADCAST subscription."""
        all_instances = await self.erp_instance_repository.list_all()
        targets: list[str] = []
        for instance in all_instances:
            if instance.id == source_erp_id or instance.status.value != "ACTIVE":
                continue
            if await self._erp_has_capability(instance.id, subscription.required_capability):
                targets.append(instance.key)
        return targets

    async def _record_routing_failure(self, inbox_event: IntegrationInboxEvent, error: str) -> None:
        """Bump the attempt counter; dead-letter once `_MAX_ROUTING_ATTEMPTS` is exceeded."""
        inbox_event.attempt_count += 1
        inbox_event.last_error = error[:2000]
        if inbox_event.attempt_count >= _MAX_ROUTING_ATTEMPTS:
            inbox_event.status = InboxEventStatus.DEAD_LETTER
            await self.inbox_repository.create(inbox_event)  # flush + refresh
            dead_letter = IntegrationDeadLetter(
                inbox_event_id=inbox_event.id,
                event_id=inbox_event.event_id,
                event_type=inbox_event.event_type,
                source_erp_id=inbox_event.source_erp_id,
                attempt_count=inbox_event.attempt_count,
                last_error=inbox_event.last_error,
                failed_at=datetime.now(timezone.utc),
            )
            await self.dead_letter_repository.create(dead_letter)
            await self.audit.record(
                event_type=AuditEventType.INTEGRATION_EVENT_DEAD_LETTERED,
                actor_type=AuditActorType.SYSTEM,
                actor_id=inbox_event.source_erp_id,
                actor_label=f"erp:{inbox_event.source_erp_id}",
                target_type="integration_inbox_event",
                target_id=inbox_event.id,
                details={"attempt_count": inbox_event.attempt_count, "last_error": inbox_event.last_error},
            )
        else:
            inbox_event.status = InboxEventStatus.FAILED
            await self.inbox_repository.create(inbox_event)  # flush + refresh

    async def replay_dead_letter(
        self, dead_letter_id: uuid.UUID, *, actor_id: uuid.UUID, actor_label: str
    ) -> IntegrationInboxEvent:
        """
        Re-attempt routing for a dead-lettered event, preserving its original event_id (Section 19).

        Idempotent: if the underlying inbox event is already ROUTED
        (e.g. a previous replay succeeded), this just returns it as-is
        rather than routing a second time. Requires the caller to
        already hold `platform.system.manage` or an equivalent
        permission -- enforced by the route dependency, not here; this
        method assumes the caller is already authorized and only records
        WHO did the replay for the audit trail.
        """
        dead_letter = await self.dead_letter_repository.get_by_id(dead_letter_id)
        if dead_letter is None:
            raise NotFoundException(f"No dead letter found with id {dead_letter_id}.")

        inbox_event = await self.inbox_repository.get_by_id(dead_letter.inbox_event_id)
        if inbox_event is None:
            raise NotFoundException("The original inbox event for this dead letter no longer exists.")

        if inbox_event.status == InboxEventStatus.ROUTED:
            return inbox_event  # already recovered by a previous replay; idempotent no-op

        inbox_event.attempt_count = 0  # give the replay a fresh attempt budget
        inbox_event.last_error = None
        await self.inbox_repository.create(inbox_event)  # flush + refresh

        try:
            await self._route(inbox_event)
        except Exception as exc:  # noqa: BLE001 - same broad-catch contract as ingest_event's own routing attempt
            await self._record_routing_failure(inbox_event, str(exc))
            raise ForbiddenException(f"Replay failed: {exc}") from exc

        dead_letter.replayed_at = datetime.now(timezone.utc)
        dead_letter.replayed_by = actor_id
        await self.dead_letter_repository.create(dead_letter)  # flush + refresh
        await self.audit.record(
            event_type=AuditEventType.INTEGRATION_EVENT_REPLAYED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="integration_inbox_event",
            target_id=inbox_event.id,
            details={"dead_letter_id": str(dead_letter_id)},
        )
        return inbox_event

    async def list_dead_letters(self, *, limit: int = 100) -> list[IntegrationDeadLetter]:
        """List unreplayed dead letters, most recent first."""
        return await self.dead_letter_repository.list_unreplayed(limit=limit)

    async def list_inbox(
        self,
        *,
        limit: int = 100,
        status: str | None = None,
        event_type: str | None = None,
        correlation_id: uuid.UUID | None = None,
    ) -> list[IntegrationInboxEvent]:
        """List recent inbox events, optionally filtered -- the admin-facing view."""
        return await self.inbox_repository.list_recent(
            limit=limit, status=status, event_type=event_type, correlation_id=correlation_id
        )

    async def get_inbox_event(self, identifier: uuid.UUID) -> IntegrationInboxEvent | None:
        """Fetch an inbox event by its producer event_id or internal row id."""
        event = await self.inbox_repository.get_by_event_id(identifier)
        if event is None:
            event = await self.inbox_repository.get_by_id(identifier)
        return event

    async def poll_inbox_for_consumer(
        self, *, consumer_erp_key: str, since, limit: int = 200
    ) -> list[IntegrationInboxEvent]:
        """
        List every ROUTED event whose `routed_to` includes `consumer_erp_key`, created after `since`.

        This is what `GET /internal/integration/inbox` (service-
        credential-gated, Section 36) calls -- `consumer_erp_key` comes
        from the CALLER's own verified credential, never a query
        parameter, so an ERP can only ever poll for events routed to
        itself (mirroring the exact same "identity from the credential,
        never the request" rule `ingest_event` already enforces for
        `source_erp`).
        """
        candidates = await self.inbox_repository.list_routed_since(since_created_at=since, limit=limit)
        matching = []
        for event in candidates:
            routed_to = json.loads(event.routed_to) if event.routed_to else []
            if consumer_erp_key in routed_to:
                matching.append(event)
        return matching

    async def create_subscription(
        self, payload: IntegrationSubscriptionCreate, *, actor_id: uuid.UUID, actor_label: str
    ) -> IntegrationSubscription:
        """
        Create a routing subscription.

        Validates the source (and target, if SPECIFIC_ERP) ERP actually
        exist before creating the rule -- a subscription pointing at a
        nonexistent ERP is silently useless at routing time (skipped,
        never an error there), so catching it here at creation time
        gives the operator a clearer, immediate signal instead.
        """
        source = await self.erp_instance_repository.get_by_id(payload.source_erp_id)
        if source is None:
            raise NotFoundException(f"No ERP instance found with id {payload.source_erp_id}.")
        if payload.target_erp_id is not None:
            target = await self.erp_instance_repository.get_by_id(payload.target_erp_id)
            if target is None:
                raise NotFoundException(f"No ERP instance found with id {payload.target_erp_id}.")

        existing = await self.subscription_repository.get_existing(
            payload.event_type, payload.source_erp_id, payload.target_erp_id
        )
        if existing is not None:
            raise ConflictException("An identical subscription (event_type, source, target) already exists.")

        subscription = IntegrationSubscription(
            event_type=payload.event_type,
            source_erp_id=payload.source_erp_id,
            target_erp_id=payload.target_erp_id,
            target_kind=payload.target_kind,
            required_capability=payload.required_capability,
        )
        created = await self.subscription_repository.create(subscription)
        await self.audit.record(
            event_type=AuditEventType.INTEGRATION_SUBSCRIPTION_CREATED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="integration_subscription",
            target_id=created.id,
            details={"event_type": created.event_type, "target_kind": created.target_kind.value},
        )
        return created

    async def update_subscription(
        self,
        subscription_id: uuid.UUID,
        payload: IntegrationSubscriptionUpdate,
        *,
        actor_id: uuid.UUID,
        actor_label: str,
    ) -> IntegrationSubscription:
        """Update a subscription's enabled flag or required capability."""
        subscription = await self.subscription_repository.get_by_id(subscription_id)
        if subscription is None:
            raise NotFoundException(f"No subscription found with id {subscription_id}.")
        updates = payload.model_dump(exclude_unset=True)
        for field, value in updates.items():
            setattr(subscription, field, value)
        await self.subscription_repository.create(subscription)  # flush + refresh
        await self.audit.record(
            event_type=AuditEventType.INTEGRATION_SUBSCRIPTION_UPDATED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="integration_subscription",
            target_id=subscription.id,
            details={"fields_updated": sorted(updates.keys())},
        )
        return subscription

    async def list_subscriptions(self) -> list[IntegrationSubscription]:
        """List every configured subscription."""
        return await self.subscription_repository.list_all()

    async def create_entity_mapping(
        self, payload: EntityMappingCreate, *, actor_id: uuid.UUID, actor_label: str
    ) -> IntegrationEntityMapping:
        """Create an explicit cross-ERP identity mapping. Idempotent: re-creating an identical mapping is a no-op."""
        existing = await self.mapping_repository.get_existing(
            payload.source_erp_id,
            payload.source_entity_type,
            payload.source_entity_id,
            payload.target_erp_id,
            payload.target_entity_type,
        )
        if existing is not None:
            # Update metadata if newer version or status provided
            if payload.status:
                existing.status = payload.status
            if payload.source_version is not None:
                existing.source_version = payload.source_version
            if payload.target_version is not None:
                existing.target_version = payload.target_version
            if payload.last_synced_at is not None:
                existing.last_synced_at = payload.last_synced_at
            if payload.correlation_id is not None:
                existing.correlation_id = payload.correlation_id
            return existing

        mapping = IntegrationEntityMapping(
            source_erp_id=payload.source_erp_id,
            source_entity_type=payload.source_entity_type,
            source_entity_id=payload.source_entity_id,
            target_erp_id=payload.target_erp_id,
            target_entity_type=payload.target_entity_type,
            target_entity_id=payload.target_entity_id,
            status=payload.status,
            source_version=payload.source_version,
            target_version=payload.target_version,
            last_synced_at=payload.last_synced_at,
            correlation_id=payload.correlation_id,
        )
        created = await self.mapping_repository.create(mapping)
        await self.audit.record(
            event_type=AuditEventType.INTEGRATION_ENTITY_MAPPING_CREATED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="integration_entity_mapping",
            target_id=created.id,
            details={
                "source_entity_type": created.source_entity_type,
                "target_entity_type": created.target_entity_type,
            },
        )
        return created

    async def list_mappings_for_source_entity(
        self, source_erp_id: uuid.UUID, source_entity_type: str, source_entity_id: uuid.UUID
    ) -> list[IntegrationEntityMapping]:
        """List every known mapping for a given source entity, across all target ERPs."""
        return await self.mapping_repository.list_for_source_entity(
            source_erp_id, source_entity_type, source_entity_id
        )
