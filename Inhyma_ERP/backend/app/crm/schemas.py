"""
CRM Pydantic Schemas.

Contracts for CRM Pipelines and Stages setup and management.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

from app.core.exceptions import BadRequestException

VALID_STAGE_TYPES = {"open", "won", "lost"}


def _strip_str(val: Any) -> str | None:
    if val is None:
        return None
    if isinstance(val, str):
        cleaned = val.strip()
        return cleaned if cleaned else None
    return str(val).strip()


class CrmStageCreate(BaseModel):
    """Payload to create a stage in a pipeline."""

    name: str = Field(..., min_length=1, max_length=100)
    stage_order: int = Field(default=0, ge=0)
    stage_type: str = Field(default="open")
    is_initial: bool = False
    is_active: bool = True

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, v: Any) -> str:
        s = _strip_str(v)
        if not s:
            raise ValueError("Stage name is required and cannot be blank.")
        if len(s) > 100:
            raise ValueError("Stage name cannot exceed 100 characters.")
        return s

    @field_validator("stage_type")
    @classmethod
    def _validate_stage_type(cls, v: str) -> str:
        t = v.strip().lower()
        if t not in VALID_STAGE_TYPES:
            raise ValueError(f"stage_type must be one of: {', '.join(sorted(VALID_STAGE_TYPES))}")
        return t


class CrmStageUpdate(BaseModel):
    """Payload to update an existing stage."""

    name: str | None = Field(default=None, max_length=100)
    stage_order: int | None = Field(default=None, ge=0)
    stage_type: str | None = None
    is_initial: bool | None = None
    is_active: bool | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, v: Any) -> str | None:
        if v is None:
            return None
        s = _strip_str(v)
        if not s:
            raise ValueError("Stage name cannot be empty.")
        if len(s) > 100:
            raise ValueError("Stage name cannot exceed 100 characters.")
        return s

    @field_validator("stage_type")
    @classmethod
    def _validate_stage_type(cls, v: str | None) -> str | None:
        if v is None:
            return None
        t = v.strip().lower()
        if t not in VALID_STAGE_TYPES:
            raise ValueError(f"stage_type must be one of: {', '.join(sorted(VALID_STAGE_TYPES))}")
        return t


class CrmStageReorderItem(BaseModel):
    """Single stage order entry."""

    id: uuid.UUID
    stage_order: int = Field(..., ge=0)


class CrmStageReorderRequest(BaseModel):
    """Payload to reorder stages within a pipeline."""

    stages: list[CrmStageReorderItem] = Field(..., min_length=1)


class CrmStageRead(BaseModel):
    """Serialized pipeline stage."""

    id: uuid.UUID
    pipeline_id: uuid.UUID
    name: str
    stage_order: int
    stage_type: str
    is_initial: bool
    is_active: bool
    lead_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CrmPipelineCreate(BaseModel):
    """Payload to create a new CRM pipeline."""

    name: str = Field(..., min_length=1, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    is_default: bool = False
    is_active: bool = True
    stages: list[CrmStageCreate] | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, v: Any) -> str:
        s = _strip_str(v)
        if not s:
            raise ValueError("Pipeline name is required and cannot be blank.")
        if len(s) > 150:
            raise ValueError("Pipeline name cannot exceed 150 characters.")
        return s

    @field_validator("description", mode="before")
    @classmethod
    def _validate_desc(cls, v: Any) -> str | None:
        return _strip_str(v)


class CrmPipelineUpdate(BaseModel):
    """Payload to update pipeline attributes."""

    name: str | None = Field(default=None, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    is_default: bool | None = None
    is_active: bool | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, v: Any) -> str | None:
        if v is None:
            return None
        s = _strip_str(v)
        if not s:
            raise ValueError("Pipeline name cannot be empty.")
        if len(s) > 150:
            raise ValueError("Pipeline name cannot exceed 150 characters.")
        return s

    @field_validator("description", mode="before")
    @classmethod
    def _validate_desc(cls, v: Any) -> str | None:
        return _strip_str(v)


class CrmPipelineListItemRead(BaseModel):
    """Pipeline item for list views."""

    id: uuid.UUID
    name: str
    description: str | None = None
    is_default: bool
    is_active: bool
    stage_count: int = 0
    lead_count: int = 0
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CrmPipelineDetailRead(BaseModel):
    """Complete pipeline detail with ordered stages."""

    id: uuid.UUID
    name: str
    description: str | None = None
    is_default: bool
    is_active: bool
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    stages: list[CrmStageRead] = []

    model_config = ConfigDict(from_attributes=True)


# -----------------------------------------------------------------------------
# Salesperson Distribution Schemas
# -----------------------------------------------------------------------------


class SalespersonTerritoryRead(BaseModel):
    """Territory assignment detail for a salesperson."""

    id: uuid.UUID
    state_id: uuid.UUID
    state_name: str
    state_code: str | None = None

    model_config = ConfigDict(from_attributes=True)


class SalespersonDistributionItem(BaseModel):
    """Salesperson distribution record."""

    user_id: uuid.UUID
    username: str
    display_name: str | None = None
    employee_code: str | None = None
    email: str | None = None
    is_active_user: bool
    user_status: str
    department: str | None = None

    # Distribution configuration
    is_eligible: bool = False
    priority: int = 1
    max_lead_capacity: int | None = None
    is_active_config: bool = True
    notes: str | None = None
    territories: list[SalespersonTerritoryRead] = []

    # Lead metrics (honest empty/zero states if no leads)
    active_lead_count: int = 0
    total_assigned_lead_count: int = 0
    remaining_capacity: int | None = None
    ineligibility_reasons: list[str] = []
    last_assigned_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class SalespersonDistributionUpdate(BaseModel):
    """Payload to update an individual salesperson's distribution configuration."""

    is_eligible: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=1000)
    max_lead_capacity: int | None = Field(default=None, ge=0)
    is_active: bool | None = None
    notes: str | None = None
    territory_state_ids: list[uuid.UUID] | None = None

    @field_validator("notes", mode="before")
    @classmethod
    def _validate_notes(cls, v: Any) -> str | None:
        return _strip_str(v)


