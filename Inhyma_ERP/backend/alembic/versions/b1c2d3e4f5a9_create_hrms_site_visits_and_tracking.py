"""create_hrms_site_visits_and_tracking

Revision ID: b1c2d3e4f5a9
Revises: a0b1c2d3e4f5
Create Date: 2026-10-05 14:55:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'b1c2d3e4f5a9'
down_revision = 'a0b1c2d3e4f5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create persistent tables for site visits, live tracking sessions, and tracking points."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_tables = insp.get_table_names()

    # 1. hrms_site_visits
    if "hrms_site_visits" not in existing_tables:
        op.create_table(
            "hrms_site_visits",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("employee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("customer_name", sa.String(255), nullable=False, index=True),
            sa.Column("site_address", sa.Text(), nullable=False),
            sa.Column("visit_date", sa.Date(), nullable=False, index=True),
            sa.Column("planned_start_time", sa.String(20), nullable=False),
            sa.Column("planned_end_time", sa.String(20), nullable=False),
            sa.Column("status", sa.String(50), server_default="SCHEDULED", nullable=False, index=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("check_in_time", sa.DateTime(timezone=True), nullable=True),
            sa.Column("check_in_latitude", sa.Float(), nullable=True),
            sa.Column("check_in_longitude", sa.Float(), nullable=True),
            sa.Column("check_in_accuracy", sa.Float(), nullable=True),
            sa.Column("check_in_address", sa.String(500), nullable=True),
            sa.Column("check_out_time", sa.DateTime(timezone=True), nullable=True),
            sa.Column("check_out_latitude", sa.Float(), nullable=True),
            sa.Column("check_out_longitude", sa.Float(), nullable=True),
            sa.Column("check_out_accuracy", sa.Float(), nullable=True),
            sa.Column("check_out_address", sa.String(500), nullable=True),
            sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        )

    # 2. hrms_tracking_sessions
    if "hrms_tracking_sessions" not in existing_tables:
        op.create_table(
            "hrms_tracking_sessions",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("employee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("site_visit_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hrms_site_visits.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("tracking_date", sa.Date(), nullable=False, index=True),
            sa.Column("status", sa.String(50), server_default="ACTIVE", nullable=False, index=True),
            sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
            sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
            sa.Column("total_duration_minutes", sa.Integer(), nullable=True),
            sa.Column("approx_distance_km", sa.Float(), nullable=True),
            sa.Column("start_location", postgresql.JSON(astext_type=sa.Text()), nullable=True),
            sa.Column("end_location", postgresql.JSON(astext_type=sa.Text()), nullable=True),
            sa.Column("route_summary", postgresql.JSON(astext_type=sa.Text()), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        )

    # 3. hrms_tracking_points (Temporary)
    if "hrms_tracking_points" not in existing_tables:
        op.create_table(
            "hrms_tracking_points",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hrms_tracking_sessions.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("employee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("latitude", sa.Float(), nullable=False),
            sa.Column("longitude", sa.Float(), nullable=False),
            sa.Column("accuracy", sa.Float(), nullable=True),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, index=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )


def downgrade() -> None:
    """Drop tables in reverse order."""
    op.drop_table("hrms_tracking_points")
    op.drop_table("hrms_tracking_sessions")
    op.drop_table("hrms_site_visits")
