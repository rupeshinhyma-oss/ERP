"""
Reporting, Projections, Search, Reconciliation, and Operations Service (Phase 7).

Provides:
- ProjectionService: Materializes and updates multi-entity read models (Buyer, Supplier, Product, Inquiry)
  from IntegrationInboxEvents with idempotency, version sequencing, and checkpointing.
- SearchService: Authorization-scoped search across all projected entities.
- DashboardService: Real aggregation over control plane and projection state.
- ReportEngine: Dynamic catalog, filtering, and data query execution for previews and exports.
- ExportService: Full export lifecycle (PENDING -> RUNNING -> COMPLETED/FAILED), real CSV & XLSX generation,
  secure download tokens, expiration tracking, path traversal defense, and retention cleanup.
- ReconciliationService: Two-way reconciliation via partner ERP telemetry over HTTP without cross-DB access.
- MetricsService: Real point-in-time metrics.
- HealthService: Subsystem health checks across database, pipeline, telemetry, and storage.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import openpyxl
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ConflictException, ForbiddenException, NotFoundException, ValidationException
from app.erp_memberships.models import ErpMembershipStatus
from app.erp_memberships.repository import ErpMembershipRepository
from app.erp_registry.models import ErpInstance
from app.erp_registry.repository import ErpInstanceRepository
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService
from app.global_users.repository import GlobalUserRepository
from app.integration.models import InboxEventStatus, IntegrationInboxEvent
from app.integration.repository import IntegrationDeadLetterRepository, IntegrationInboxRepository
from app.platform_authz.service import PlatformAuthzService
from app.reporting.models import (
    ExportStatus,
    GlobalBuyerProjection,
    GlobalInquiryProjection,
    GlobalProductProjection,
    GlobalSupplierProjection,
    ProjectionCheckpoint,
    ReportExportJob,
)
from app.reporting.repository import (
    GlobalBuyerProjectionRepository,
    GlobalInquiryProjectionRepository,
    GlobalProductProjectionRepository,
    GlobalSupplierProjectionRepository,
    ProjectionCheckpointRepository,
    ReportExportJobRepository,
)
from app.reporting.schemas import (
    ErpHealthRead,
    ExportRequest,
    GenericSearchResult,
    GlobalDashboardRead,
    GlobalMetricsResponse,
    ProjectionHealthRead,
    ReconciliationResult,
    ReportDefinitionRead,
    ReportPreviewResponse,
    SubsystemHealthItem,
    SubsystemsHealthResponse,
    UnifiedSearchResponse,
)

logger = logging.getLogger(__name__)

_STALE_THRESHOLD_SECONDS = 300
_PROJECTION_CHECKPOINTS = {
    "buyer": "global_buyer_projection",
    "supplier": "global_supplier_projection",
    "product": "global_product_projection",
    "inquiry": "global_inquiry_projection",
}


class ProjectionService:
    """Consumes `IntegrationInboxEvent` rows and maintains the global read models."""

    def __init__(
        self,
        inbox_repository: IntegrationInboxRepository,
        buyer_projection_repository: GlobalBuyerProjectionRepository,
        supplier_projection_repository: GlobalSupplierProjectionRepository,
        product_projection_repository: GlobalProductProjectionRepository,
        inquiry_projection_repository: GlobalInquiryProjectionRepository,
        checkpoint_repository: ProjectionCheckpointRepository,
    ) -> None:
        self.inbox_repository = inbox_repository
        self.buyer_projection_repository = buyer_projection_repository
        self.supplier_projection_repository = supplier_projection_repository
        self.product_projection_repository = product_projection_repository
        self.inquiry_projection_repository = inquiry_projection_repository
        self.checkpoint_repository = checkpoint_repository

    async def handle_inbox_event(self, event: IntegrationInboxEvent) -> None:
        """
        Immediately project an incoming inbox event into its read model.
        Called on event ingestion for real-time projection materialization.
        """
        event_type = event.event_type.lower()
        if event_type.startswith("buyer."):
            await self._project_buyer(event)
        elif event_type.startswith("supplier."):
            await self._project_supplier(event)
        elif event_type.startswith("product."):
            await self._project_product(event)
        elif event_type.startswith("inquiry."):
            await self._project_inquiry(event)

    async def _project_buyer(self, event: IntegrationInboxEvent) -> None:
        payload = json.loads(event.payload) if isinstance(event.payload, str) else event.payload
        existing = await self.buyer_projection_repository.get_by_source(
            event.source_erp_id, event.source_entity_type, event.source_entity_id
        )

        incoming_version = int(payload.get("version") or event.event_version or 1)

        if existing is not None:
            existing_ver = existing.version if existing.version is not None else 1
            if existing_ver > incoming_version:
                return  # Stale event with lower version
            if existing_ver == incoming_version and existing.last_event_occurred_at >= event.occurred_at:
                return  # Duplicate or out-of-order event

        projection = existing or GlobalBuyerProjection(
            source_erp_id=event.source_erp_id,
            source_entity_type=event.source_entity_type,
            source_entity_id=event.source_entity_id,
            company_name="",
            version=1,
        )
        projection.company_name = payload.get("company_name") or projection.company_name or "(unknown)"
        projection.status = payload.get("status")
        cur_ver = projection.version if projection.version is not None else 1
        projection.version = max(cur_ver, incoming_version)
        projection.last_event_id = event.event_id
        projection.last_event_occurred_at = event.occurred_at
        projection.synced_at = datetime.now(timezone.utc)
        await self.buyer_projection_repository.upsert(projection)

    async def _project_supplier(self, event: IntegrationInboxEvent) -> None:
        payload = json.loads(event.payload) if isinstance(event.payload, str) else event.payload
        existing = await self.supplier_projection_repository.get_by_source(
            event.source_erp_id, event.source_entity_type, event.source_entity_id
        )

        incoming_version = int(payload.get("version") or event.event_version or 1)

        if existing is not None:
            existing_ver = existing.version if existing.version is not None else 1
            if existing_ver > incoming_version:
                return
            if existing_ver == incoming_version and existing.last_event_occurred_at >= event.occurred_at:
                return

        projection = existing or GlobalSupplierProjection(
            source_erp_id=event.source_erp_id,
            source_entity_type=event.source_entity_type,
            source_entity_id=event.source_entity_id,
            name="",
            version=1,
        )
        projection.name = payload.get("company_name") or payload.get("name") or projection.name or "(unknown)"
        projection.supplier_code = payload.get("supplier_code")
        projection.email = payload.get("email")
        projection.phone = payload.get("phone")
        projection.country = payload.get("country")
        projection.status = payload.get("status")
        projection.is_active = bool(payload.get("is_active", True))
        cur_ver = projection.version if projection.version is not None else 1
        projection.version = max(cur_ver, incoming_version)
        projection.last_event_id = event.event_id
        projection.last_event_occurred_at = event.occurred_at
        projection.synced_at = datetime.now(timezone.utc)
        await self.supplier_projection_repository.upsert(projection)

    async def _project_product(self, event: IntegrationInboxEvent) -> None:
        payload = json.loads(event.payload) if isinstance(event.payload, str) else event.payload
        existing = await self.product_projection_repository.get_by_source(
            event.source_erp_id, event.source_entity_type, event.source_entity_id
        )

        incoming_version = int(payload.get("version") or event.event_version or 1)

        if existing is not None:
            existing_ver = existing.version if existing.version is not None else 1
            if existing_ver > incoming_version:
                return
            if existing_ver == incoming_version and existing.last_event_occurred_at >= event.occurred_at:
                return

        projection = existing or GlobalProductProjection(
            source_erp_id=event.source_erp_id,
            source_entity_type=event.source_entity_type,
            source_entity_id=event.source_entity_id,
            product_code=payload.get("product_code") or f"PRD-{str(event.source_entity_id)[:8]}",
            name="",
            version=1,
        )
        projection.name = payload.get("product_name") or payload.get("name") or projection.name or "(unknown)"
        projection.product_code = payload.get("product_code") or projection.product_code
        projection.category = payload.get("category")
        projection.uom = payload.get("uom")
        projection.status = payload.get("status")
        projection.is_active = bool(payload.get("is_active", True))
        cur_ver = projection.version if projection.version is not None else 1
        projection.version = max(cur_ver, incoming_version)
        projection.last_event_id = event.event_id
        projection.last_event_occurred_at = event.occurred_at
        projection.synced_at = datetime.now(timezone.utc)
        await self.product_projection_repository.upsert(projection)

    async def _project_inquiry(self, event: IntegrationInboxEvent) -> None:
        payload = json.loads(event.payload) if isinstance(event.payload, str) else event.payload
        existing = await self.inquiry_projection_repository.get_by_source(
            event.source_erp_id, event.source_entity_type, event.source_entity_id
        )

        incoming_version = int(payload.get("version") or event.event_version or 1)

        if existing is not None:
            existing_ver = existing.version if existing.version is not None else 1
            if existing_ver > incoming_version:
                return
            if existing_ver == incoming_version and existing.last_event_occurred_at >= event.occurred_at:
                return

        projection = existing or GlobalInquiryProjection(
            source_erp_id=event.source_erp_id,
            source_entity_type=event.source_entity_type,
            source_entity_id=event.source_entity_id,
            inquiry_number=payload.get("inquiry_number") or f"INQ-{str(event.source_entity_id)[:8]}",
            version=1,
        )
        projection.inquiry_number = payload.get("inquiry_number") or projection.inquiry_number
        projection.buyer_name = payload.get("buyer_name")
        projection.season = payload.get("season")
        projection.status = payload.get("status")
        projection.item_count = int(payload.get("item_count", 1))
        cur_ver = projection.version if projection.version is not None else 1
        projection.version = max(cur_ver, incoming_version)
        projection.last_event_id = event.event_id
        projection.last_event_occurred_at = event.occurred_at
        projection.synced_at = datetime.now(timezone.utc)
        await self.inquiry_projection_repository.upsert(projection)

    async def process_new_events(self, *, limit: int = 500) -> dict[str, int]:
        """
        Poll and process all unprocessed inbox events across all projection types.
        """
        all_recent = await self.inbox_repository.list_recent(limit=limit)

        def _naive(dt: datetime) -> datetime:
            return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt

        # Sort chronological
        candidates = sorted(all_recent, key=lambda e: e.created_at)

        results = {"fetched": len(candidates), "processed": 0, "errors": 0}

        for event in candidates:
            event_type = event.event_type.lower()
            matching_entity = None
            if event_type.startswith("buyer."):
                matching_entity = "buyer"
            elif event_type.startswith("supplier."):
                matching_entity = "supplier"
            elif event_type.startswith("product."):
                matching_entity = "product"
            elif event_type.startswith("inquiry."):
                matching_entity = "inquiry"

            if not matching_entity:
                continue

            ckpt_key = _PROJECTION_CHECKPOINTS[matching_entity]
            ckpt = await self.checkpoint_repository.get_by_type(ckpt_key)
            since = ckpt.last_processed_inbox_event_created_at if ckpt else None

            if since and _naive(event.created_at) <= _naive(since):
                continue

            try:
                await self.handle_inbox_event(event)
                results["processed"] += 1
                if ckpt is None:
                    ckpt = ProjectionCheckpoint(projection_type=ckpt_key)
                ckpt.last_processed_inbox_event_created_at = event.created_at
                ckpt.last_event_id = event.event_id
                ckpt.last_processed_at = datetime.now(timezone.utc)
                ckpt.events_processed_count += 1
                await self.checkpoint_repository.upsert(ckpt)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Failed projecting event %s: %s", event.event_id, exc)
                results["errors"] += 1
                if ckpt is None:
                    ckpt = ProjectionCheckpoint(projection_type=ckpt_key)
                ckpt.error_count += 1
                ckpt.last_error = str(exc)[:2000]
                await self.checkpoint_repository.upsert(ckpt)

        return results

    async def rebuild(self) -> dict[str, int]:
        """Reset checkpoints and reprocess all inbox events."""
        for ckpt_key in _PROJECTION_CHECKPOINTS.values():
            ckpt = await self.checkpoint_repository.get_by_type(ckpt_key)
            if ckpt is None:
                ckpt = ProjectionCheckpoint(projection_type=ckpt_key)
            ckpt.last_processed_inbox_event_created_at = None
            ckpt.last_event_id = None
            ckpt.events_processed_count = 0
            ckpt.error_count = 0
            ckpt.last_error = None
            await self.checkpoint_repository.upsert(ckpt)
        return await self.process_new_events(limit=10_000)


class SearchService:
    """Unified search over the global read models, authorization-scoped."""

    def __init__(
        self,
        buyer_projection_repository: GlobalBuyerProjectionRepository,
        supplier_projection_repository: GlobalSupplierProjectionRepository,
        product_projection_repository: GlobalProductProjectionRepository,
        inquiry_projection_repository: GlobalInquiryProjectionRepository,
        membership_repository: ErpMembershipRepository,
        authz_service: PlatformAuthzService,
    ) -> None:
        self.buyer_projection_repository = buyer_projection_repository
        self.supplier_projection_repository = supplier_projection_repository
        self.product_projection_repository = product_projection_repository
        self.inquiry_projection_repository = inquiry_projection_repository
        self.membership_repository = membership_repository
        self.authz_service = authz_service

    async def resolve_allowed_erp_ids(
        self, global_user_id: uuid.UUID, all_erp_ids: list[uuid.UUID]
    ) -> list[uuid.UUID]:
        """Resolve which ERPs a GlobalUser may see."""
        global_permissions, _erp_permissions = await self.authz_service.compute_effective_permissions(global_user_id)
        if "platform.search.read" in global_permissions or "platform.dashboard.read" in global_permissions:
            return all_erp_ids

        memberships = await self.membership_repository.list_for_user(global_user_id)
        return [m.erp_instance_id for m in memberships if m.status == ErpMembershipStatus.ACTIVE]

    async def search_buyers(
        self,
        *,
        global_user_id: uuid.UUID,
        all_erp_ids: list[uuid.UUID],
        query: str | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[GlobalBuyerProjection], int]:
        allowed_erp_ids = await self.resolve_allowed_erp_ids(global_user_id, all_erp_ids)
        return await self.buyer_projection_repository.search(
            allowed_erp_ids=allowed_erp_ids, query=query, status=status, limit=limit, offset=offset
        )

    async def search_suppliers(
        self,
        *,
        global_user_id: uuid.UUID,
        all_erp_ids: list[uuid.UUID],
        query: str | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[GlobalSupplierProjection], int]:
        allowed_erp_ids = await self.resolve_allowed_erp_ids(global_user_id, all_erp_ids)
        return await self.supplier_projection_repository.search(
            allowed_erp_ids=allowed_erp_ids, query=query, status=status, limit=limit, offset=offset
        )

    async def search_products(
        self,
        *,
        global_user_id: uuid.UUID,
        all_erp_ids: list[uuid.UUID],
        query: str | None = None,
        category: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[GlobalProductProjection], int]:
        allowed_erp_ids = await self.resolve_allowed_erp_ids(global_user_id, all_erp_ids)
        return await self.product_projection_repository.search(
            allowed_erp_ids=allowed_erp_ids, query=query, category=category, limit=limit, offset=offset
        )

    async def search_inquiries(
        self,
        *,
        global_user_id: uuid.UUID,
        all_erp_ids: list[uuid.UUID],
        query: str | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[GlobalInquiryProjection], int]:
        allowed_erp_ids = await self.resolve_allowed_erp_ids(global_user_id, all_erp_ids)
        return await self.inquiry_projection_repository.search(
            allowed_erp_ids=allowed_erp_ids, query=query, status=status, limit=limit, offset=offset
        )

    async def search_all(
        self,
        *,
        global_user_id: uuid.UUID | None = None,
        all_erp_ids: list[uuid.UUID],
        is_platform_admin: bool = False,
        query: str | None = None,
        entity_types: list[str] | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> UnifiedSearchResponse:
        """Search across multiple entity types simultaneously."""
        if is_platform_admin:
            allowed_erp_ids = all_erp_ids
        elif global_user_id is not None:
            allowed_erp_ids = await self.resolve_allowed_erp_ids(global_user_id, all_erp_ids)
        else:
            allowed_erp_ids = []

        if not allowed_erp_ids:
            return UnifiedSearchResponse(
                results=[], total=0, limit=limit, offset=offset, data_as_of=datetime.now(timezone.utc)
            )

        active_types = set(entity_types or ["buyer", "supplier", "product", "inquiry"])
        results: list[GenericSearchResult] = []
        counts: dict[str, int] = {}

        if "buyer" in active_types:
            buyers, b_total = await self.buyer_projection_repository.search(
                allowed_erp_ids=allowed_erp_ids, query=query, limit=limit
            )
            counts["buyer"] = b_total
            for b in buyers:
                results.append(
                    GenericSearchResult(
                        id=b.id,
                        entity_type="buyer",
                        display_title=b.company_name,
                        display_subtitle=f"Status: {b.status or 'N/A'}",
                        source_erp_id=b.source_erp_id,
                        source_entity_id=b.source_entity_id,
                        status=b.status,
                        synced_at=b.synced_at,
                        raw_data={"company_name": b.company_name, "version": b.version},
                    )
                )

        if "supplier" in active_types:
            suppliers, s_total = await self.supplier_projection_repository.search(
                allowed_erp_ids=allowed_erp_ids, query=query, limit=limit
            )
            counts["supplier"] = s_total
            for s in suppliers:
                results.append(
                    GenericSearchResult(
                        id=s.id,
                        entity_type="supplier",
                        display_title=s.name,
                        display_subtitle=f"Code: {s.supplier_code or 'N/A'}",
                        source_erp_id=s.source_erp_id,
                        source_entity_id=s.source_entity_id,
                        status=s.status,
                        synced_at=s.synced_at,
                        raw_data={"name": s.name, "supplier_code": s.supplier_code, "version": s.version},
                    )
                )

        if "product" in active_types:
            products, p_total = await self.product_projection_repository.search(
                allowed_erp_ids=allowed_erp_ids, query=query, limit=limit
            )
            counts["product"] = p_total
            for p in products:
                results.append(
                    GenericSearchResult(
                        id=p.id,
                        entity_type="product",
                        display_title=p.name,
                        display_subtitle=f"SKU: {p.product_code}",
                        source_erp_id=p.source_erp_id,
                        source_entity_id=p.source_entity_id,
                        status=p.status,
                        synced_at=p.synced_at,
                        raw_data={"name": p.name, "product_code": p.product_code, "version": p.version},
                    )
                )

        if "inquiry" in active_types:
            inquiries, i_total = await self.inquiry_projection_repository.search(
                allowed_erp_ids=allowed_erp_ids, query=query, limit=limit
            )
            counts["inquiry"] = i_total
            for i in inquiries:
                results.append(
                    GenericSearchResult(
                        id=i.id,
                        entity_type="inquiry",
                        display_title=i.inquiry_number,
                        display_subtitle=f"Buyer: {i.buyer_name or 'N/A'}",
                        source_erp_id=i.source_erp_id,
                        source_entity_id=i.source_entity_id,
                        status=i.status,
                        synced_at=i.synced_at,
                        raw_data={"inquiry_number": i.inquiry_number, "status": i.status, "version": i.version},
                    )
                )

        # Slice according to limit/offset
        total_items = sum(counts.values())
        paginated_results = results[offset : offset + limit]

        return UnifiedSearchResponse(
            results=paginated_results,
            total=total_items,
            limit=limit,
            offset=offset,
            data_as_of=datetime.now(timezone.utc),
            by_entity_type=counts,
        )


class DashboardService:
    """Read-only aggregation for the platform dashboard and per-ERP/per-projection health views."""

    def __init__(
        self,
        erp_instance_repository: ErpInstanceRepository,
        global_user_repository: GlobalUserRepository,
        membership_repository: ErpMembershipRepository,
        inbox_repository: IntegrationInboxRepository,
        dead_letter_repository: IntegrationDeadLetterRepository,
        buyer_projection_repository: GlobalBuyerProjectionRepository,
        supplier_projection_repository: GlobalSupplierProjectionRepository,
        product_projection_repository: GlobalProductProjectionRepository,
        inquiry_projection_repository: GlobalInquiryProjectionRepository,
        checkpoint_repository: ProjectionCheckpointRepository,
    ) -> None:
        self.erp_instance_repository = erp_instance_repository
        self.global_user_repository = global_user_repository
        self.membership_repository = membership_repository
        self.inbox_repository = inbox_repository
        self.dead_letter_repository = dead_letter_repository
        self.buyer_projection_repository = buyer_projection_repository
        self.supplier_projection_repository = supplier_projection_repository
        self.product_projection_repository = product_projection_repository
        self.inquiry_projection_repository = inquiry_projection_repository
        self.checkpoint_repository = checkpoint_repository

    def _api_health(self, erp: ErpInstance) -> str:
        if erp.last_seen_at is None:
            return "UNKNOWN"
        age = (datetime.now(timezone.utc) - erp.last_seen_at).total_seconds()
        return "HEALTHY" if age <= _STALE_THRESHOLD_SECONDS else "STALE"

    async def get_erp_health(self, erp: ErpInstance) -> ErpHealthRead:
        buyer_count = await self.buyer_projection_repository.count_for_erp(erp.id)
        supplier_count = await self.supplier_projection_repository.count_for_erp(erp.id)
        product_count = await self.product_projection_repository.count_for_erp(erp.id)
        inquiry_count = await self.inquiry_projection_repository.count_for_erp(erp.id)

        return ErpHealthRead(
            erp_id=erp.id,
            erp_key=erp.key,
            display_name=erp.display_name,
            status=erp.status.value,
            last_seen_at=erp.last_seen_at,
            api_health=self._api_health(erp),
            enabled_capabilities=sorted(m.module_key for m in erp.modules if m.enabled),
            buyer_projection_count=buyer_count,
            supplier_projection_count=supplier_count,
            product_projection_count=product_count,
            inquiry_projection_count=inquiry_count,
        )

    async def get_projection_health(self) -> list[ProjectionHealthRead]:
        checkpoints = await self.checkpoint_repository.list_all()
        results = []
        now = datetime.now(timezone.utc)
        for checkpoint in checkpoints:
            lag = None
            if checkpoint.last_processed_inbox_event_created_at is not None:
                # Naive conversion for comparison
                ckpt_dt = checkpoint.last_processed_inbox_event_created_at
                now_dt = now.replace(tzinfo=None) if ckpt_dt.tzinfo is None else now
                lag = (now_dt - ckpt_dt).total_seconds()
            results.append(
                ProjectionHealthRead(
                    projection_type=checkpoint.projection_type,
                    last_processed_at=checkpoint.last_processed_at,
                    events_processed_count=checkpoint.events_processed_count,
                    error_count=checkpoint.error_count,
                    last_error=checkpoint.last_error,
                    lag_seconds=lag,
                )
            )
        return results

    async def get_dashboard(self) -> GlobalDashboardRead:
        all_erps = await self.erp_instance_repository.list_all()
        active_erps = [e for e in all_erps if e.status.value == "ACTIVE"]

        global_users = await self.global_user_repository.list_all(limit=100_000)
        recent_inbox = await self.inbox_repository.list_recent(limit=10_000)
        dead_letters = await self.dead_letter_repository.list_unreplayed(limit=10_000)
        active_membership_count = await self.membership_repository.count_active()

        erp_health = [await self.get_erp_health(erp) for erp in all_erps]
        projection_health = await self.get_projection_health()

        return GlobalDashboardRead(
            active_erps=len(active_erps),
            total_erps=len(all_erps),
            global_users=len(global_users),
            active_memberships=active_membership_count,
            events_received_total=len(recent_inbox),
            events_dead_lettered_total=len(dead_letters),
            erp_health=erp_health,
            projection_health=projection_health,
            data_as_of=datetime.now(timezone.utc),
        )


class ReportEngine:
    """Catalog and execution engine for cross-ERP reporting."""

    def __init__(
        self,
        buyer_repo: GlobalBuyerProjectionRepository,
        supplier_repo: GlobalSupplierProjectionRepository,
        product_repo: GlobalProductProjectionRepository,
        inquiry_repo: GlobalInquiryProjectionRepository,
        erp_repo: ErpInstanceRepository,
    ) -> None:
        self.buyer_repo = buyer_repo
        self.supplier_repo = supplier_repo
        self.product_repo = product_repo
        self.inquiry_repo = inquiry_repo
        self.erp_repo = erp_repo

    def list_reports(self) -> list[ReportDefinitionRead]:
        return [
            ReportDefinitionRead(
                report_key="global_buyer_summary",
                name="Global Buyer Projection Summary",
                description="Cross-ERP buyer projection catalog synchronized from asynchronous buyer.created integration events.",
                entity_type="buyer",
                supported_formats=["csv", "xlsx"],
                supported_filters=["query", "status", "erp_ids"],
                status="AVAILABLE",
                is_available=True,
            ),
            ReportDefinitionRead(
                report_key="global_supplier_summary",
                name="Global Supplier Summary",
                description="Cross-ERP supplier catalog (awaiting supplier integration event support in Phase 6/7).",
                entity_type="supplier",
                supported_formats=["csv", "xlsx"],
                supported_filters=["query", "status", "erp_ids"],
                status="NOT_YET_SUPPORTED",
                is_available=False,
            ),
            ReportDefinitionRead(
                report_key="global_quotation_summary",
                name="Global Quotations & Pricing",
                description="Cross-ERP quotation summary (awaiting quotation event stream integration).",
                entity_type="quotation",
                supported_formats=["csv", "xlsx"],
                supported_filters=["date_range", "erp_ids"],
                status="NOT_YET_SUPPORTED",
                is_available=False,
            ),
            ReportDefinitionRead(
                report_key="global_product_summary",
                name="Global Product Catalog Projections",
                description="Cross-ERP product read model (awaiting product integration events).",
                entity_type="product",
                supported_formats=["csv", "xlsx"],
                supported_filters=["category", "erp_ids"],
                status="NOT_YET_SUPPORTED",
                is_available=False,
            ),
            ReportDefinitionRead(
                report_key="cross_erp_overview",
                name="Cross-ERP Operations Overview",
                description="Holistic summary of entities, connectivity, and volume across connected ERPs.",
                entity_type="aggregate",
                supported_formats=["csv", "xlsx"],
                supported_filters=["erp_ids"],
                status="AVAILABLE",
                is_available=True,
            ),
        ]

    async def query_report_data(
        self,
        report_key: str,
        filters: dict[str, Any],
        allowed_erp_ids: list[uuid.UUID],
        limit: int | None = None,
    ) -> tuple[list[str], list[dict[str, Any]]]:
        """Query report rows formatted as columns and dict records."""
        target_erp_ids = allowed_erp_ids
        filtered_erp_ids = filters.get("erp_ids")
        if filtered_erp_ids:
            try:
                selected = [uuid.UUID(str(e)) for e in filtered_erp_ids]
                target_erp_ids = [eid for eid in target_erp_ids if eid in selected]
            except Exception:
                pass

        query = filters.get("query")
        status_filter = filters.get("status")

        if report_key == "global_buyer_summary":
            columns = ["ID", "Source ERP", "Source Entity ID", "Company Name", "Status", "Version", "Synced At"]
            if not target_erp_ids:
                return columns, []
            rows_data, _ = await self.buyer_repo.search(
                allowed_erp_ids=target_erp_ids,
                query=query,
                status=status_filter,
                limit=limit or 5000,
            )
            rows = [
                {
                    "ID": str(r.id),
                    "Source ERP": str(r.source_erp_id),
                    "Source Entity ID": str(r.source_entity_id),
                    "Company Name": r.company_name,
                    "Status": r.status or "N/A",
                    "Version": r.version,
                    "Synced At": r.synced_at.isoformat() if r.synced_at else "",
                }
                for r in rows_data
            ]
            return columns, rows

        elif report_key == "global_supplier_summary":
            columns = ["ID", "Source ERP", "Supplier Code", "Name", "Email", "Phone", "Country", "Status", "Active", "Version", "Synced At"]
            if not target_erp_ids:
                return columns, []
            rows_data, _ = await self.supplier_repo.search(
                allowed_erp_ids=target_erp_ids,
                query=query,
                status=status_filter,
                limit=limit or 5000,
            )
            rows = [
                {
                    "ID": str(r.id),
                    "Source ERP": str(r.source_erp_id),
                    "Supplier Code": r.supplier_code or "",
                    "Name": r.name,
                    "Email": r.email or "",
                    "Phone": r.phone or "",
                    "Country": r.country or "",
                    "Status": r.status or "N/A",
                    "Active": "Yes" if r.is_active else "No",
                    "Version": r.version,
                    "Synced At": r.synced_at.isoformat() if r.synced_at else "",
                }
                for r in rows_data
            ]
            return columns, rows

        elif report_key == "global_product_catalog":
            columns = ["ID", "Source ERP", "Product Code", "Name", "Category", "UOM", "Status", "Active", "Version", "Synced At"]
            if not target_erp_ids:
                return columns, []
            rows_data, _ = await self.product_repo.search(
                allowed_erp_ids=target_erp_ids,
                query=query,
                category=filters.get("category"),
                limit=limit or 5000,
            )
            rows = [
                {
                    "ID": str(r.id),
                    "Source ERP": str(r.source_erp_id),
                    "Product Code": r.product_code,
                    "Name": r.name,
                    "Category": r.category or "",
                    "UOM": r.uom or "",
                    "Status": r.status or "N/A",
                    "Active": "Yes" if r.is_active else "No",
                    "Version": r.version,
                    "Synced At": r.synced_at.isoformat() if r.synced_at else "",
                }
                for r in rows_data
            ]
            return columns, rows

        elif report_key == "global_inquiry_pipeline":
            columns = ["ID", "Source ERP", "Inquiry Number", "Buyer Name", "Season", "Status", "Items Count", "Version", "Synced At"]
            if not target_erp_ids:
                return columns, []
            rows_data, _ = await self.inquiry_repo.search(
                allowed_erp_ids=target_erp_ids,
                query=query,
                status=status_filter,
                limit=limit or 5000,
            )
            rows = [
                {
                    "ID": str(r.id),
                    "Source ERP": str(r.source_erp_id),
                    "Inquiry Number": r.inquiry_number,
                    "Buyer Name": r.buyer_name or "",
                    "Season": r.season or "",
                    "Status": r.status or "N/A",
                    "Items Count": r.item_count,
                    "Version": r.version,
                    "Synced At": r.synced_at.isoformat() if r.synced_at else "",
                }
                for r in rows_data
            ]
            return columns, rows

        elif report_key == "cross_erp_overview":
            columns = ["ERP Key", "Display Name", "Buyers", "Suppliers", "Products", "Inquiries", "Status"]
            all_erps = await self.erp_repo.list_all()
            target_erps = [e for e in all_erps if e.id in target_erp_ids]
            rows = []
            for erp in target_erps:
                b_cnt = await self.buyer_repo.count_for_erp(erp.id)
                s_cnt = await self.supplier_repo.count_for_erp(erp.id)
                p_cnt = await self.product_repo.count_for_erp(erp.id)
                i_cnt = await self.inquiry_repo.count_for_erp(erp.id)
                rows.append({
                    "ERP Key": erp.key,
                    "Display Name": erp.display_name,
                    "Buyers": b_cnt,
                    "Suppliers": s_cnt,
                    "Products": p_cnt,
                    "Inquiries": i_cnt,
                    "Status": erp.status.value,
                })
            return columns, rows

        raise ValidationException(f"Unsupported report key: {report_key}")

    async def preview_report(
        self,
        report_key: str,
        filters: dict[str, Any],
        allowed_erp_ids: list[uuid.UUID],
        limit: int = 20,
    ) -> ReportPreviewResponse:
        columns, rows = await self.query_report_data(report_key, filters, allowed_erp_ids, limit=limit)
        return ReportPreviewResponse(
            report_key=report_key,
            columns=columns,
            rows=rows[:limit],
            total_rows=len(rows),
            data_as_of=datetime.now(timezone.utc),
        )


class ExportService:
    """Manages asynchronous report export job lifecycle, real file delivery, and path security."""

    def __init__(
        self,
        job_repository: ReportExportJobRepository,
        report_engine: ReportEngine,
        search_service: SearchService,
        erp_instance_repository: ErpInstanceRepository,
        audit: GlobalAuditService,
    ) -> None:
        self.job_repository = job_repository
        self.report_engine = report_engine
        self.search_service = search_service
        self.erp_instance_repository = erp_instance_repository
        self.audit = audit

    async def request_export(
        self, payload: ExportRequest, *, requested_by: uuid.UUID, actor_label: str
    ) -> ReportExportJob:
        """Create a PENDING export job."""
        job = ReportExportJob(
            requested_by=requested_by,
            report_type=payload.report_type,
            export_format=payload.export_format.lower(),
            filters_json=json.dumps(payload.model_dump(mode="json", exclude={"report_type", "export_format"})),
            status=ExportStatus.PENDING,
        )
        created = await self.job_repository.create(job)
        await self.audit.record(
            event_type=AuditEventType.REPORT_EXPORT_REQUESTED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=requested_by,
            actor_label=actor_label,
            target_type="report_export_job",
            target_id=created.id,
            details={"report_type": payload.report_type, "export_format": payload.export_format},
        )
        return created

    async def execute_export_job(self, job_id: uuid.UUID) -> ReportExportJob:
        """
        Execute export job: generate real CSV or XLSX file, record metadata, and mark COMPLETED.
        """
        job = await self.job_repository.get_by_id(job_id)
        if not job:
            raise NotFoundException(f"Export job {job_id} not found.")

        job.status = ExportStatus.RUNNING
        await self.job_repository.update(job)

        try:
            filters = json.loads(job.filters_json or "{}")
            all_erps = await self.erp_instance_repository.list_all()
            all_erp_ids = [e.id for e in all_erps]
            allowed_erp_ids = await self.search_service.resolve_allowed_erp_ids(job.requested_by, all_erp_ids)

            columns, rows = await self.report_engine.query_report_data(
                report_key=job.report_type,
                filters=filters,
                allowed_erp_ids=allowed_erp_ids,
            )

            # Ensure export directory exists
            export_dir = os.path.abspath(settings.REPORT_EXPORT_DIR)
            os.makedirs(export_dir, exist_ok=True)

            filename = f"{job.id}.{job.export_format}"
            file_path = os.path.join(export_dir, filename)

            if job.export_format == "csv":
                with open(file_path, mode="w", newline="", encoding="utf-8") as f:
                    writer = csv.DictWriter(f, fieldnames=columns)
                    writer.writeheader()
                    for row in rows:
                        writer.writerow(row)
                content_type = "text/csv"

            elif job.export_format == "xlsx":
                wb = openpyxl.Workbook()
                ws = wb.active
                ws.title = job.report_type[:30]
                ws.append(columns)
                for row in rows:
                    ws.append([row.get(col, "") for col in columns])
                wb.save(file_path)
                content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

            else:
                raise ValidationException(f"Unsupported format: {job.export_format}")

            file_size = os.path.getsize(file_path)
            token = secrets.token_urlsafe(32)
            expires = datetime.now(timezone.utc) + timedelta(hours=24)

            job.status = ExportStatus.COMPLETED
            job.row_count = len(rows)
            job.file_path = file_path
            job.file_size_bytes = file_size
            job.content_type = content_type
            job.download_token = token
            job.expires_at = expires
            job.completed_at = datetime.now(timezone.utc)
            await self.job_repository.update(job)

            return job

        except Exception as exc:  # noqa: BLE001
            logger.exception("Export job execution failed: %s", exc)
            job.status = ExportStatus.FAILED
            job.error_message = str(exc)[:2000]
            job.completed_at = datetime.now(timezone.utc)
            await self.job_repository.update(job)
            return job

    async def get_job(self, job_id: uuid.UUID, *, requested_by: uuid.UUID) -> ReportExportJob:
        job = await self.job_repository.get_by_id(job_id)
        if job is None:
            raise NotFoundException(f"No export job found with id {job_id}.")
        if job.requested_by != requested_by:
            raise ForbiddenException("This export job belongs to a different user.")
        return job

    async def list_my_jobs(self, requested_by: uuid.UUID) -> list[ReportExportJob]:
        return await self.job_repository.list_for_user(requested_by)

    async def resolve_export_download(
        self,
        job_id: uuid.UUID,
        download_token: str | None = None,
        user_id: uuid.UUID | None = None,
    ) -> tuple[str, str, str]:
        """
        Validate permissions/token, enforce expiration and directory confinement, and return file path.
        Returns: (file_path, content_type, download_filename)
        """
        job = await self.job_repository.get_by_id(job_id)
        if not job or job.status != ExportStatus.COMPLETED or not job.file_path:
            raise NotFoundException("Export file is not available.")

        # Authenticate via token or user ownership
        authorized = False
        if download_token and job.download_token and secrets.compare_digest(download_token, job.download_token):
            authorized = True
        elif user_id and job.requested_by == user_id:
            authorized = True

        if not authorized:
            raise ForbiddenException("Unauthorized to download this export file.")

        # Expiration validation
        now = datetime.now(timezone.utc)
        if job.expires_at:
            exp = job.expires_at if job.expires_at.tzinfo else job.expires_at.replace(tzinfo=timezone.utc)
            if now > exp:
                raise ForbiddenException("Download link has expired.")

        # Path traversal defense: file MUST reside strictly within REPORT_EXPORT_DIR
        abs_export_dir = os.path.abspath(settings.REPORT_EXPORT_DIR)
        abs_file_path = os.path.abspath(job.file_path)

        try:
            common = os.path.commonpath([abs_export_dir, abs_file_path])
            if common != abs_export_dir:
                raise ForbiddenException("Access denied: path traversal detected.")
        except ValueError:
            raise ForbiddenException("Access denied: invalid file path.")

        if not os.path.exists(abs_file_path):
            raise NotFoundException("Export file was removed from server.")

        filename = f"{job.report_type}_{str(job.id)[:8]}.{job.export_format}"
        content_type = job.content_type or ("text/csv" if job.export_format == "csv" else "application/octet-stream")
        return abs_file_path, content_type, filename


class ReconciliationService:
    """Compares global projections with partner ERP outbox telemetry via HTTP without cross-DB queries."""

    def __init__(
        self,
        erp_instance_repository: ErpInstanceRepository,
        buyer_projection_repository: GlobalBuyerProjectionRepository,
        supplier_projection_repository: GlobalSupplierProjectionRepository,
        product_projection_repository: GlobalProductProjectionRepository,
        inquiry_projection_repository: GlobalInquiryProjectionRepository,
        audit: GlobalAuditService,
    ) -> None:
        self.erp_instance_repository = erp_instance_repository
        self.buyer_projection_repository = buyer_projection_repository
        self.supplier_projection_repository = supplier_projection_repository
        self.product_projection_repository = product_projection_repository
        self.inquiry_projection_repository = inquiry_projection_repository
        self.audit = audit

    async def reconcile_erp(
        self,
        erp_id: uuid.UUID,
        *,
        actor_id: uuid.UUID,
        actor_label: str,
        entity_type: str | None = None,
    ) -> ReconciliationResult:
        erp = await self.erp_instance_repository.get_by_id(erp_id)
        if erp is None:
            raise NotFoundException(f"No ERP instance found with id {erp_id}.")

        b_cnt = await self.buyer_projection_repository.count_for_erp(erp_id)
        s_cnt = await self.supplier_projection_repository.count_for_erp(erp_id)
        p_cnt = await self.product_projection_repository.count_for_erp(erp_id)
        i_cnt = await self.inquiry_projection_repository.count_for_erp(erp_id)

        if entity_type == "buyer":
            local_count = b_cnt
        elif entity_type == "supplier":
            local_count = s_cnt
        elif entity_type == "product":
            local_count = p_cnt
        elif entity_type == "inquiry":
            local_count = i_cnt
        else:
            local_count = b_cnt + s_cnt + p_cnt + i_cnt

        outbox_published_count = None
        status = "UNKNOWN"
        details: dict[str, Any] = {
            "by_entity": {
                "buyer": b_cnt,
                "supplier": s_cnt,
                "product": p_cnt,
                "inquiry": i_cnt,
            }
        }

        # Attempt to contact partner ERP telemetry endpoint
        if erp.base_url:
            telemetry_url = f"{erp.base_url.rstrip('/')}/api/v1/integration/telemetry"
            headers = {
                "Authorization": f"Bearer {settings.FEDERATION_SERVICE_CREDENTIAL}",
                "User-Agent": "ERP_Main-Reconciliation/1.0",
            }
            try:
                async with httpx.AsyncClient(timeout=3.0) as client:
                    resp = await client.get(telemetry_url, headers=headers)
                    if resp.status_code == 200:
                        payload = resp.json()
                        telemetry_data = payload.get("data", {})
                        details["remote_telemetry"] = telemetry_data

                        if entity_type:
                            outbox_published_count = telemetry_data.get("by_aggregate_type", {}).get(entity_type, 0)
                        else:
                            outbox_published_count = telemetry_data.get("published_count", 0)

                        if local_count == outbox_published_count:
                            status = "MATCHED"
                        else:
                            status = "RECONCILIATION_REQUIRED"
                    else:
                        details["telemetry_error"] = f"HTTP {resp.status_code}: {resp.text[:200]}"
            except Exception as exc:  # noqa: BLE001
                details["telemetry_error"] = f"Connection failed: {str(exc)[:200]}"

        result = ReconciliationResult(
            erp_id=erp_id,
            erp_key=erp.key,
            projection_count=local_count,
            outbox_published_count=outbox_published_count,
            status=status,
            details=details,
        )

        await self.audit.record(
            event_type=AuditEventType.RECONCILIATION_EXECUTED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="erp_instance",
            target_id=erp_id,
            details={"projection_count": local_count, "outbox_count": outbox_published_count, "status": status},
        )
        return result


class MetricsService:
    """Provides point-in-time metrics across all platform operations."""

    def __init__(
        self,
        db: AsyncSession,
        erp_repo: ErpInstanceRepository,
        user_repo: GlobalUserRepository,
        membership_repo: ErpMembershipRepository,
        inbox_repo: IntegrationInboxRepository,
        dead_letter_repo: IntegrationDeadLetterRepository,
        buyer_repo: GlobalBuyerProjectionRepository,
        supplier_repo: GlobalSupplierProjectionRepository,
        product_repo: GlobalProductProjectionRepository,
        inquiry_repo: GlobalInquiryProjectionRepository,
    ) -> None:
        self.db = db
        self.erp_repo = erp_repo
        self.user_repo = user_repo
        self.membership_repo = membership_repo
        self.inbox_repo = inbox_repo
        self.dead_letter_repo = dead_letter_repo
        self.buyer_repo = buyer_repo
        self.supplier_repo = supplier_repo
        self.product_repo = product_repo
        self.inquiry_repo = inquiry_repo

    async def get_metrics(self) -> GlobalMetricsResponse:
        all_erps = await self.erp_repo.list_all()
        active_erps = [e for e in all_erps if e.status.value == "ACTIVE"]

        users = await self.user_repo.list_all(limit=100_000)
        memberships_count = await self.membership_repo.count_active()

        inbox_count = (await self.db.execute(select(func.count()).select_from(IntegrationInboxEvent))).scalar_one()
        dead_letters = await self.dead_letter_repo.list_unreplayed(limit=10_000)

        buyer_cnt = (await self.db.execute(select(func.count()).select_from(GlobalBuyerProjection))).scalar_one()
        supplier_cnt = (await self.db.execute(select(func.count()).select_from(GlobalSupplierProjection))).scalar_one()
        product_cnt = (await self.db.execute(select(func.count()).select_from(GlobalProductProjection))).scalar_one()
        inquiry_cnt = (await self.db.execute(select(func.count()).select_from(GlobalInquiryProjection))).scalar_one()

        export_jobs = (await self.db.execute(
            select(ReportExportJob.status, func.count(ReportExportJob.id)).group_by(ReportExportJob.status)
        )).all()
        export_job_counts = {s.value if hasattr(s, "value") else str(s): cnt for s, cnt in export_jobs}

        return GlobalMetricsResponse(
            total_erps=len(all_erps),
            active_erps=len(active_erps),
            total_global_users=len(users),
            active_memberships=memberships_count,
            total_inbox_events=inbox_count,
            unreplayed_dead_letters=len(dead_letters),
            projection_counts={
                "buyer": buyer_cnt,
                "supplier": supplier_cnt,
                "product": product_cnt,
                "inquiry": inquiry_cnt,
            },
            export_job_counts=export_job_counts,
            timestamp=datetime.now(timezone.utc),
        )


class HealthService:
    """Evaluates health of subsystems."""

    def __init__(self, db: AsyncSession, erp_repo: ErpInstanceRepository) -> None:
        self.db = db
        self.erp_repo = erp_repo

    async def check_subsystems(self) -> SubsystemsHealthResponse:
        subsystems: list[SubsystemHealthItem] = []
        now = datetime.now(timezone.utc)

        # 1. Database
        db_status = "HEALTHY"
        db_details = {}
        try:
            await self.db.execute(select(1))
            db_details["connection"] = "ok"
        except Exception as exc:  # noqa: BLE001
            db_status = "UNHEALTHY"
            db_details["error"] = str(exc)
        subsystems.append(SubsystemHealthItem(subsystem="database", status=db_status, details=db_details, checked_at=now))

        # 2. Integration Pipeline
        pipe_status = "HEALTHY"
        pipe_details = {}
        try:
            latest_event = (
                await self.db.execute(select(IntegrationInboxEvent).order_by(IntegrationInboxEvent.created_at.desc()).limit(1))
            ).scalar_one_or_none()
            if latest_event:
                ev_dt = latest_event.created_at
                now_dt = now.replace(tzinfo=None) if ev_dt.tzinfo is None else now
                lag = (now_dt - ev_dt).total_seconds()
                pipe_details["latest_event_lag_seconds"] = lag
            else:
                pipe_details["events"] = "empty"
        except Exception as exc:  # noqa: BLE001
            pipe_status = "DEGRADED"
            pipe_details["error"] = str(exc)
        subsystems.append(SubsystemHealthItem(subsystem="integration_inbox", status=pipe_status, details=pipe_details, checked_at=now))

        # 3. Export Storage
        storage_status = "HEALTHY"
        storage_details = {}
        try:
            exp_dir = os.path.abspath(settings.REPORT_EXPORT_DIR)
            os.makedirs(exp_dir, exist_ok=True)
            storage_details["export_directory"] = exp_dir
            storage_details["writable"] = os.access(exp_dir, os.W_OK)
        except Exception as exc:  # noqa: BLE001
            storage_status = "DEGRADED"
            storage_details["error"] = str(exc)
        subsystems.append(SubsystemHealthItem(subsystem="export_storage", status=storage_status, details=storage_details, checked_at=now))

        overall = "HEALTHY"
        if any(s.status == "UNHEALTHY" for s in subsystems):
            overall = "UNHEALTHY"
        elif any(s.status == "DEGRADED" for s in subsystems):
            overall = "DEGRADED"

        return SubsystemsHealthResponse(status=overall, subsystems=subsystems, checked_at=now)


class ExportCleanupService:
    """Prunes expired export files from server disk and cleans up metadata."""

    def __init__(self, job_repo: ReportExportJobRepository) -> None:
        self.job_repo = job_repo

    async def prune_expired_exports(self) -> dict[str, int]:
        now = datetime.now(timezone.utc)
        expired_jobs = await self.job_repo.list_expired(now)
        pruned_count = 0
        error_count = 0

        for job in expired_jobs:
            if job.file_path and os.path.exists(job.file_path):
                try:
                    os.remove(job.file_path)
                    job.file_path = None
                    await self.job_repo.update(job)
                    pruned_count += 1
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Could not remove expired file %s: %s", job.file_path, exc)
                    error_count += 1

        return {"expired_identified": len(expired_jobs), "pruned": pruned_count, "errors": error_count}
