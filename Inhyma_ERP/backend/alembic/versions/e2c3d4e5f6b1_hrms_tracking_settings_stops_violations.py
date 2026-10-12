"""create_hrms_tracking_settings_stops_violations

Revision ID: e2c3d4e5f6b1
Revises: d1c2d3e4f5b0
Create Date: 2026-10-09 16:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'e2c3d4e5f6b1'
down_revision = 'd1c2d3e4f5b0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create persistent tables for HRMS tracking settings, stationary stops, and geofence violations."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_tables = insp.get_table_names()

    # 1. hrms_tracking_settings
    if "hrms_tracking_settings" not in existing_tables:
        op.create_table(
            "hrms_tracking_settings",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("employee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True),
            sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
            sa.Column("detailed_stop_threshold_minutes", sa.Float(), server_default="5.0", nullable=False),
            sa.Column("stop_detection_radius_meters", sa.Float(), server_default="50.0", nullable=False),
            sa.Column("max_gps_accuracy_meters", sa.Float(), server_default="50.0", nullable=False),
            sa.Column("return_timer_seconds", sa.Integer(), server_default="300", nullable=True),
            sa.Column("is_unlimited_return", sa.Boolean(), server_default="false", nullable=False),
            sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        )
        # Ensure single org default row where employee_id IS NULL
        op.create_index(
            "uq_hrms_tracking_settings_org_default",
            "hrms_tracking_settings",
            [sa.text("(employee_id IS NULL)")],
            unique=True,
            postgresql_where=sa.text("employee_id IS NULL"),
        )
        # Ensure at most one row per employee where employee_id IS NOT NULL
        op.create_index(
            "uq_hrms_tracking_settings_employee",
            "hrms_tracking_settings",
            ["employee_id"],
            unique=True,
            postgresql_where=sa.text("employee_id IS NOT NULL"),
        )

    # 2. hrms_tracking_stops
    if "hrms_tracking_stops" not in existing_tables:
        op.create_table(
            "hrms_tracking_stops",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hrms_tracking_sessions.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("employee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("start_time", sa.DateTime(timezone=True), nullable=False, index=True),
            sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
            sa.Column("duration_minutes", sa.Float(), nullable=False),
            sa.Column("latitude", sa.Float(), nullable=False),
            sa.Column("longitude", sa.Float(), nullable=False),
            sa.Column("address", sa.String(500), nullable=True),
            sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
            sa.Column("start_point_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hrms_tracking_points.id", ondelete="SET NULL"), nullable=True),
            sa.Column("end_point_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hrms_tracking_points.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        )

    # 3. hrms_geofence_violations
    if "hrms_geofence_violations" not in existing_tables:
        op.create_table(
            "hrms_geofence_violations",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("employee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("location_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hrms_locations.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hrms_tracking_sessions.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("attendance_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hrms_attendance.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("exit_time", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expiry_time", sa.DateTime(timezone=True), nullable=True),
            sa.Column("return_time", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(50), server_default="ACTIVE_EXIT", nullable=False, index=True),
            sa.Column("distance_meters", sa.Float(), nullable=False),
            sa.Column("boundary_radius_meters", sa.Float(), nullable=False),
            sa.Column("last_latitude", sa.Float(), nullable=False),
            sa.Column("last_longitude", sa.Float(), nullable=False),
            sa.Column("notes", sa.String(500), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )


def downgrade() -> None:
    """Drop tables in reverse order."""
    op.drop_table("hrms_geofence_violations")
    op.drop_table("hrms_tracking_stops")
    op.drop_table("hrms_tracking_settings")
