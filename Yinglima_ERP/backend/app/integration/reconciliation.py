"""
Reconciliation Service (Phase 7 / Phase 8E).

Computes local reconciliation reports for cross-ERP entity synchronization.
Detects divergence, drift, conflicts, and missing mappings across autonomous ERP nodes
without requiring direct cross-database access or synchronous cross-ERP queries.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integration.consumer_models import ProcessedIntegrationEvent, SyncedBuyerSource
from app.integration.sync_models import SyncedEntityMapping

_CONSUMER_ID = "default"
_EVENT_TYPE = "buyer.created"


@dataclass
class BuyerSyncReconciliationReport:
    """The result of one reconciliation pass for the buyer.created pilot (backward-compatible)."""

    processed_count: int
    synced_count: int
    unaccounted_count: int
    status: str  # "MATCHED" | "DIVERGENT"

    def to_dict(self) -> dict:
        """Return a plain dict suitable for an API response."""
        return {
            "event_type": _EVENT_TYPE,
            "processed_count": self.processed_count,
            "synced_count": self.synced_count,
            "unaccounted_count": self.unaccounted_count,
            "status": self.status,
        }


@dataclass
class GenericReconciliationReport:
    """The result of a generic entity reconciliation pass (Phase 8E)."""

    entity_type: str
    processed_count: int
    synced_count: int
    active_count: int
    conflict_count: int
    archived_count: int
    unaccounted_count: int
    status: str  # "MATCHED" | "DIVERGENT"
    details: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "entity_type": self.entity_type,
            "processed_count": self.processed_count,
            "synced_count": self.synced_count,
            "active_count": self.active_count,
            "conflict_count": self.conflict_count,
            "archived_count": self.archived_count,
            "unaccounted_count": self.unaccounted_count,
            "status": self.status,
            "details": self.details,
        }


class ReconciliationService:
    """Computes local reconciliation reports for cross-ERP synchronization."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped AsyncSession."""
        self.db = db

    async def reconcile_entity(
        self, entity_type: str, source_erp_id: str | None = None
    ) -> GenericReconciliationReport:
        """
        Reconcile synchronization state for a domain entity type.

        Detects:
        - Processed events vs established entity mappings
        - Conflict mappings requiring manual operator resolution
        - Stale or unaccounted events
        """
        norm_type = entity_type.strip().lower()

        # 1. Processed events for this entity type
        ev_query = select(func.count()).select_from(ProcessedIntegrationEvent).where(
            ProcessedIntegrationEvent.event_type.like(f"{norm_type}.%")
        )
        processed_count = (await self.db.execute(ev_query)).scalar_one()

        # 2. Total SyncedEntityMapping
        map_query = select(func.count()).select_from(SyncedEntityMapping).where(
            SyncedEntityMapping.entity_type == norm_type
        )
        if source_erp_id:
            map_query = map_query.where(SyncedEntityMapping.source_erp_id == source_erp_id)
        synced_count = (await self.db.execute(map_query)).scalar_one()

        # 3. Active mappings
        active_query = select(func.count()).select_from(SyncedEntityMapping).where(
            SyncedEntityMapping.entity_type == norm_type,
            SyncedEntityMapping.sync_status == "ACTIVE",
        )
        if source_erp_id:
            active_query = active_query.where(SyncedEntityMapping.source_erp_id == source_erp_id)
        active_count = (await self.db.execute(active_query)).scalar_one()

        # 4. Conflict mappings
        conflict_query = select(func.count()).select_from(SyncedEntityMapping).where(
            SyncedEntityMapping.entity_type == norm_type,
            SyncedEntityMapping.sync_status == "CONFLICT",
        )
        if source_erp_id:
            conflict_query = conflict_query.where(SyncedEntityMapping.source_erp_id == source_erp_id)
        conflict_count = (await self.db.execute(conflict_query)).scalar_one()

        # 5. Archived mappings
        archived_query = select(func.count()).select_from(SyncedEntityMapping).where(
            SyncedEntityMapping.entity_type == norm_type,
            SyncedEntityMapping.sync_status == "ARCHIVED",
        )
        if source_erp_id:
            archived_query = archived_query.where(SyncedEntityMapping.source_erp_id == source_erp_id)
        archived_count = (await self.db.execute(archived_query)).scalar_one()

        unaccounted = max(processed_count - synced_count, 0)
        details: list[str] = []

        if unaccounted > 0:
            details.append(f"{unaccounted} processed events have not established a mapped entity.")
        if conflict_count > 0:
            details.append(f"{conflict_count} mapped entities are in CONFLICT status.")

        status = "MATCHED" if (unaccounted == 0 and conflict_count == 0) else "DIVERGENT"

        return GenericReconciliationReport(
            entity_type=norm_type,
            processed_count=processed_count,
            synced_count=synced_count,
            active_count=active_count,
            conflict_count=conflict_count,
            archived_count=archived_count,
            unaccounted_count=unaccounted,
            status=status,
            details=details,
        )

    async def reconcile_buyer_sync(self) -> BuyerSyncReconciliationReport:
        """
        Compare buyer.created events processed vs. events that resulted in a real synced Buyer.
        Preserves backward compatibility with Phase 7 tests.
        """
        processed_result = await self.db.execute(
            select(func.count())
            .select_from(ProcessedIntegrationEvent)
            .where(
                ProcessedIntegrationEvent.event_type == _EVENT_TYPE,
                ProcessedIntegrationEvent.consumer_id == _CONSUMER_ID,
            )
        )
        processed_count = processed_result.scalar_one()

        synced_result = await self.db.execute(select(func.count()).select_from(SyncedBuyerSource))
        synced_count = synced_result.scalar_one()

        unaccounted = processed_count - synced_count
        status = "MATCHED" if unaccounted <= 0 else "DIVERGENT"

        return BuyerSyncReconciliationReport(
            processed_count=processed_count,
            synced_count=synced_count,
            unaccounted_count=max(unaccounted, 0),
            status=status,
        )
