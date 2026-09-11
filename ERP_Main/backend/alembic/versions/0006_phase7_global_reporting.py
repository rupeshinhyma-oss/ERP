"""phase7 global reporting read model (global_buyer_projections, projection_checkpoints, report_export_jobs)

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-08

Phase 7: adds the global read model -- one real projection
(`global_buyer_projections`, built from Phase 6's `buyer.created`
events), projection sync-health bookkeeping (`projection_checkpoints`),
and asynchronous report export tracking (`report_export_jobs`). Purely
additive -- does not alter, rename, or drop any column on any table
created by 0001-0005. No foreign key here ever points outside
ERP_Main's own database; `report_export_jobs.requested_by` is
deliberately NOT a foreign key (either a PlatformAdmin or a GlobalUser
may request an export, mirroring `platform_role_assignments.assigned_by`'s
own un-FK'd pattern from Phase 5).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _guid():
    """Return a UUID column type: native Postgres UUID, or CHAR(36) elsewhere."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.UUID(as_uuid=True)
    return sa.CHAR(36)


def upgrade() -> None:
    """Create global_buyer_projections, projection_checkpoints, report_export_jobs."""
    guid = _guid()

    op.create_table(
        "global_buyer_projections",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("source_erp_id", guid, nullable=False),
        sa.Column("source_entity_type", sa.String(length=100), nullable=False, server_default="buyer"),
        sa.Column("source_entity_id", guid, nullable=False),
        sa.Column("company_name", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=True),
        sa.Column("last_event_id", guid, nullable=False),
        sa.Column("last_event_occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["source_erp_id"], ["erp_instances.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "source_erp_id", "source_entity_type", "source_entity_id", name="uq_global_buyer_projection_source"
        ),
    )
    op.create_index("ix_global_buyer_projections_source_erp_id", "global_buyer_projections", ["source_erp_id"])
    op.create_index("ix_global_buyer_projections_source_entity_id", "global_buyer_projections", ["source_entity_id"])
    op.create_index("ix_global_buyer_projections_company_name", "global_buyer_projections", ["company_name"])

    op.create_table(
        "projection_checkpoints",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("projection_type", sa.String(length=100), nullable=False),
        sa.Column("last_processed_inbox_event_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_event_id", guid, nullable=True),
        sa.Column("last_processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("events_processed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("projection_type", name="uq_projection_checkpoint_type"),
    )
    op.create_index("ix_projection_checkpoints_projection_type", "projection_checkpoints", ["projection_type"])

    op.create_table(
        "report_export_jobs",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("requested_by", guid, nullable=False),
        sa.Column("report_type", sa.String(length=100), nullable=False),
        sa.Column("export_format", sa.String(length=10), nullable=False),
        sa.Column("filters_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column(
            "status",
            sa.Enum(
                "PENDING", "RUNNING", "COMPLETED", "FAILED", name="export_job_status", native_enum=False, length=20
            ),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("row_count", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_report_export_jobs_requested_by", "report_export_jobs", ["requested_by"])
    op.create_index("ix_report_export_jobs_status", "report_export_jobs", ["status"])


def downgrade() -> None:
    """Drop every Phase 7 table, in FK-safe reverse order. Leaves all Phase 2-6 tables completely untouched."""
    op.drop_index("ix_report_export_jobs_status", table_name="report_export_jobs")
    op.drop_index("ix_report_export_jobs_requested_by", table_name="report_export_jobs")
    op.drop_table("report_export_jobs")

    op.drop_index("ix_projection_checkpoints_projection_type", table_name="projection_checkpoints")
    op.drop_table("projection_checkpoints")

    op.drop_index("ix_global_buyer_projections_company_name", table_name="global_buyer_projections")
    op.drop_index("ix_global_buyer_projections_source_entity_id", table_name="global_buyer_projections")
    op.drop_index("ix_global_buyer_projections_source_erp_id", table_name="global_buyer_projections")
    op.drop_table("global_buyer_projections")
