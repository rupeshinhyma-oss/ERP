"""upgrade_hrms_leave_type_rules

Adds additional configuration fields to hrms_leave_types:
- allocation_unit (String 20, default 'DAYS')
- accrual_frequency (String 20, default 'MONTHLY')
- applicable_to (String 50, default 'ALL')
- applicable_departments (String 500, default 'ALL')
- applicable_branches (String 500, default 'ALL')
- count_weekends_as_leave (Boolean, default false)
- count_holidays_as_leave (Boolean, default false)
- allow_negative_balance (Boolean, default false)

Revision ID: k1a2b3c4d5ed
Revises: j1a2b3c4d5ec
Create Date: 2026-10-03 13:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "k1a2b3c4d5ed"
down_revision: Union[str, None] = "j1a2b3c4d5ec"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("hrms_leave_types"):
        columns = [c["name"] for c in insp.get_columns("hrms_leave_types")]
        if "allocation_unit" not in columns:
            op.add_column("hrms_leave_types", sa.Column("allocation_unit", sa.String(20), server_default="DAYS", nullable=False))
        if "accrual_frequency" not in columns:
            op.add_column("hrms_leave_types", sa.Column("accrual_frequency", sa.String(20), server_default="MONTHLY", nullable=False))
        if "applicable_to" not in columns:
            op.add_column("hrms_leave_types", sa.Column("applicable_to", sa.String(50), server_default="ALL", nullable=False))
        if "applicable_departments" not in columns:
            op.add_column("hrms_leave_types", sa.Column("applicable_departments", sa.String(500), server_default="ALL", nullable=True))
        if "applicable_branches" not in columns:
            op.add_column("hrms_leave_types", sa.Column("applicable_branches", sa.String(500), server_default="ALL", nullable=True))
        if "count_weekends_as_leave" not in columns:
            op.add_column("hrms_leave_types", sa.Column("count_weekends_as_leave", sa.Boolean(), server_default=sa.text("false"), nullable=False))
        if "count_holidays_as_leave" not in columns:
            op.add_column("hrms_leave_types", sa.Column("count_holidays_as_leave", sa.Boolean(), server_default=sa.text("false"), nullable=False))
        if "allow_negative_balance" not in columns:
            op.add_column("hrms_leave_types", sa.Column("allow_negative_balance", sa.Boolean(), server_default=sa.text("false"), nullable=False))


def downgrade() -> None:
    pass
