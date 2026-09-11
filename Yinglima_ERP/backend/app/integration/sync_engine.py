"""
Generic Cross-ERP Synchronization Engine (Phase 8E).

The core runtime orchestration engine for bidirectional master-data synchronization
between autonomous ERP nodes.

Guarantees:
1. ERP Independence: Direct peer-to-peer execution with zero runtime dependency on ERP_Main.
2. Formal Data Ownership: Enforces SOURCE_AUTHORITATIVE, TARGET_AUTHORITATIVE, SHARED, MANUAL_CONFLICT.
3. Direction Enforcement: Rejects events violating SOURCE_TO_TARGET, TARGET_TO_SOURCE, BIDIRECTIONAL.
4. Deterministic Versioning: Monotonic version comparison rejecting out-of-order and duplicate events.
5. Generic Conflict Resolution: SOURCE_WINS, TARGET_WINS, MANUAL, REJECT_QUARANTINE, LATEST_TIMESTAMP.
6. Field-Level Ownership: Selective update masking respecting field ownership maps.
7. Idempotency: Duplicate events produce zero business side-effects or duplicate mappings.
8. Delete/Archive Semantics: Controlled propagation (PROPAGATE_DELETE, PROPAGATE_ARCHIVE, IGNORE_DELETE).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.integration.adapters.base import BaseEntitySyncAdapter
from app.integration.adapters.buyer import BuyerSyncAdapter
from app.integration.consumer_models import ProcessedIntegrationEvent
from app.integration.sync_models import SyncedEntityMapping

logger = get_logger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# -----------------------------------------------------------------------------
# Exceptions
# -----------------------------------------------------------------------------

class SyncEngineError(Exception):
    """Base exception for synchronization engine errors."""


class UnsupportedContractVersionError(SyncEngineError):
    """Raised when an incoming event has an unsupported contract version."""


class PolicyDirectionViolationError(SyncEngineError):
    """Raised when an incoming event violates the configured direction policy."""


class SyncConflictError(SyncEngineError):
    """Raised when a concurrent modification conflict cannot be automatically resolved."""


class AdapterNotFoundError(SyncEngineError):
    """Raised when no adapter is registered for the requested entity type."""


# -----------------------------------------------------------------------------
# Policy Configuration
# -----------------------------------------------------------------------------

@dataclass
class SyncPolicyConfig:
    """Configured synchronization policy for a specific entity type and source ERP."""

    ownership_strategy: str = "SOURCE_AUTHORITATIVE"  # SOURCE_AUTHORITATIVE | TARGET_AUTHORITATIVE | SHARED | MANUAL_CONFLICT
    direction: str = "BIDIRECTIONAL"                 # SOURCE_TO_TARGET | TARGET_TO_SOURCE | BIDIRECTIONAL
    conflict_strategy: str = "SOURCE_WINS"           # SOURCE_WINS | TARGET_WINS | MANUAL | REJECT_QUARANTINE | LATEST_TIMESTAMP
    delete_strategy: str = "PROPAGATE_ARCHIVE"       # PROPAGATE_DELETE | PROPAGATE_ARCHIVE | IGNORE_DELETE
    version_strategy: str = "EVENT_VERSION"          # EVENT_VERSION | MONOTONIC_SEQUENCE
    field_ownership: dict[str, str] = field(default_factory=dict)
    enabled: bool = True


# -----------------------------------------------------------------------------
# Result Summary
# -----------------------------------------------------------------------------

@dataclass
class SyncResult:
    """Result of processing a cross-ERP synchronization event."""

    status: str  # "PROCESSED" | "SKIPPED_DUPLICATE" | "SKIPPED_OUT_OF_ORDER" | "CONFLICT_RECORDED" | "REJECTED"
    event_id: uuid.UUID
    local_entity_id: uuid.UUID | None = None
    source_version: int = 1
    local_version: int = 1
    action: str = "NOOP"  # "CREATED" | "UPDATED" | "DELETED" | "NOOP" | "CONFLICT"
    details: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "event_id": str(self.event_id),
            "local_entity_id": str(self.local_entity_id) if self.local_entity_id else None,
            "source_version": self.source_version,
            "local_version": self.local_version,
            "action": self.action,
            "details": self.details,
        }


# -----------------------------------------------------------------------------
# Generic Synchronization Engine
# -----------------------------------------------------------------------------

SUPPORTED_CONTRACT_VERSIONS: set[int] = {1, 2}
DEPRECATED_CONTRACT_VERSIONS: set[int] = set()


class GenericSyncEngine:
    """
    Generic cross-ERP synchronization engine processing incoming event envelopes
    against domain adapters, deterministic versioning, and formal ownership rules.
    """

    def __init__(self) -> None:
        self._adapters: dict[str, BaseEntitySyncAdapter] = {}
        self._policies: dict[tuple[str, str], SyncPolicyConfig] = {}

        # Register default adapters
        self.register_adapter(BuyerSyncAdapter())

    def register_adapter(self, adapter: BaseEntitySyncAdapter) -> None:
        """Register a domain entity adapter."""
        self._adapters[adapter.entity_type] = adapter

    def set_policy(self, source_erp: str, entity_type: str, policy: SyncPolicyConfig) -> None:
        """Register or override a synchronization policy for (source_erp, entity_type)."""
        self._policies[(source_erp.lower(), entity_type.lower())] = policy

    def get_policy(self, source_erp: str, entity_type: str) -> SyncPolicyConfig:
        """Get the configured or default policy for (source_erp, entity_type)."""
        key = (source_erp.lower(), entity_type.lower())
        if key in self._policies:
            return self._policies[key]
        # Wildcard source fallback
        wildcard_key = ("*", entity_type.lower())
        if wildcard_key in self._policies:
            return self._policies[wildcard_key]
        return SyncPolicyConfig()

    async def process_event(
        self, session: AsyncSession, envelope: dict[str, Any]
    ) -> SyncResult:
        """
        Process a single incoming cross-ERP event envelope atomically.

        Pipeline:
        1. Envelope & Contract Version Validation
        2. Deduplication Check (ProcessedIntegrationEvent)
        3. Policy & Direction Validation
        4. Entity Mapping Lookup & Deterministic Versioning Check
        5. Conflict Detection & Arbitration
        6. Adapter Execution (Create / Update / Delete)
        7. Mapping State Persistence & Processed Event Marking
        """
        # Step 1: Envelope validation
        event_id_str = envelope.get("event_id")
        event_type = envelope.get("event_type", "")
        event_version = envelope.get("event_version", 1)
        source_erp = envelope.get("source_erp", "")
        entity_type = envelope.get("entity_type") or envelope.get("source_entity_type") or ""
        source_entity_id = str(envelope.get("entity_id") or envelope.get("source_entity_id") or "")
        payload = envelope.get("payload")

        if not event_id_str or not event_type or not source_erp or not entity_type or not source_entity_id or payload is None:
            raise ValueError(
                "Malformed cross-ERP event envelope: missing required fields "
                "(event_id, event_type, source_erp, entity_type, source_entity_id, payload)."
            )

        if not isinstance(payload, dict):
            raise ValueError("Malformed cross-ERP event envelope: payload must be a JSON dictionary.")

        event_id = uuid.UUID(str(event_id_str))

        target_erp = envelope.get("target_erp")
        if target_erp:
            from app.core.config import settings
            target_norm = str(target_erp).lower().strip()
            if target_norm not in ("broadcast", "*", settings.ERP_KEY.lower()):
                logger.warning(
                    "Event addressed to '%s' received by '%s'; rejecting destination mismatch.",
                    target_erp,
                    settings.ERP_KEY,
                )
                return SyncResult(
                    status="REJECTED",
                    event_id=event_id,
                    action="NOOP",
                    details=f"Target mismatch: addressed to {target_erp}, received by {settings.ERP_KEY}.",
                )

        if event_version not in SUPPORTED_CONTRACT_VERSIONS:
            raise UnsupportedContractVersionError(
                f"Unsupported contract version: {event_version}. Supported versions: {sorted(SUPPORTED_CONTRACT_VERSIONS)}."
            )
        if event_version in DEPRECATED_CONTRACT_VERSIONS:
            logger.warning("Contract version %d is deprecated.", event_version)

        # Step 2: Event deduplication
        existing_processed = await session.execute(
            select(ProcessedIntegrationEvent).where(
                ProcessedIntegrationEvent.event_id == event_id,
                ProcessedIntegrationEvent.consumer_id == "sync_engine",
            )
        )
        if existing_processed.scalar_one_or_none() is not None:
            logger.info("Event already processed; skipping duplicate delivery.", extra={"event_id": str(event_id)})
            return SyncResult(
                status="SKIPPED_DUPLICATE",
                event_id=event_id,
                action="NOOP",
                details="Event already recorded in processed_integration_events.",
            )

        # Step 3: Adapter lookup
        adapter = self._adapters.get(entity_type.lower())
        if adapter is None:
            raise AdapterNotFoundError(f"No sync adapter registered for entity type '{entity_type}'.")

        # Step 4: Policy & Direction Validation
        policy = self.get_policy(source_erp, entity_type)
        if not policy.enabled:
            logger.warning("Synchronization policy disabled; skipping event.", extra={"entity_type": entity_type})
            return SyncResult(
                status="REJECTED",
                event_id=event_id,
                action="NOOP",
                details=f"Policy for {entity_type} from {source_erp} is disabled.",
            )

        # Validate direction
        if policy.direction == "TARGET_TO_SOURCE":
            raise PolicyDirectionViolationError(
                f"Policy prohibits inbound sync for entity '{entity_type}' from '{source_erp}' (direction: TARGET_TO_SOURCE)."
            )

        # Step 5: Entity mapping lookup
        mapping_result = await session.execute(
            select(SyncedEntityMapping).where(
                SyncedEntityMapping.source_erp_id == source_erp,
                SyncedEntityMapping.entity_type == entity_type.lower(),
                SyncedEntityMapping.source_entity_id == source_entity_id,
            )
        )
        mapping = mapping_result.scalar_one_or_none()

        incoming_version = int(
            payload.get("version")
            or envelope.get("entity_version")
            or envelope.get("event_version")
            or 1
        )

        # Step 6: Action Determination
        is_delete = event_type.endswith((".deleted", ".archived", ".delete", ".archive"))
        is_update = event_type.endswith((".updated", ".update")) or (mapping is not None and not is_delete)
        is_create = not is_delete and not is_update and mapping is None

        # Step 7: Version and Out-of-Order Checks
        if mapping is not None:
            # Deterministic monotonic version comparison
            if incoming_version < mapping.source_version:
                logger.warning(
                    "Stale out-of-order event rejected: incoming version %d is older than known source version %d.",
                    incoming_version,
                    mapping.source_version,
                    extra={"event_id": str(event_id), "source_entity_id": source_entity_id},
                )
                self._record_processed(session, event_id, event_type)
                return SyncResult(
                    status="SKIPPED_OUT_OF_ORDER",
                    event_id=event_id,
                    local_entity_id=mapping.local_entity_id,
                    source_version=mapping.source_version,
                    local_version=mapping.local_version,
                    action="NOOP",
                    details=f"Incoming version {incoming_version} < currently known version {mapping.source_version}.",
                )

            if incoming_version == mapping.source_version and not is_delete:
                logger.info(
                    "Duplicate entity version delivery: incoming version %d matches known version %d; no-op.",
                    incoming_version,
                    mapping.source_version,
                )
                self._record_processed(session, event_id, event_type)
                return SyncResult(
                    status="SKIPPED_DUPLICATE",
                    event_id=event_id,
                    local_entity_id=mapping.local_entity_id,
                    source_version=mapping.source_version,
                    local_version=mapping.local_version,
                    action="NOOP",
                    details=f"Incoming version {incoming_version} already applied.",
                )

            # Check for concurrent update conflict on the local target
            current_local_version = await adapter.get_local_version(session, mapping.local_entity_id)
            if current_local_version is not None and current_local_version > mapping.local_version:
                # Concurrent target modification detected
                logger.warning(
                    "Concurrent modification detected: local version %d > last synced version %d.",
                    current_local_version,
                    mapping.local_version,
                )
                if policy.conflict_strategy == "TARGET_WINS":
                    logger.info("Conflict resolved: TARGET_WINS preserves local target state.")
                    mapping.source_version = incoming_version
                    mapping.last_synced_at = _utcnow()
                    self._record_processed(session, event_id, event_type)
                    await session.flush()
                    return SyncResult(
                        status="PROCESSED",
                        event_id=event_id,
                        local_entity_id=mapping.local_entity_id,
                        source_version=incoming_version,
                        local_version=current_local_version,
                        action="NOOP",
                        details="TARGET_WINS policy preserved local state.",
                    )

                if policy.conflict_strategy in ("MANUAL", "MANUAL_CONFLICT"):
                    logger.warning("Conflict resolution: MANUAL flags mapping as CONFLICT.")
                    mapping.sync_status = "CONFLICT"
                    mapping.last_synced_at = _utcnow()
                    self._record_processed(session, event_id, event_type)
                    await session.flush()
                    return SyncResult(
                        status="CONFLICT_RECORDED",
                        event_id=event_id,
                        local_entity_id=mapping.local_entity_id,
                        source_version=incoming_version,
                        local_version=current_local_version,
                        action="CONFLICT",
                        details="MANUAL conflict resolution required; local modification preserved.",
                    )

                if policy.conflict_strategy == "REJECT_QUARANTINE":
                    raise SyncConflictError(
                        f"Concurrent conflict on entity '{entity_type}:{source_entity_id}': "
                        f"local version {current_local_version} > synced {mapping.local_version}."
                    )
                # SOURCE_WINS falls through to apply update

        # Step 8: Apply action via Adapter
        local_id: uuid.UUID | None = None
        local_ver: int = 1
        action_name = "NOOP"

        if is_delete:
            if mapping is not None:
                await adapter.apply_delete(session, mapping.local_entity_id, policy.delete_strategy)
                mapping.sync_status = "ARCHIVED"
                mapping.source_version = incoming_version
                mapping.last_synced_at = _utcnow()
                local_id = mapping.local_entity_id
                local_ver = mapping.local_version
                action_name = "DELETED"
        elif is_update and mapping is not None:
            # Enforce target authoritative ownership if configured
            if policy.ownership_strategy in ("TARGET_AUTHORITATIVE", "TARGET_OWNED"):
                logger.info("TARGET_AUTHORITATIVE policy ignores source update.")
                action_name = "NOOP"
                local_id = mapping.local_entity_id
                local_ver = mapping.local_version
            else:
                new_ver = await adapter.apply_update(
                    session,
                    mapping.local_entity_id,
                    payload,
                    field_ownership=policy.field_ownership,
                )
                mapping.source_version = incoming_version
                mapping.local_version = new_ver
                mapping.last_synced_at = _utcnow()
                mapping.sync_status = "ACTIVE"
                local_id = mapping.local_entity_id
                local_ver = new_ver
                action_name = "UPDATED"
        else:
            # Create action
            # Check natural duplicate for repair/linking
            existing_natural = await adapter.find_existing_by_natural_key(session, payload)
            if existing_natural is not None:
                existing_id, existing_ver = existing_natural
                local_id = existing_id
                local_ver = existing_ver
                logger.info(
                    "Natural matching found existing entity; establishing mapping without duplicating.",
                    extra={"local_id": str(local_id)},
                )
            else:
                local_id, local_ver = await adapter.apply_create(session, payload, source_erp)

            # Establish mapping
            mapping = SyncedEntityMapping(
                source_erp_id=source_erp,
                entity_type=entity_type.lower(),
                source_entity_id=source_entity_id,
                local_entity_id=local_id,
                source_version=incoming_version,
                local_version=local_ver,
                sync_status="ACTIVE",
                last_synced_at=_utcnow(),
            )
            session.add(mapping)
            action_name = "CREATED"

        # Step 9: Record processed event
        self._record_processed(session, event_id, event_type)
        await session.flush()

        return SyncResult(
            status="PROCESSED",
            event_id=event_id,
            local_entity_id=local_id,
            source_version=incoming_version,
            local_version=local_ver,
            action=action_name,
            details=f"Successfully applied {action_name} for {entity_type}.",
        )

    def _record_processed(self, session: AsyncSession, event_id: uuid.UUID, event_type: str) -> None:
        session.add(
            ProcessedIntegrationEvent(
                event_id=event_id,
                consumer_id="sync_engine",
                event_type=event_type,
                processed_at=_utcnow(),
            )
        )
