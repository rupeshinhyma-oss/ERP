"""upgrade_hrms_leave_types_and_holidays

Adds configurable fields to hrms_leave_types:
- description (Text)
- accrual_amount (Float)
- min_notice_days (Integer)
- allow_half_day (Boolean)
- allow_backdated (Boolean)
- require_attachment (Boolean)
- attendance_based_accrual (Boolean)
- attendance_based_condition (String 100)
- attendance_based_reward (Float)
- attendance_based_departments (String 500)
- min_attendance_percentage (Float)
- min_working_days (Integer)

Adds department_scope (String 255) to hrms_holidays.

Revision ID: j1a2b3c4d5ec
Revises: i1a2b3c4d5eb
Create Date: 2026-10-03 12:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "j1a2b3c4d5ec"
down_revision: Union[str, None] = "i1a2b3c4d5eb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("hrms_leave_types"):
        columns = [c["name"] for c in insp.get_columns("hrms_leave_types")]
        if "description" not in columns:
            op.add_column("hrms_leave_types", sa.Column("description", sa.Text(), nullable=True))
        if "accrual_amount" not in columns:
            op.add_column("hrms_leave_types", sa.Column("accrual_amount", sa.Float(), server_default="1.0", nullable=False))
        if "min_notice_days" not in columns:
            op.add_column("hrms_leave_types", sa.Column("min_notice_days", sa.Integer(), server_default="0", nullable=False))
        if "allow_half_day" not in columns:
            op.add_column("hrms_leave_types", sa.Column("allow_half_day", sa.Boolean(), server_default=sa.text("true"), nullable=False))
        if "allow_backdated" not in columns:
            op.add_column("hrms_leave_types", sa.Column("allow_backdated", sa.Boolean(), server_default=sa.text("false"), nullable=False))
        if "require_attachment" not in columns:
            op.add_column("hrms_leave_types", sa.Column("require_attachment", sa.Boolean(), server_default=sa.text("false"), nullable=False))
        if "attendance_based_accrual" not in columns:
            op.add_column("hrms_leave_types", sa.Column("attendance_based_accrual", sa.Boolean(), server_default=sa.text("false"), nullable=False))
        if "attendance_based_condition" not in columns:
            op.add_column("hrms_leave_types", sa.Column("attendance_based_condition", sa.String(100), server_default="FULL_MONTH_PRESENT", nullable=True))
        if "attendance_based_reward" not in columns:
            op.add_column("hrms_leave_types", sa.Column("attendance_based_reward", sa.Float(), server_default="1.0", nullable=False))
        if "attendance_based_departments" not in columns:
            op.add_column("hrms_leave_types", sa.Column("attendance_based_departments", sa.String(500), server_default="ALL", nullable=True))
        if "min_attendance_percentage" not in columns:
            op.add_column("hrms_leave_types", sa.Column("min_attendance_percentage", sa.Float(), nullable=True))
        if "min_working_days" not in columns:
            op.add_column("hrms_leave_types", sa.Column("min_working_days", sa.Integer(), nullable=True))

    if insp.has_table("hrms_holidays"):
        h_cols = [c["name"] for c in insp.get_columns("hrms_holidays")]
        if "department_scope" not in h_cols:
            op.add_column("hrms_holidays", sa.Column("department_scope", sa.String(255), server_default="ALL", nullable=True))


def downgrade() -> None:
    pass