class SalespersonBulkEligibilityUpdate(BaseModel):
    """Payload for confirmed bulk update of salesperson assignment eligibility."""

    user_ids: list[uuid.UUID] = Field(..., min_length=1)
    is_eligible: bool


# -----------------------------------------------------------------------------
# CRM CSV Lead Import Schemas
# -----------------------------------------------------------------------------


class CrmImportRowPreview(BaseModel):
    """Row-level preview and validation outcome for CSV lead import."""

    row_number: int
    name: str
    original_phone: str
    normalized_phone: str | None = None
    campaign: str
    priority: str | None = None
    status: str  # VALID, CRM_DUPLICATE, FILE_DUPLICATE, INVALID, CONFLICT_IN_FILE
    validation_message: str
    is_valid_candidate: bool
    matched_lead_code: str | None = None
    company: str | None = None
    company_id: uuid.UUID | None = None
    matched_company_name: str | None = None
    company_action: str | None = None  # "EXISTING", "NEW", "AMBIGUOUS", "NONE"
    company_resolution_note: str | None = None


class CrmImportPreviewResponse(BaseModel):
    """Summary and row-by-row preview of uploaded CSV lead data."""

    total_rows: int
    valid_candidate_count: int
    duplicate_crm_count: int
    duplicate_file_count: int
    invalid_count: int
    conflict_count: int
    pipeline_id: uuid.UUID
    pipeline_name: str
    initial_stage_id: uuid.UUID
    initial_stage_name: str
    rows: list[CrmImportRowPreview]
    can_import: bool


