"""create_task_recurring_schedules

Revision ID: q2c3d4e5f6a7
Revises: q1c2d3e4f5a6
Create Date: 2026-10-21 18:00:00.000000

Creates task_recurring_schedules table and adds recurring_schedule_id,
recurrence_period columns to tasks table.
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from app.database.base import GUID

# revision identifiers, used by Alembic.
revision: str = "q2c3d4e5f6a7"
down_revision: Union[str, None] = "q1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)

    # 1. Create task_recurring_schedules table if not exists
    if "task_recurring_schedules" not in insp.get_table_names():
        op.create_table(
            "task_recurring_schedules",
            sa.Column("id", GUID(), primary_key=True),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("department", sa.String(100), nullable=True),
            sa.Column("assignee_id", GUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("manager_id", GUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_by", GUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("deleted_by", GUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("priority", sa.String(20), nullable=False, server_default="MEDIUM"),
            sa.Column("issue_type", sa.String(20), nullable=False, server_default="TASK"),
            sa.Column("frequency", sa.String(20), nullable=False, server_default="MONTHLY"),
            sa.Column("recurrence_config", sa.JSON(), nullable=False),
            sa.Column("reminder_lead_days", sa.Integer(), nullable=False, server_default="3"),
            sa.Column("escalation_timing_type", sa.String(30), nullable=False, server_default="ON_DUE_DATE"),
            sa.Column("escalation_offset_days", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("escalation_repeat_interval_days", sa.Integer(), nullable=False, server_default="7"),
            sa.Column("hold_until_rule", sa.String(50), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="ACTIVE"),
            sa.Column("effective_start_date", sa.Date(), nullable=False),
            sa.Column("effective_end_date", sa.Date(), nullable=True),
            sa.Column("next_run_date", sa.Date(), nullable=True),
            sa.Column("last_generated_period", sa.String(50), nullable=True),
            sa.Column("last_generated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_task_recurring_schedules_title", "task_recurring_schedules", ["title"])
        op.create_index("ix_task_recurring_schedules_department", "task_recurring_schedules", ["department"])
        op.create_index("ix_task_recurring_schedules_assignee_id", "task_recurring_schedules", ["assignee_id"])
        op.create_index("ix_task_recurring_schedules_manager_id", "task_recurring_schedules", ["manager_id"])
        op.create_index("ix_task_recurring_schedules_status", "task_recurring_schedules", ["status"])
        op.create_index("ix_task_recurring_schedules_frequency", "task_recurring_schedules", ["frequency"])
        op.create_index("ix_task_recurring_schedules_next_run_date", "task_recurring_schedules", ["next_run_date"])
        op.create_index("ix_task_recurring_schedules_deleted_at", "task_recurring_schedules", ["deleted_at"])

    # 2. Add columns to tasks table
    task_cols = [c["name"] for c in insp.get_columns("tasks")]
    if "recurring_schedule_id" not in task_cols:
        op.add_column(
            "tasks",
            sa.Column(
                "recurring_schedule_id",
                GUID(),
                sa.ForeignKey("task_recurring_schedules.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index("ix_tasks_recurring_schedule_id", "tasks", ["recurring_schedule_id"])

    if "recurrence_period" not in task_cols:
        op.add_column(
            "tasks",
            sa.Column("recurrence_period", sa.String(50), nullable=True),
        )
        op.create_index("ix_tasks_recurrence_period", "tasks", ["recurrence_period"])


def downgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)

    task_cols = [c["name"] for c in insp.get_columns("tasks")]
    if "recurrence_period" in task_cols:
        op.drop_index("ix_tasks_recurrence_period", table_name="tasks")
        op.drop_column("tasks", "recurrence_period")

    if "recurring_schedule_id" in task_cols:
        op.drop_index("ix_tasks_recurring_schedule_id", table_name="tasks")
        op.drop_column("tasks", "recurring_schedule_id")

    if "task_recurring_schedules" in insp.get_table_names():
        op.drop_table("task_recurring_schedules")
