"""create_hrms_attendance_tables

Creates hrms_attendance_policies and hrms_attendance tables.

Revision ID: f1a2b3c4d5e8
Revises: e1a2b3c4d5e7
Create Date: 2026-09-26 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e8"
down_revision: Union[str, None] = "e1a2b3c4d5e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1. hrms_attendance_policies
    if not insp.has_table("hrms_attendance_policies"):
        op.create_table(
            "hrms_attendance_policies",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("shift_start_time", sa.String(length=10), server_default="10:30", nullable=False),
            sa.Column("shift_end_time", sa.String(length=10), server_default="19:00", nullable=False),
            sa.Column("grace_period_minutes", sa.Integer(), server_default="15", nullable=False),
            sa.Column("half_day_threshold_minutes", sa.Integer(), server_default="60", nullable=False),
            sa.Column("geofence_radius_meters", sa.Float(), server_default="150.0", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_attendance_policies")),
        )

    # 2. hrms_attendance
    if not insp.has_table("hrms_attendance"):
        op.create_table(
            "hrms_attendance",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("employee_id", app.database.base.GUID(), nullable=False),
            sa.Column("attendance_date", sa.Date(), nullable=False),
            sa.Column("punch_in", sa.DateTime(timezone=True), nullable=True),
            sa.Column("punch_out", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(length=50), server_default="PRESENT", nullable=False),
            sa.Column("working_minutes", sa.Integer(), server_default="0", nullable=True),
            sa.Column("late_minutes", sa.Integer(), server_default="0", nullable=False),
            sa.Column("early_exit_minutes", sa.Integer(), server_default="0", nullable=False),
            sa.Column("office_location_id", app.database.base.GUID(), nullable=True),
            sa.Column("latitude", sa.Float(), nullable=True),
            sa.Column("longitude", sa.Float(), nullable=True),
            sa.Column("punch_in_distance", sa.Float(), nullable=True),
            sa.Column("punch_out_distance", sa.Float(), nullable=True),
            sa.Column("is_irregular", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            sa.Column("regularization_status", sa.String(length=50), server_default="NONE", nullable=False),
            sa.Column("regularization_reason", sa.Text(), nullable=True),
            sa.Column("regularization_note", sa.Text(), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["employee_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["office_location_id"], ["hrms_locations.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_attendance")),
            sa.UniqueConstraint("employee_id", "attendance_date", name="uq_hrms_attendance_employee_date"),
        )
        op.create_index(op.f("ix_hrms_attendance_employee_id"), "hrms_attendance", ["employee_id"], unique=False)
        op.create_index(op.f("ix_hrms_attendance_attendance_date"), "hrms_attendance", ["attendance_date"], unique=False)
        op.create_index(op.f("ix_hrms_attendance_status"), "hrms_attendance", ["status"], unique=False)
        op.create_index(op.f("ix_hrms_attendance_is_irregular"), "hrms_attendance", ["is_irregular"], unique=False)
        op.create_index(op.f("ix_hrms_attendance_regularization_status"), "hrms_attendance", ["regularization_status"], unique=False)


def downgrade() -> None:
    op.drop_table("hrms_attendance")
    op.drop_table("hrms_attendance_policies")