class CrmImportConfirmResponse(BaseModel):
    """Result of confirmed CRM lead import execution."""

    batch_id: uuid.UUID
    batch_name: str
    status: str
    display_status: str = "Success"
    total_rows: int
    success_count: int
    duplicate_skipped_count: int
    failed_count: int
    pipeline_id: uuid.UUID
    pipeline_name: str
    sanitized_error_summary: str | None = None
    row_results: list[CrmImportRowPreview] = []
    assigned_count: int = 0
    unassigned_count: int = 0


class CrmImportBatchRead(BaseModel):
    """CRM Lead import batch record."""

    id: uuid.UUID
    batch_name: str
    import_source: str
    selected_pipeline_id: uuid.UUID | None = None
    pipeline_name: str | None = None
    initiated_by: uuid.UUID | None = None
    initiator_name: str | None = None
    status: str
    display_status: str = "Success"
    total_count: int
    success_count: int
    failed_count: int
    skipped_count: int
    assigned_count: int | None = None
    unassigned_count: int | None = None
    created_at: datetime
    completed_at: datetime | None = None
    sanitized_error_summary: str | None = None

    model_config = ConfigDict(from_attributes=True)


# -----------------------------------------------------------------------------
# CRM Lead Visibility & Assignment History Schemas
# -----------------------------------------------------------------------------


class CrmFollowUpSummary(BaseModel):
    """Summary of upcoming or earliest pending follow-up commitment."""

    id: uuid.UUID
    due_at: datetime
    follow_up_type: str
    priority: str = "medium"
    notes: str | None = None
    assigned_to: uuid.UUID | None = None
    assignee_name: str | None = None
    is_overdue: bool = False

    model_config = ConfigDict(from_attributes=True)


class CrmLeadListItem(BaseModel):
    """CRM Lead database record with ownership and assignment visibility."""

    id: uuid.UUID
    lead_code: str
    name: str
    original_phone: str
    normalized_phone: str | None = None
    email: str | None = None
    company_name: str | None = None
    company_id: uuid.UUID | None = None
    campaign: str | None = None
    source_type: str
    source_detail: str | None = None

    # Pipeline & Stage
    pipeline_id: uuid.UUID | None = None
    pipeline_name: str | None = None
    stage_id: uuid.UUID | None = None
    stage_name: str | None = None
    stage_type: str | None = None

    # Ownership & Status
    created_by: uuid.UUID | None = None
    assigned_to: uuid.UUID | None = None
    assigned_salesperson_name: str | None = None
    assigned_salesperson_email: str | None = None
    status: str
    priority: str

    # Company Master Details
    company_city: str | None = None
    company_gstin: str | None = None

    # Next Pending Follow-up
    next_pending_follow_up: CrmFollowUpSummary | None = None

    # Assignment Visibility
    assignment_status: str  # "assigned" or "unassigned"
    unassigned_reason: str | None = None

    # Lifecycle & Follow-up State
    last_contacted_at: datetime | None = None
    next_follow_up_at: datetime | None = None
    won_at: datetime | None = None
    lost_at: datetime | None = None
    lost_reason: str | None = None

    created_at: datetime
    updated_at: datetime | None = None
    custom_fields: dict[str, Any] | None = None

    model_config = ConfigDict(from_attributes=True)

    @property
    def contact_name(self) -> str:
        return self.name


class CrmLeadPaginationResponse(BaseModel):
    """Paginated list of CRM leads."""

    items: list[CrmLeadListItem]
    total: int
    page: int
    page_size: int
    total_pages: int


VALID_LEAD_PRIORITIES = {"low", "medium", "high", "urgent"}


