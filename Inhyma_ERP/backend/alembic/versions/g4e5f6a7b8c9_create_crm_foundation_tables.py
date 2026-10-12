"""create_crm_foundation_tables

Revision ID: g4e5f6a7b8c9
Revises: f3d4e5f6a7b2
Create Date: 2026-10-12 14:15:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'g4e5f6a7b8c9'
down_revision = 'f3d4e5f6a7b2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create persistent tables for the new Inhyma CRM & Lead Management foundation."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_tables = insp.get_table_names()

    # 1. crm_pipelines
    if "crm_pipelines" not in existing_tables:
        op.create_table(
            "crm_pipelines",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("name", sa.String(150), nullable=False, unique=True, index=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_default", sa.Boolean(), server_default=sa.text("false"), nullable=False, index=True),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False, index=True),
            sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        )

    # 2. crm_pipeline_stages
    if "crm_pipeline_stages" not in existing_tables:
        op.create_table(
            "crm_pipeline_stages",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("pipeline_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("crm_pipelines.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("stage_order", sa.Integer(), server_default="0", nullable=False),
            sa.Column("stage_type", sa.String(20), server_default="open", nullable=False),
            sa.Column("is_initial", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.UniqueConstraint("pipeline_id", "stage_order", name="uq_crm_pipeline_stage_order"),
            sa.UniqueConstraint("pipeline_id", "name", name="uq_crm_pipeline_stage_name"),
            sa.CheckConstraint("stage_type IN ('open', 'won', 'lost')", name="ck_crm_pipeline_stage_type"),
        )

    # 3. crm_import_batches
    if "crm_import_batches" not in existing_tables:
        op.create_table(
            "crm_import_batches",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("batch_name", sa.String(200), nullable=False),
            sa.Column("import_source", sa.String(100), server_default="csv", nullable=False),
            sa.Column("selected_pipeline_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("crm_pipelines.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("initiated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("status", sa.String(50), server_default="pending", nullable=False, index=True),
            sa.Column("total_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("success_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("failed_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("skipped_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("sanitized_error_summary", sa.Text(), nullable=True),
        )

    # 4. crm_leads
    if "crm_leads" not in existing_tables:
        op.create_table(
            "crm_leads",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("lead_code", sa.String(50), nullable=False, unique=True, index=True),
            sa.Column("name", sa.String(200), nullable=False, index=True),
            sa.Column("original_phone", sa.String(50), nullable=False),
            sa.Column("normalized_phone", sa.String(50), nullable=False, index=True),
            sa.Column("email", sa.String(150), nullable=True, index=True),
            sa.Column("company_name", sa.String(200), nullable=True, index=True),
            sa.Column("campaign", sa.String(150), nullable=True, index=True),
            sa.Column("source_type", sa.String(50), server_default="company_campaign", nullable=False, index=True),
            sa.Column("source_detail", sa.String(255), nullable=True),
            sa.Column("external_source_system", sa.String(100), nullable=True),
            sa.Column("external_record_id", sa.String(150), nullable=True),
            sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("assigned_to", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("pipeline_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("crm_pipelines.id", ondelete="RESTRICT"), nullable=True, index=True),
            sa.Column("stage_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("crm_pipeline_stages.id", ondelete="RESTRICT"), nullable=True, index=True),
            sa.Column("status", sa.String(50), server_default="new", nullable=False, index=True),
            sa.Column("priority", sa.String(20), server_default="medium", nullable=False),
            sa.Column("next_follow_up_at", sa.DateTime(timezone=True), nullable=True, index=True),
            sa.Column("last_contacted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("won_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("lost_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("lost_reason", sa.Text(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("custom_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False, index=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.UniqueConstraint("external_source_system", "external_record_id", name="uq_crm_leads_external_source_record"),
        )
        op.create_index("ix_crm_leads_pipeline_stage", "crm_leads", ["pipeline_id", "stage_id"])

    # 5. crm_assignment_history
    if "crm_assignment_history" not in existing_tables:
        op.create_table(
            "crm_assignment_history",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("lead_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("crm_leads.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("previous_owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("new_owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("assignment_method", sa.String(50), nullable=False, index=True),
            sa.Column("assigned_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("batch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("crm_import_batches.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False, index=True),
        )

    # 6. crm_activities
    if "crm_activities" not in existing_tables:
        op.create_table(
            "crm_activities",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("lead_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("crm_leads.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("activity_type", sa.String(50), nullable=False, index=True),
            sa.Column("subject", sa.String(255), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("outcome", sa.String(100), nullable=True),
            sa.Column("performed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("activity_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False, index=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )

    # 7. crm_follow_ups
    if "crm_follow_ups" not in existing_tables:
        op.create_table(
            "crm_follow_ups",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("lead_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("crm_leads.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("assigned_to", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("due_at", sa.DateTime(timezone=True), nullable=False, index=True),
            sa.Column("follow_up_type", sa.String(50), server_default="call", nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("status", sa.String(20), server_default="pending", nullable=False, index=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.CheckConstraint("status IN ('pending', 'completed', 'cancelled')", name="ck_crm_follow_up_status"),
        )

    # 8. crm_stage_history
    if "crm_stage_history" not in existing_tables:
        op.create_table(
            "crm_stage_history",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("lead_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("crm_leads.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("from_stage_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("crm_pipeline_stages.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("to_stage_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("crm_pipeline_stages.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("changed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False, index=True),
        )

    # 9. crm_assignment_configs & crm_round_robin_cursors
    if "crm_assignment_configs" not in existing_tables:
        op.create_table(
            "crm_assignment_configs",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("rule_type", sa.String(50), nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("priority", sa.Integer(), server_default="0", nullable=False),
            sa.Column("configuration", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )

    if "crm_round_robin_cursors" not in existing_tables:
        op.create_table(
            "crm_round_robin_cursors",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("pool_key", sa.String(100), unique=True, nullable=False, index=True),
            sa.Column("last_assigned_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("last_assigned_index", sa.Integer(), server_default="0", nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )


def downgrade() -> None:
    """Drop CRM foundation tables in reverse dependency order."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_tables = insp.get_table_names()

    tables_to_drop = [
        "crm_round_robin_cursors",
        "crm_assignment_configs",
        "crm_stage_history",
        "crm_follow_ups",
        "crm_activities",
        "crm_assignment_history",
        "crm_leads",
        "crm_import_batches",
        "crm_pipeline_stages",
        "crm_pipelines",
    ]

    for tbl in tables_to_drop:
        if tbl in existing_tables:
            op.drop_table(tbl)
