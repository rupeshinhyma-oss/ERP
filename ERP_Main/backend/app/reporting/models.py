"""
Global Reporting / Read Model ORM Models (Phase 7).

Projections:
- `GlobalBuyerProjection` -- read model built from `buyer.created` / `buyer.updated`
- `GlobalSupplierProjection` -- read model built from `supplier.created` / `supplier.updated`
- `GlobalProductProjection` -- read model built from `product.created` / `product.updated`
- `GlobalInquiryProjection` -- read model built from `inquiry.created` / `inquiry.updated`

Support Tables:
- `ProjectionCheckpoint` -- sync-health bookkeeping per projection type
- `ReportExportJob` -- asynchronous report export job tracking and file delivery
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.erp_registry.models import ErpInstance


class ExportStatus(str, Enum):
    """Lifecycle of an asynchronous report export job (Phase 7 Section 25)."""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class GlobalBuyerProjection(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A read-only, searchable projection of one buyer, built from `buyer.*` events.
    """

    __tablename__ = "global_buyer_projections"
    __table_args__ = (
        UniqueConstraint(
            "source_erp_id", "source_entity_type", "source_entity_id", name="uq_global_buyer_projection_source"
        ),
    )

    source_erp_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("erp_instances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_entity_type: Mapped[str] = mapped_column(String(100), nullable=False, default="buyer")
    source_entity_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    company_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_event_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), nullable=False, doc="The integration event_id that most recently updated this projection."
    )
    last_event_occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        doc="occurred_at of the event that last updated this row -- used to reject a genuinely older re-delivery.",
    )
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        doc="When THIS projection row was last written.",
    )

    source_erp: Mapped[ErpInstance] = relationship()

    def __repr__(self) -> str:
        return f"<GlobalBuyerProjection company_name={self.company_name!r} source_erp_id={self.source_erp_id}>"


class GlobalSupplierProjection(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A read-only, searchable projection of one supplier, built from `supplier.*` events.
    """

    __tablename__ = "global_supplier_projections"
    __table_args__ = (
        UniqueConstraint(
            "source_erp_id", "source_entity_type", "source_entity_id", name="uq_global_supplier_projection_source"
        ),
    )

    source_erp_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("erp_instances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_entity_type: Mapped[str] = mapped_column(String(100), nullable=False, default="supplier")
    source_entity_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    supplier_code: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    country: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_event_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), nullable=False, doc="The integration event_id that most recently updated this projection."
    )
    last_event_occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    source_erp: Mapped[ErpInstance] = relationship()

    def __repr__(self) -> str:
        return f"<GlobalSupplierProjection name={self.name!r} source_erp_id={self.source_erp_id}>"


class GlobalProductProjection(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A read-only, searchable projection of one product, built from `product.*` events.
    """

    __tablename__ = "global_product_projections"
    __table_args__ = (
        UniqueConstraint(
            "source_erp_id", "source_entity_type", "source_entity_id", name="uq_global_product_projection_source"
        ),
    )

    source_erp_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("erp_instances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_entity_type: Mapped[str] = mapped_column(String(100), nullable=False, default="product")
    source_entity_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    product_code: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    uom: Mapped[str | None] = mapped_column(String(50), nullable=True)
    status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_event_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), nullable=False, doc="The integration event_id that most recently updated this projection."
    )
    last_event_occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    source_erp: Mapped[ErpInstance] = relationship()

    def __repr__(self) -> str:
        return f"<GlobalProductProjection product_code={self.product_code!r} source_erp_id={self.source_erp_id}>"


class GlobalInquiryProjection(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A read-only, searchable projection of one inquiry consignment, built from `inquiry.*` events.
    """

    __tablename__ = "global_inquiry_projections"
    __table_args__ = (
        UniqueConstraint(
            "source_erp_id", "source_entity_type", "source_entity_id", name="uq_global_inquiry_projection_source"
        ),
    )

    source_erp_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("erp_instances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_entity_type: Mapped[str] = mapped_column(String(100), nullable=False, default="inquiry")
    source_entity_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    inquiry_number: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    buyer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    season: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_event_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), nullable=False, doc="The integration event_id that most recently updated this projection."
    )
    last_event_occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    source_erp: Mapped[ErpInstance] = relationship()

    def __repr__(self) -> str:
        return f"<GlobalInquiryProjection inquiry_number={self.inquiry_number!r} source_erp_id={self.source_erp_id}>"


class ProjectionCheckpoint(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Sync-health bookkeeping for one projection type (Phase 7 Section 22).
    """

    __tablename__ = "projection_checkpoints"
    __table_args__ = (UniqueConstraint("projection_type", name="uq_projection_checkpoint_type"),)

    projection_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    last_processed_inbox_event_created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_event_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    last_processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    events_processed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:
        return f"<ProjectionCheckpoint projection_type={self.projection_type!r} error_count={self.error_count}>"


class ReportExportJob(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    An asynchronous report export request (Phase 7 Section 25/26).
    """

    __tablename__ = "report_export_jobs"

    requested_by: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        nullable=False,
        index=True,
        doc="The PlatformAdmin.id or GlobalUser.id who requested this export.",
    )
    report_type: Mapped[str] = mapped_column(String(100), nullable=False, doc="e.g. 'global_buyer_summary'.")
    export_format: Mapped[str] = mapped_column(String(10), nullable=False, doc="'csv' | 'xlsx'.")
    filters_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    status: Mapped[ExportStatus] = mapped_column(
        SAEnum(ExportStatus, name="export_job_status", native_enum=False, length=20),
        nullable=False,
        default=ExportStatus.PENDING,
        index=True,
    )
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # File delivery columns
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    download_token: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<ReportExportJob report_type={self.report_type!r} status={self.status.value}>"