class CrmLeadCreate(BaseModel):
    """Payload to manually create a new CRM lead."""

    name: str = Field(..., min_length=1, max_length=200, validation_alias=AliasChoices("name", "contact_name"), description="Contact / prospect name")
    phone: str = Field(..., min_length=7, max_length=50, validation_alias=AliasChoices("phone", "original_phone", "number"), description="Contact phone number (will be normalized)")
    email: str | None = Field(default=None, max_length=150)
    company_name: str | None = Field(default=None, max_length=200)
    company_id: uuid.UUID | None = None
    campaign: str | None = Field(default=None, max_length=150)
    source_type: str | None = Field(default=None, max_length=50)
    source_detail: str | None = Field(default=None, max_length=255)
    pipeline_id: uuid.UUID | None = None
    stage_id: uuid.UUID | None = None
    priority: str = Field(default="medium", description="Lead priority: low, medium, high, urgent")
    assigned_to: uuid.UUID | None = None
    notes: str | None = None
    custom_fields: dict[str, Any] | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, v: Any) -> str:
        s = _strip_str(v)
        if not s:
            raise ValueError("Contact name is required and cannot be blank.")
        if len(s) > 200:
            raise ValueError("Contact name cannot exceed 200 characters.")
        return s

    @field_validator("phone", mode="before")
    @classmethod
    def _validate_phone(cls, v: Any) -> str:
        s = _strip_str(v)
        if not s:
            raise ValueError("Phone number is required.")
        return s

    @field_validator("priority", mode="before")
    @classmethod
    def _validate_priority(cls, v: Any) -> str:
        if v is None or (isinstance(v, str) and not v.strip()):
            return "medium"
        p = str(v).strip().lower()
        if p not in VALID_LEAD_PRIORITIES:
            raise ValueError(f"Priority must be one of: {', '.join(sorted(VALID_LEAD_PRIORITIES))}")
        return p


class CrmLeadUpdate(BaseModel):
    """Payload to update an existing CRM lead."""

    name: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=150)
    company_name: str | None = Field(default=None, max_length=200)
    company_id: uuid.UUID | None = None
    campaign: str | None = Field(default=None, max_length=150)
    source_type: str | None = Field(default=None, max_length=50)
    source_detail: str | None = Field(default=None, max_length=255)
    priority: str | None = Field(default=None, description="Updated priority: low, medium, high, urgent. Preserved if omitted.")
    notes: str | None = None
    custom_fields: dict[str, Any] | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, v: Any) -> str | None:
        if v is None:
            return None
        s = _strip_str(v)
        if not s:
            raise ValueError("Contact name cannot be empty.")
        if len(s) > 200:
            raise ValueError("Contact name cannot exceed 200 characters.")
        return s

    @field_validator("priority", mode="before")
    @classmethod
    def _validate_priority(cls, v: Any) -> str | None:
        if v is None:
            return None
        p = str(v).strip().lower()
        if not p:
            return None
        if p not in VALID_LEAD_PRIORITIES:
            raise ValueError(f"Priority must be one of: {', '.join(sorted(VALID_LEAD_PRIORITIES))}")
        return p



