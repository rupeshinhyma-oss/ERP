"""
CRM Module ORM Models.

Database foundation for the new Inhyma CRM and Lead Management System:
- CrmPipeline: Multiple sales pipelines with default flags
- CrmPipelineStage: Stages with order, open/won/lost types, and restrict-on-delete protection
- CrmLead: Comprehensive CRM leads with distinct lead_code, ownership, attribution, and custom fields
- CrmAssignmentHistory: Append-only audit trail of ownership handoffs
- CrmActivity: Timeline of lead touchpoints (calls, meetings, emails, etc.)
- CrmFollowUp: Scheduled CRM follow-up commitments separate from legacy logs
- CrmStageHistory: Audit log of pipeline stage transitions
- CrmImportBatch: Batch metadata for external lead imports
- CrmAssignmentConfig & CrmRoundRobinCursor: Config and concurrency-safe distribution cursors
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from decimal import Decimal
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import (
    Base,
    GUID,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    VersionMixin,
    _utcnow,
)
from app.companies.models import Company
from app.masters.products.models import Product
from app.masters.states.models import State
from app.users.models import User


def generate_crm_lead_code() -> str:
    """Generate a clean, collision-resistant unique CRM lead code."""
    now_part = datetime.now(timezone.utc).strftime("%Y%m%d")
    rnd_part = uuid.uuid4().hex[:6].upper()
    return f"CRM-{now_part}-{rnd_part}"


class CrmPipeline(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Sales Pipeline entity.

    Supports multiple distinct sales workflows (e.g. Inbound Sales, Outbound B2B,
    Enterprise Partnerships). One pipeline can be marked as default.
    """

    __tablename__ = "crm_pipelines"

    name: Mapped[str] = mapped_column(String(150), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Relationships
    stages: Mapped[list[CrmPipelineStage]] = relationship(
        "CrmPipelineStage",
        back_populates="pipeline",
        cascade="all, delete-orphan",
        order_by="CrmPipelineStage.stage_order",
    )
    leads: Mapped[list[CrmLead]] = relationship(
        "CrmLead",
        back_populates="pipeline",
    )
    creator = relationship("User", foreign_keys=[created_by])

    def __repr__(self) -> str:
        return f"<CrmPipeline id={self.id} name={self.name!r} is_default={self.is_default}>"


class CrmPipelineStage(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Individual Stage within a CRM Pipeline.

    Stages have an explicit order, a classification type ('open', 'won', 'lost'),
    and a flag designating if it serves as the initial landing stage.
    """

    __tablename__ = "crm_pipeline_stages"
    __table_args__ = (
        UniqueConstraint("pipeline_id", "stage_order", name="uq_crm_pipeline_stage_order"),
        UniqueConstraint("pipeline_id", "name", name="uq_crm_pipeline_stage_name"),
        CheckConstraint("stage_type IN ('open', 'won', 'lost')", name="ck_crm_pipeline_stage_type"),
    )

    pipeline_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("crm_pipelines.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    stage_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    stage_type: Mapped[str] = mapped_column(String(20), nullable=False, default="open")  # open, won, lost
    is_initial: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Relationships
    pipeline: Mapped[CrmPipeline] = relationship("CrmPipeline", back_populates="stages")
    leads: Mapped[list[CrmLead]] = relationship("CrmLead", back_populates="stage")

    def __repr__(self) -> str:
        return f"<CrmPipelineStage id={self.id} name={self.name!r} order={self.stage_order} type={self.stage_type}>"


class CrmLead(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Core Lead entity in the new CRM system.

    Tracks prospect contact information, business context, pipeline/stage state,
    assignment history, attribution, and follow-up schedules.
    Phone uniqueness is intentionally not enforced at the database level to accommodate
    intentional duplicate campaigns while enabling application-level deduplication.
    """

    __tablename__ = "crm_leads"
    __table_args__ = (
        UniqueConstraint("external_source_system", "external_record_id", name="uq_crm_leads_external_source_record"),
        Index("ix_crm_leads_normalized_phone", "normalized_phone"),
        Index("ix_crm_leads_assigned_to", "assigned_to"),
        Index("ix_crm_leads_pipeline_stage", "pipeline_id", "stage_id"),
        Index("ix_crm_leads_status", "status"),
        Index("ix_crm_leads_campaign", "campaign"),
        Index("ix_crm_leads_created_at", "created_at"),
        Index("ix_crm_leads_next_follow_up_at", "next_follow_up_at"),
    )

    lead_code: Mapped[str] = mapped_column(
        String(50), unique=True, nullable=False, default=generate_crm_lead_code, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    original_phone: Mapped[str] = mapped_column(String(50), nullable=False)
    normalized_phone: Mapped[str] = mapped_column(String(50), nullable=False)
    email: Mapped[str | None] = mapped_column(String(150), nullable=True, index=True)
    company_name: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Campaign and Source Attribution
    campaign: Mapped[str | None] = mapped_column(String(150), nullable=True)
    source_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="company_campaign",
        index=True,
        doc="e.g. company_campaign, personal_lead, referral, website, import, inquiry",
    )
    source_detail: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # External Import Identifiers (for idempotent CRM imports)
    external_source_system: Mapped[str | None] = mapped_column(String(100), nullable=True)
    external_record_id: Mapped[str | None] = mapped_column(String(150), nullable=True)

    # Ownership & Pipeline State
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    pipeline_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("crm_pipelines.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    stage_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("crm_pipeline_stages.id", ondelete="RESTRICT"), nullable=True, index=True
    )

    # Lifecycle State & Priority
    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="new",
        doc="e.g. new, contacted, in_progress, qualified, disqualified, won, lost",
    )
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="medium")  # low, medium, high, urgent

    # Engagement Timestamps & Outcomes
    next_follow_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_contacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    won_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lost_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lost_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Dynamic Attributes
    custom_fields: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Relationships
    pipeline: Mapped[CrmPipeline | None] = relationship("CrmPipeline", back_populates="leads")
    stage: Mapped[CrmPipelineStage | None] = relationship("CrmPipelineStage", back_populates="leads")
    company = relationship("Company", foreign_keys=[company_id])
    creator = relationship("User", foreign_keys=[created_by])
    assignee = relationship("User", foreign_keys=[assigned_to])

    assignment_history: Mapped[list[CrmAssignmentHistory]] = relationship(
        "CrmAssignmentHistory",
        back_populates="lead",
        cascade="all, delete-orphan",
        order_by="desc(CrmAssignmentHistory.created_at)",
    )
    activities: Mapped[list[CrmActivity]] = relationship(
        "CrmActivity",
        back_populates="lead",
        cascade="all, delete-orphan",
        order_by="desc(CrmActivity.activity_at)",
    )
    follow_ups: Mapped[list[CrmFollowUp]] = relationship(
        "CrmFollowUp",
        back_populates="lead",
        cascade="all, delete-orphan",
        order_by="CrmFollowUp.due_at",
    )
    stage_history: Mapped[list[CrmStageHistory]] = relationship(
        "CrmStageHistory",
        back_populates="lead",
        cascade="all, delete-orphan",
        order_by="desc(CrmStageHistory.created_at)",
    )
    associated_products: Mapped[list[CrmLeadProduct]] = relationship(
        "CrmLeadProduct",
        back_populates="lead",
        cascade="all, delete-orphan",
        order_by="desc(CrmLeadProduct.created_at)",
    )
    quotations: Mapped[list[CrmSalesQuotation]] = relationship(
        "CrmSalesQuotation",
        back_populates="lead",
        cascade="all, delete-orphan",
        order_by="desc(CrmSalesQuotation.created_at)",
    )

    def __repr__(self) -> str:
        return f"<CrmLead id={self.id} code={self.lead_code!r} name={self.name!r} status={self.status!r}>"


