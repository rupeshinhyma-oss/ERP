"""Reporting Pydantic Schemas (Phase 7)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.reporting.models import ExportStatus


class GlobalBuyerProjectionRead(BaseModel):
    """A buyer projection as returned by search/report endpoints."""

    id: uuid.UUID
    source_erp_id: uuid.UUID
    source_entity_type: str
    source_entity_id: uuid.UUID
    company_name: str
    status: str | None
    version: int = 1
    synced_at: datetime

    model_config = {"from_attributes": True}


class GlobalBuyerProjectionDetail(GlobalBuyerProjectionRead):
    """Detailed buyer projection for inspection drawers."""

    last_event_id: uuid.UUID
    last_event_occurred_at: datetime
    created_at: datetime
    updated_at: datetime


class GlobalSupplierProjectionRead(BaseModel):
    """A supplier projection as returned by search/report endpoints."""

    id: uuid.UUID
    source_erp_id: uuid.UUID
    source_entity_type: str
    source_entity_id: uuid.UUID
    supplier_code: str | None
    name: str
    email: str | None
    phone: str | None
    country: str | None
    status: str | None
    is_active: bool
    version: int = 1
    synced_at: datetime

    model_config = {"from_attributes": True}


class GlobalSupplierProjectionDetail(GlobalSupplierProjectionRead):
    """Detailed supplier projection for inspection drawers."""

    last_event_id: uuid.UUID
    last_event_occurred_at: datetime
    created_at: datetime
    updated_at: datetime


class GlobalProductProjectionRead(BaseModel):
    """A product projection as returned by search/report endpoints."""

    id: uuid.UUID
    source_erp_id: uuid.UUID
    source_entity_type: str
    source_entity_id: uuid.UUID
    product_code: str
    name: str
    category: str | None
    uom: str | None
    status: str | None
    is_active: bool
    version: int = 1
    synced_at: datetime

    model_config = {"from_attributes": True}


class GlobalProductProjectionDetail(GlobalProductProjectionRead):
    """Detailed product projection for inspection drawers."""

    last_event_id: uuid.UUID
    last_event_occurred_at: datetime
    created_at: datetime
    updated_at: datetime


class GlobalInquiryProjectionRead(BaseModel):
    """An inquiry projection as returned by search/report endpoints."""

    id: uuid.UUID
    source_erp_id: uuid.UUID
    source_entity_type: str
    source_entity_id: uuid.UUID
    inquiry_number: str
    buyer_name: str | None
    season: str | None
    status: str | None
    item_count: int
    version: int = 1
    synced_at: datetime

    model_config = {"from_attributes": True}


class GlobalInquiryProjectionDetail(GlobalInquiryProjectionRead):
    """Detailed inquiry projection for inspection drawers."""

    last_event_id: uuid.UUID
    last_event_occurred_at: datetime
    created_at: datetime
    updated_at: datetime


class ReportDefinitionRead(BaseModel):
    """Report metadata catalog definition."""

    report_key: str
    name: str
    description: str
    entity_type: str
    supported_formats: list[str]
    supported_filters: list[str]
    status: str
    is_available: bool


class SearchResponse(BaseModel):
    """A page of buyer search results, with pagination metadata and freshness."""

    results: list[GlobalBuyerProjectionRead]
    total: int
    limit: int
    offset: int
    data_as_of: datetime = Field(..., description="When this data was last known accurate.")


class GenericSearchResult(BaseModel):
    """One polymorphic result across multiple business entities."""

    id: uuid.UUID
    entity_type: str
    display_title: str
    display_subtitle: str | None = None
    source_erp_id: uuid.UUID
    source_entity_id: uuid.UUID
    status: str | None = None
    synced_at: datetime
    raw_data: dict[str, Any] = Field(default_factory=dict)


class UnifiedSearchResponse(BaseModel):
    """Unified search response across multiple business entities."""

    results: list[GenericSearchResult]
    total: int
    limit: int
    offset: int
    data_as_of: datetime
    by_entity_type: dict[str, int] = Field(default_factory=dict)


class ErpHealthRead(BaseModel):
    """One ERP's health summary for the dashboard."""

    erp_id: uuid.UUID
    erp_key: str
    display_name: str
    status: str
    last_seen_at: datetime | None
    api_health: str = Field(..., description="'HEALTHY' if last_seen_at is recent, 'STALE' or 'UNKNOWN' otherwise.")
    enabled_capabilities: list[str]
    buyer_projection_count: int
    supplier_projection_count: int = 0
    product_projection_count: int = 0
    inquiry_projection_count: int = 0


class ProjectionHealthRead(BaseModel):
    """One projection type's sync-health summary."""

    projection_type: str
    last_processed_at: datetime | None
    events_processed_count: int
    error_count: int
    last_error: str | None
    lag_seconds: float | None = Field(
        None, description="current_time - last_processed_inbox_event_created_at, if known."
    )


class GlobalDashboardRead(BaseModel):
    """The platform dashboard summary."""

    active_erps: int
    total_erps: int
    global_users: int
    active_memberships: int
    events_received_total: int
    events_dead_lettered_total: int
    erp_health: list[ErpHealthRead]
    projection_health: list[ProjectionHealthRead]
    data_as_of: datetime


class ReconciliationResult(BaseModel):
    """Result of a reconciliation pass for one ERP."""

    erp_id: uuid.UUID
    erp_key: str
    projection_count: int
    outbox_published_count: int | None = Field(
        None,
        description="Count of PUBLISHED outbox events on the source ERP, if reachable. "
        "None means the source ERP could not be reached for comparison.",
    )
    status: str = Field(..., description="'MATCHED' | 'RECONCILIATION_REQUIRED' | 'UNKNOWN'")
    details: dict[str, Any] = Field(default_factory=dict)


class ExportRequest(BaseModel):
    """Payload to request an asynchronous report export."""

    report_type: str = Field(..., min_length=1, max_length=100)
    export_format: str = Field(..., pattern="^(csv|xlsx)$")
    erp_ids: list[uuid.UUID] | None = Field(
        default=None,
        description="Restrict the export to these ERPs. Still filtered by the caller's own authorization.",
    )
    query: str | None = None
    status: str | None = None


class ExportJobRead(BaseModel):
    """An export job's status as returned by the API."""

    id: uuid.UUID
    report_type: str
    export_format: str
    status: ExportStatus
    row_count: int | None
    error_message: str | None
    completed_at: datetime | None
    file_path: str | None = None
    file_size_bytes: int | None = None
    download_token: str | None = None
    expires_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReportPreviewResponse(BaseModel):
    """Data preview for a report in the catalog."""

    report_key: str
    columns: list[str]
    rows: list[dict[str, Any]]
    total_rows: int
    data_as_of: datetime


class SubsystemHealthItem(BaseModel):
    """Status of an individual subsystem."""

    subsystem: str
    status: str  # HEALTHY | DEGRADED | UNHEALTHY
    details: dict[str, Any] = Field(default_factory=dict)
    checked_at: datetime


class SubsystemsHealthResponse(BaseModel):
    """Health check across all control plane subsystems."""

    status: str  # HEALTHY | DEGRADED | UNHEALTHY
    subsystems: list[SubsystemHealthItem]
    checked_at: datetime


class GlobalMetricsResponse(BaseModel):
    """Real point-in-time metrics for platform operations."""

    total_erps: int
    active_erps: int
    total_global_users: int
    active_memberships: int
    total_inbox_events: int
    unreplayed_dead_letters: int
    projection_counts: dict[str, int]
    export_job_counts: dict[str, int]
    timestamp: datetime