class CrmAssignmentHistoryItem(BaseModel):
    """Persisted lead ownership handoff audit record."""

    id: uuid.UUID
    lead_id: uuid.UUID
    lead_code: str | None = None
    lead_name: str | None = None
    previous_owner_id: uuid.UUID | None = None
    previous_owner_name: str | None = None
    new_owner_id: uuid.UUID | None = None
    new_owner_name: str | None = None
    assignment_method: str
    assigned_by: uuid.UUID | None = None
    assigned_by_name: str | None = None
    reason: str | None = None
    batch_id: uuid.UUID | None = None
    batch_name: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CrmAssignmentHistoryPaginationResponse(BaseModel):
    """Paginated list of CRM assignment history records."""

    items: list[CrmAssignmentHistoryItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class CrmLeadReassignRequest(BaseModel):
    """Payload to reassign a CRM lead to an eligible salesperson."""

    new_salesperson_id: uuid.UUID
    reason: str = Field(..., min_length=5, description="Mandatory reason for reassigning the lead (minimum 5 characters).")

    @field_validator("reason", mode="before")
    @classmethod
    def _validate_reason(cls, v: Any) -> str:
        s = _strip_str(v)
        if not s or len(s) < 5:
            raise ValueError("Reassignment reason is mandatory and must be at least 5 characters.")
        return s


# -----------------------------------------------------------------------------
# Phase 6: Activity Logging, Follow-Up, Stage Transition, & Timeline Schemas
# -----------------------------------------------------------------------------

VALID_ACTIVITY_TYPES = {
    "call",
    "meeting",
    "note",
    "email",
    "whatsapp",
    "task",
    "other",
    "stage_change",
    "reassignment",
    "assignment_changed",
    "import_touchpoint",
    "lead_created",
    "lead_updated",
    "company_changed",
    "campaign",
    "follow_up_created",
    "follow_up_completed",
    "follow_up_cancelled",
    "quotation_created",
    "quotation_updated",
    "quotation_status_change",
    "product_associated",
    "product_disassociated",
}

VALID_FOLLOW_UP_TYPES = {
    "call",
    "meeting",
    "demo",
    "whatsapp",
    "email",
    "task",
    "other",
}


class CrmActivityCreate(BaseModel):
    """Payload to log an activity/touchpoint on a lead."""

    activity_type: str = Field(..., description="Activity type: call, meeting, note, email, whatsapp, task, other")
    subject: str | None = Field(default=None, max_length=255)
    description: str | None = None
    outcome: str | None = Field(default=None, max_length=100)
    activity_at: datetime | None = None

    @field_validator("activity_type")
    @classmethod
    def _validate_activity_type(cls, v: str) -> str:
        t = v.strip().lower()
        if t not in VALID_ACTIVITY_TYPES:
            raise ValueError(f"activity_type must be one of: {', '.join(sorted(VALID_ACTIVITY_TYPES))}")
        return t


class CrmActivityRead(BaseModel):
    """Activity record response."""

    id: uuid.UUID
    lead_id: uuid.UUID
    activity_type: str
    subject: str | None = None
    description: str | None = None
    outcome: str | None = None
    performed_by: uuid.UUID | None = None
    performer_name: str | None = None
    performer_email: str | None = None
    activity_at: datetime
    created_at: datetime
    is_system_event: bool = False

    model_config = ConfigDict(from_attributes=True)


class CrmActivityPaginationResponse(BaseModel):
    """Paginated list of lead activities."""

    items: list[CrmActivityRead]
    total: int
    page: int
    page_size: int
    total_pages: int


class CrmStageHistoryRead(BaseModel):
    """Audit log item of lead pipeline stage transition."""

    id: uuid.UUID
    lead_id: uuid.UUID
    from_stage_id: uuid.UUID | None = None
    from_stage_name: str | None = None
    to_stage_id: uuid.UUID | None = None
    to_stage_name: str | None = None
    changed_by: uuid.UUID | None = None
    changed_by_name: str | None = None
    reason: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CrmStageHistoryListResponse(BaseModel):
    """List of stage transition history records."""

    items: list[CrmStageHistoryRead]
    total: int


class CrmFollowUpCreate(BaseModel):
    """Payload to schedule a CRM follow-up commitment."""

    due_at: datetime
    follow_up_type: str = Field(default="call", max_length=50)
    notes: str | None = None
    assigned_to: uuid.UUID | None = None

    @field_validator("follow_up_type")
    @classmethod
    def _validate_follow_up_type(cls, v: str) -> str:
        t = v.strip().lower()
        if t not in VALID_FOLLOW_UP_TYPES:
            raise ValueError(f"follow_up_type must be one of: {', '.join(sorted(VALID_FOLLOW_UP_TYPES))}")
        return t


class CrmFollowUpStatusUpdate(BaseModel):
    """Payload to complete or cancel a scheduled follow-up."""

    status: str = Field(..., description="'completed' or 'cancelled'")
    completion_notes: str | None = None
    outcome: str | None = Field(default=None, max_length=100)

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: str) -> str:
        s = v.strip().lower()
        if s not in {"completed", "cancelled"}:
            raise ValueError("status must be either 'completed' or 'cancelled'")
        return s


