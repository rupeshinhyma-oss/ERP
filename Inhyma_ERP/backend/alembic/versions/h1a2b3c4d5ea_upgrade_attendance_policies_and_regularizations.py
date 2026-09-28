"""upgrade_attendance_policies_and_regularizations

Revision ID: h1a2b3c4d5ea
Revises: g1a2b3c4d5e9
Create Date: 2026-09-26 18:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "h1a2b3c4d5ea"
down_revision: Union[str, None] = "g1a2b3c4d5e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1. Update hrms_attendance_policies
    if insp.has_table("hrms_attendance_policies"):
        cols = {c["name"] for c in insp.get_columns("hrms_attendance_policies")}

        if "shift_name" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("shift_name", sa.String(length=100), server_default="General Shift", nullable=False),
            )
        if "weekly_off" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("weekly_off", sa.String(length=100), server_default="Sunday", nullable=False),
            )
        if "payroll_cycle" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("payroll_cycle", sa.String(length=100), server_default="1st-End of Month", nullable=False),
            )
        if "grace_end_time" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("grace_end_time", sa.String(length=10), server_default="10:45", nullable=False),
            )
        if "late_start_time" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("late_start_time", sa.String(length=10), server_default="10:46", nullable=False),
            )
        if "enable_grace" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("enable_grace", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            )
        if "enable_late_marks" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("enable_late_marks", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            )
        if "count_late_monthly" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("count_late_monthly", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            )
        if "monthly_late_limit" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("monthly_late_limit", sa.Integer(), server_default="3", nullable=False),
            )
        if "third_late_action" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("third_late_action", sa.String(length=50), server_default="Half Day", nullable=False),
            )
        if "enable_direct_half_day" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("enable_direct_half_day", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            )
        if "direct_half_day_time" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("direct_half_day_time", sa.String(length=10), server_default="11:31", nullable=False),
            )
        if "enable_early_exit" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("enable_early_exit", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            )
        if "early_exit_buffer_minutes" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("early_exit_buffer_minutes", sa.Integer(), server_default="15", nullable=False),
            )
        if "mark_early_exit" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("mark_early_exit", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            )
        if "auto_regularization_early_exit" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("auto_regularization_early_exit", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            )
        if "missing_punch_out" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("missing_punch_out", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            )
        if "missing_punch_in" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("missing_punch_in", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            )
        if "auto_mark_irregular" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("auto_mark_irregular", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            )
        if "require_regularization" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("require_regularization", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            )
        if "consecutive_late_warning" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("consecutive_late_warning", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            )
        if "auto_email_notification" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("auto_email_notification", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            )
        if "auto_manager_notification" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("auto_manager_notification", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            )
        if "holiday_overtime" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("holiday_overtime", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            )
        if "weekend_overtime" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("weekend_overtime", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            )
        if "flexible_shift" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("flexible_shift", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            )
        if "grace_extension" not in cols:
            op.add_column(
                "hrms_attendance_policies",
                sa.Column("grace_extension", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            )

    # 2. Update hrms_attendance_regularizations
    if insp.has_table("hrms_attendance_regularizations"):
        reg_cols = {c["name"] for c in insp.get_columns("hrms_attendance_regularizations")}

        if "punch_in_time" not in reg_cols:
            op.add_column(
                "hrms_attendance_regularizations",
                sa.Column("punch_in_time", sa.String(length=20), nullable=True),
            )
        if "punch_out_time" not in reg_cols:
            op.add_column(
                "hrms_attendance_regularizations",
                sa.Column("punch_out_time", sa.String(length=20), nullable=True),
            )
        if "total_hours" not in reg_cols:
            op.add_column(
                "hrms_attendance_regularizations",
                sa.Column("total_hours", sa.String(length=20), nullable=True),
            )


def downgrade() -> None:
    pass