class CrmAssignmentHistory(Base, UUIDPrimaryKeyMixin):
    """
    Append-only audit log of Lead ownership assignments and reallocations.
    """

    __tablename__ = "crm_assignment_history"

    lead_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("crm_leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    previous_owner_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    new_owner_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    assignment_method: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        doc="e.g. round_robin, state_priority, manual, admin_reassignment, personal_lead, import",
    )
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("crm_import_batches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False, index=True
    )

    # Relationships
    lead: Mapped[CrmLead] = relationship("CrmLead", back_populates="assignment_history")
    previous_owner = relationship("User", foreign_keys=[previous_owner_id])
    new_owner = relationship("User", foreign_keys=[new_owner_id])
    assigner = relationship("User", foreign_keys=[assigned_by])


class CrmActivity(Base, UUIDPrimaryKeyMixin):
    """
    Timeline of CRM activities and prospect touchpoints.
    """

    __tablename__ = "crm_activities"

    lead_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("crm_leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    activity_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        doc="call, email, meeting, note, whatsapp, task, other",
    )
    subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(100), nullable=True)
    performed_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    # Relationships
    lead: Mapped[CrmLead] = relationship("CrmLead", back_populates="activities")
    performer = relationship("User", foreign_keys=[performed_by])


class CrmFollowUp(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Scheduled CRM Follow-Up commitment.

    Distinct from legacy follow_ups telecalling table.
    """

    __tablename__ = "crm_follow_ups"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'completed', 'cancelled')", name="ck_crm_follow_up_status"),
        Index("ix_crm_follow_ups_due_at", "due_at"),
        Index("ix_crm_follow_ups_status", "status"),
        Index("ix_crm_follow_ups_task_id", "task_id"),
    )

    lead_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("crm_leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    follow_up_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="call", doc="call, meeting, demo, whatsapp, email"
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")  # pending, completed, cancelled
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Relationships
    lead: Mapped[CrmLead] = relationship("CrmLead", back_populates="follow_ups")
    assignee = relationship("User", foreign_keys=[assigned_to])
    creator = relationship("User", foreign_keys=[created_by])
    task = relationship("Task", foreign_keys=[task_id])


class CrmStageHistory(Base, UUIDPrimaryKeyMixin):
    """
    Audit log of Lead pipeline stage transitions.
    """

    __tablename__ = "crm_stage_history"

    lead_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("crm_leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_stage_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("crm_pipeline_stages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    to_stage_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("crm_pipeline_stages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    changed_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False, index=True
    )

    # Relationships
    lead: Mapped[CrmLead] = relationship("CrmLead", back_populates="stage_history")
    from_stage = relationship("CrmPipelineStage", foreign_keys=[from_stage_id])
    to_stage = relationship("CrmPipelineStage", foreign_keys=[to_stage_id])
    changer = relationship("User", foreign_keys=[changed_by])


class CrmImportBatch(Base, UUIDPrimaryKeyMixin):
    """
    Batch tracking for lead CSV and external imports.
    """

    __tablename__ = "crm_import_batches"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'processing', 'completed', 'failed')",
            name="ck_crm_import_batch_status",
        ),
    )

    batch_name: Mapped[str] = mapped_column(String(200), nullable=False)
    import_source: Mapped[str] = mapped_column(String(100), nullable=False, default="csv")
    selected_pipeline_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("crm_pipelines.id", ondelete="SET NULL"), nullable=True, index=True
    )
    initiated_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="pending",
        index=True,
        doc="pending, processing, completed, failed",
    )
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    success_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sanitized_error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    pipeline = relationship("CrmPipeline", foreign_keys=[selected_pipeline_id])
    initiator = relationship("User", foreign_keys=[initiated_by])


class CrmAssignmentConfig(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Future Lead Distribution Engine Configuration.

    Stores prioritization rules (e.g. state-priority, round-robin pools, campaign attribution).
    """

    __tablename__ = "crm_assignment_configs"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    rule_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        doc="e.g. state_priority, round_robin, campaign",
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    configuration: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class CrmRoundRobinCursor(Base, UUIDPrimaryKeyMixin):
    """
    Concurrency-Safe Cursor for Round-Robin Distribution Pools.

    Maintains current pointer to the last assigned salesperson per distribution pool
    (e.g., global default, state-specific, or campaign-specific).
    """

    __tablename__ = "crm_round_robin_cursors"

    pool_key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    last_assigned_user_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    last_assigned_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    last_assigned_user = relationship("User", foreign_keys=[last_assigned_user_id])


class CrmSalespersonConfig(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Salesperson Lead Assignment Configuration.

    Configures eligibility, priority, capacity, and active status for an existing ERP User
    to receive automatically assigned CRM leads without modifying the user record itself.
    """

    __tablename__ = "crm_salesperson_configs"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_crm_salesperson_config_user"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    is_eligible: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    priority: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    max_lead_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    user: Mapped[User] = relationship("User", foreign_keys=[user_id])
    territories: Mapped[list[CrmSalespersonTerritory]] = relationship(
        "CrmSalespersonTerritory",
        back_populates="salesperson_config",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<CrmSalespersonConfig user_id={self.user_id} is_eligible={self.is_eligible} priority={self.priority}>"


class CrmSalespersonTerritory(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    State/Territory coverage mapping for a Salesperson.

    Maps a salesperson's configuration to one or more geographic states from the
    existing `states` master table.
    """

    __tablename__ = "crm_salesperson_territories"
    __table_args__ = (
        UniqueConstraint("salesperson_config_id", "state_id", name="uq_crm_salesperson_territory"),
    )

    salesperson_config_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("crm_salesperson_configs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    state_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("states.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Relationships
    salesperson_config: Mapped[CrmSalespersonConfig] = relationship(
        "CrmSalespersonConfig", back_populates="territories"
    )
    state: Mapped[State] = relationship("State", foreign_keys=[state_id])

    def __repr__(self) -> str:
        return f"<CrmSalespersonTerritory config_id={self.salesperson_config_id} state_id={self.state_id}>"


class CrmLeadProduct(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Lead-Product interest association.

    Tracks products of interest for a CRM lead prior to or alongside
    formal sales quotations.
    """

    __tablename__ = "crm_lead_products"
    __table_args__ = (
        UniqueConstraint("lead_id", "product_id", name="uq_crm_lead_product"),
    )

    lead_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("crm_leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    lead: Mapped[CrmLead] = relationship("CrmLead", back_populates="associated_products")
    product: Mapped[Product] = relationship("Product", foreign_keys=[product_id])
    creator: Mapped[User | None] = relationship("User", foreign_keys=[created_by])


class CrmSalesQuotation(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    """
    Sales Quotation Header.

    Represents a formal commercial proposal issued to a lead.
    Supports versioning, snapshotting, and multiple quotations per lead.
    """

    __tablename__ = "crm_sales_quotations"
    __table_args__ = (
        Index("ix_crm_sales_quotations_lead_status", "lead_id", "status"),
    )

    quotation_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    lead_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("crm_leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="draft", nullable=False, index=True)
    quotation_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="INR", nullable=False)

    # Immutable contact/company snapshot
    customer_name_snapshot: Mapped[str] = mapped_column(String(255), nullable=False)
    customer_phone_snapshot: Mapped[str | None] = mapped_column(String(50), nullable=True)
    customer_email_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    company_name_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Commercial Totals (Persisted using Decimal/Numeric, strictly rounded)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    discount_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    tax_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)

    # Commercial Terms
    payment_terms: Mapped[str | None] = mapped_column(String(255), nullable=True)
    delivery_terms: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    terms_and_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit & User attribution
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    lead: Mapped[CrmLead] = relationship("CrmLead", back_populates="quotations")
    company: Mapped[Company | None] = relationship("Company", foreign_keys=[company_id])
    items: Mapped[list[CrmQuotationItem]] = relationship(
        "CrmQuotationItem",
        back_populates="quotation",
        cascade="all, delete-orphan",
        order_by="CrmQuotationItem.position",
        lazy="selectin",
    )
    revisions: Mapped[list[CrmQuotationVersion]] = relationship(
        "CrmQuotationVersion",
        back_populates="quotation",
        cascade="all, delete-orphan",
        order_by="CrmQuotationVersion.version.desc()",
        lazy="selectin",
    )


class CrmQuotationItem(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Line item for a CRM Sales Quotation.

    Stores immutable snapshots of Product Master details along with
    manually confirmed commercial inputs and decimal-safe line totals.
    """

    __tablename__ = "crm_quotation_items"

    quotation_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("crm_sales_quotations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    # Product Master Snapshot
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    specification: Mapped[str | None] = mapped_column(Text, nullable=True)
    uom: Mapped[str] = mapped_column(String(50), default="Nos", nullable=False)

    # Optional Selected Content
    include_images: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    selected_image_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    include_specifications: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    demo_link: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Commercial Inputs (Explicitly confirmed, no silent defaults)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("1.000"), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    unit_discount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)

    # Calculated Line Totals
    taxable_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)

    # Relationships
    quotation: Mapped[CrmSalesQuotation] = relationship("CrmSalesQuotation", back_populates="items")
    product: Mapped[Product] = relationship("Product", foreign_keys=[product_id])


class CrmQuotationVersion(Base, UUIDPrimaryKeyMixin):
    """
    Immutable Revision Snapshot for a CRM Sales Quotation.

    Whenever a quotation revision is finalized or incremented,
    a complete historical snapshot is archived here to prevent
    historical revision drift.
    """

    __tablename__ = "crm_quotation_versions"

    quotation_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("crm_sales_quotations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    revision_notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    # Relationships
    quotation: Mapped[CrmSalesQuotation] = relationship("CrmSalesQuotation", back_populates="revisions")