class CrmFollowUpRead(BaseModel):
    """CRM follow-up commitment record."""

    id: uuid.UUID
    lead_id: uuid.UUID
    lead_code: str | None = None
    lead_name: str | None = None
    lead_phone: str | None = None
    lead_company: str | None = None
    lead_priority: str | None = None
    lead_stage_name: str | None = None
    lead_pipeline_name: str | None = None
    assigned_to: uuid.UUID | None = None
    assignee_name: str | None = None
    assignee_email: str | None = None
    due_at: datetime
    follow_up_type: str
    notes: str | None = None
    status: str  # pending, completed, cancelled
    completed_at: datetime | None = None
    created_by: uuid.UUID | None = None
    creator_name: str | None = None
    created_at: datetime
    updated_at: datetime | None = None
    is_overdue: bool = False

    model_config = ConfigDict(from_attributes=True)


class CrmFollowUpPaginationResponse(BaseModel):
    """Paginated list of CRM follow-ups."""

    items: list[CrmFollowUpRead]
    total: int
    page: int
    page_size: int
    total_pages: int


class CrmLeadStageTransitionRequest(BaseModel):
    """Payload to move a lead to a new pipeline stage."""

    stage_id: uuid.UUID
    reason: str | None = None
    lost_reason: str | None = None


class CrmTimelineItem(BaseModel):
    """Single event in the unified chronological lead timeline."""

    id: uuid.UUID
    timeline_type: str  # activity, follow_up, stage_history, assignment_history
    title: str
    description: str | None = None
    timestamp: datetime
    actor_id: uuid.UUID | None = None
    actor_name: str | None = None
    actor_email: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class CrmTimelineResponse(BaseModel):
    """Chronological lead lifecycle timeline response."""

    lead_id: uuid.UUID
    lead_code: str
    lead_name: str
    items: list[CrmTimelineItem]
    total: int


# -----------------------------------------------------------------------------
# Phase 6, Step 3: Daily Work & Manager Team Oversight Schemas
# -----------------------------------------------------------------------------


class CrmDailyWorkSummary(BaseModel):
    """Real metric counts for a salesperson's daily work view."""

    salesperson_id: uuid.UUID
    salesperson_name: str
    overdue_follow_ups: int
    due_today_follow_ups: int
    upcoming_follow_ups: int
    active_leads: int


class CrmStageCountItem(BaseModel):
    """Lead count per pipeline stage for rep workload distribution."""

    stage_id: uuid.UUID
    stage_name: str
    stage_type: str | None = None
    count: int


class CrmRepOversightItem(BaseModel):
    """Rep-level operational oversight metrics."""

    salesperson_id: uuid.UUID
    salesperson_name: str
    salesperson_email: str | None = None
    active_lead_count: int
    overdue_follow_up_count: int
    due_today_follow_up_count: int
    month_won_count: int
    month_lost_count: int
    stage_distribution: list[CrmStageCountItem] = []


class CrmTeamOversightResponse(BaseModel):
    """Scoped team/department oversight summary for managers and admins."""

    scope_type: str  # "company_wide" or "team"
    department_id: uuid.UUID | None = None
    department_name: str | None = None
    reps: list[CrmRepOversightItem]
    total_active_leads: int
    total_overdue_follow_ups: int
    total_due_today_follow_ups: int
    total_month_won: int
    total_month_lost: int


# -----------------------------------------------------------------------------
# CRM Reports & Analytics Schemas
# -----------------------------------------------------------------------------


class CrmAnalyticsOverview(BaseModel):
    """Consolidated KPI overview for CRM analytics."""

    total_leads_in_range: int
    total_active_leads: int
    total_all_time_leads: int
    won_count: int
    lost_count: int
    closed_count: int
    conversion_rate: float | None = None
    win_rate_on_new: float | None = None
    assigned_count: int
    unassigned_count: int
    total_follow_ups: int
    overdue_follow_ups: int
    total_activities: int


class CrmPipelineDistributionItem(BaseModel):
    """Pipeline distribution with stage counts and outcomes."""

    pipeline_id: uuid.UUID
    pipeline_name: str
    lead_count: int
    won_count: int
    lost_count: int
    active_count: int
    stages: list[CrmStageCountItem] = []


class CrmCampaignPerformanceItem(BaseModel):
    """Campaign attribution metrics and conversion performance."""

    campaign: str
    total_leads: int
    won_leads: int
    lost_leads: int
    active_leads: int
    conversion_rate: float | None = None


class CrmSourceDistributionItem(BaseModel):
    """Lead volume and wins by source type."""

    source_type: str
    total_leads: int
    won_leads: int
    conversion_rate: float | None = None


class CrmRepPerformanceItem(BaseModel):
    """Sales representative performance and workload metrics."""

    salesperson_id: uuid.UUID
    salesperson_name: str
    salesperson_email: str | None = None
    assigned_leads: int
    active_leads: int
    new_leads_in_range: int
    won_count: int
    lost_count: int
    conversion_rate: float | None = None
    total_follow_ups: int
    overdue_follow_ups: int
    activities_count: int
    max_capacity: int | None = None


class CrmTimeTrendItem(BaseModel):
    """Daily or periodic lead volume and conversion trend point."""

    date: str
    new_leads: int
    won_leads: int
    lost_leads: int
    activities_count: int


class CrmAnalyticsResponse(BaseModel):
    """Complete response payload for CRM Reports & Analytics."""

    start_date: str
    end_date: str
    timezone: str = "Asia/Kolkata"
    role_type: str
    scope_type: str
    pipeline_id: uuid.UUID | None = None
    salesperson_id: uuid.UUID | None = None
    overview: CrmAnalyticsOverview
    pipelines: list[CrmPipelineDistributionItem] = []
    campaigns: list[CrmCampaignPerformanceItem] = []
    sources: list[CrmSourceDistributionItem] = []
    reps: list[CrmRepPerformanceItem] = []
    trends: list[CrmTimeTrendItem] = []


# -----------------------------------------------------------------------------
# CRM Sales Quotations & Lead Product Association Schemas
# -----------------------------------------------------------------------------


class CrmProductLookupItem(BaseModel):
    """Product catalog item formatted for CRM search and selection."""

    id: uuid.UUID
    product_code: str | None = None
    product_name: str
    specification: str | None = None
    description: str | None = None
    uom: str = "Nos"
    standard_price: float | None = None
    minimum_price: float | None = None
    gst_percent: float | None = None
    hsn_number: str | None = None
    images: list[str] = []
    status: str
    is_sellable: bool


class CrmProductLookupResponse(BaseModel):
    """Paginated or listed products for CRM search."""

    items: list[CrmProductLookupItem]
    total: int


class CrmLeadProductCreate(BaseModel):
    """Payload to associate a product with a lead."""

    product_id: uuid.UUID
    notes: str | None = None


class CrmLeadProductRead(BaseModel):
    """Associated product record for a lead."""

    id: uuid.UUID
    lead_id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    product_code: str | None = None
    specification: str | None = None
    uom: str = "Nos"
    selected_image_url: str | None = None
    notes: str | None = None
    created_at: datetime
    created_by: uuid.UUID | None = None

    model_config = ConfigDict(from_attributes=True)


class CrmLeadProductListResponse(BaseModel):
    """List of associated products for a lead."""

    items: list[CrmLeadProductRead]
    total: int


class CrmQuotationItemIn(BaseModel):
    """Line item input for a quotation."""

    product_id: uuid.UUID
    quantity: Decimal = Field(default=Decimal("1.000"), gt=0)
    unit_price: Decimal = Field(default=Decimal("0.00"), ge=0)
    unit_discount: Decimal = Field(default=Decimal("0.00"), ge=0)
    tax_rate: Decimal = Field(default=Decimal("0.00"), ge=0, le=100)
    include_images: bool = False
    selected_image_url: str | None = None
    include_specifications: bool = True
    demo_link: str | None = None
    uom: str | None = None

    @field_validator("demo_link")
    @classmethod
    def _validate_demo_link(cls, v: str | None) -> str | None:
        if v:
            clean = v.strip()
            if clean and not (clean.startswith("https://") or clean.startswith("http://")):
                raise ValueError("demo_link must be a valid HTTP/HTTPS URL")
            return clean or None
        return None

    @field_validator("unit_discount")
    @classmethod
    def _validate_discount(cls, v: Decimal, info) -> Decimal:
        price = info.data.get("unit_price")
        if price is not None and v > price:
            raise ValueError(f"unit_discount ({v}) cannot exceed unit_price ({price})")
        return v


class CrmQuotationItemRead(BaseModel):
    """Line item read model."""

    id: uuid.UUID
    quotation_id: uuid.UUID
    product_id: uuid.UUID
    position: int
    product_name: str
    product_code: str | None = None
    description: str | None = None
    specification: str | None = None
    uom: str
    include_images: bool
    selected_image_url: str | None = None
    include_specifications: bool
    demo_link: str | None = None
    quantity: float
    unit_price: float
    unit_discount: float
    tax_rate: float
    taxable_amount: float
    tax_amount: float
    total_amount: float

    model_config = ConfigDict(from_attributes=True)


class CrmQuotationVersionRead(BaseModel):
    """Historical revision snapshot read model."""

    id: uuid.UUID
    quotation_id: uuid.UUID
    version: int
    snapshot_data: dict[str, Any]
    revision_notes: str | None = None
    created_by: uuid.UUID | None = None
    created_by_name: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CrmSalesQuotationCreate(BaseModel):
    """Payload to create a new quotation for a lead."""

    valid_until: datetime | None = None
    currency: str = Field(default="INR", max_length=10)
    payment_terms: str | None = None
    delivery_terms: str | None = None
    notes: str | None = None
    terms_and_conditions: str | None = None
    items: list[CrmQuotationItemIn] = Field(..., min_length=1)


class CrmSalesQuotationUpdate(BaseModel):
    """Payload to update an existing quotation or create a new revision."""

    valid_until: datetime | None = None
    currency: str | None = None
    payment_terms: str | None = None
    delivery_terms: str | None = None
    notes: str | None = None
    terms_and_conditions: str | None = None
    items: list[CrmQuotationItemIn] | None = None
    revision_notes: str | None = None
    create_revision: bool = False


class CrmQuotationStatusUpdate(BaseModel):
    """Payload to change the status of a quotation."""

    status: str
    notes: str | None = None

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: str) -> str:
        s = v.strip().lower()
        if s not in {"draft", "sent", "accepted", "rejected", "revised", "cancelled"}:
            raise ValueError("status must be one of: draft, sent, accepted, rejected, revised, cancelled")
        return s


class CrmSalesQuotationRead(BaseModel):
    """Full Sales Quotation read model."""

    id: uuid.UUID
    quotation_number: str
    lead_id: uuid.UUID
    company_id: uuid.UUID | None = None
    version: int
    status: str
    quotation_date: datetime
    valid_until: datetime | None = None
    currency: str
    customer_name_snapshot: str
    customer_phone_snapshot: str | None = None
    customer_email_snapshot: str | None = None
    company_name_snapshot: str | None = None
    subtotal: float
    discount_total: float
    tax_total: float
    total_amount: float
    payment_terms: str | None = None
    delivery_terms: str | None = None
    notes: str | None = None
    terms_and_conditions: str | None = None
    created_by: uuid.UUID | None = None
    created_by_name: str | None = None
    created_at: datetime
    updated_at: datetime | None = None
    items: list[CrmQuotationItemRead] = []
    revisions: list[CrmQuotationVersionRead] = []

    model_config = ConfigDict(from_attributes=True)


class CrmSalesQuotationListResponse(BaseModel):
    """List of quotations for a lead."""

    items: list[CrmSalesQuotationRead]
    total: int





