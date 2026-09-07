"""upgrade tasks enterprise features

Revision ID: g2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-09-04 17:10:00.000000

Adds:
  - tasks.start_date
  - task_subtasks (description, priority, status, start_date, due_date)
  - task_subtask_assignees table
  - task_escalations (escalation_type, due_date)
"""

from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = "g2b3c4d5e6f7"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1. tasks.start_date
    if insp.has_table("tasks"):
        task_cols = [c["name"] for c in insp.get_columns("tasks")]
        if "start_date" not in task_cols:
            op.add_column("tasks", sa.Column("start_date", sa.Date(), nullable=True))
            op.create_index("ix_tasks_start_date", "tasks", ["start_date"])

    # 2. task_subtasks upgrades
    if insp.has_table("task_subtasks"):
        sub_cols = [c["name"] for c in insp.get_columns("task_subtasks")]
        if "description" not in sub_cols:
            op.add_column("task_subtasks", sa.Column("description", sa.Text(), nullable=True))
        if "priority" not in sub_cols:
            op.add_column(
                "task_subtasks",
                sa.Column("priority", sa.String(20), server_default="MEDIUM", nullable=False),
            )
        if "status" not in sub_cols:
            op.add_column(
                "task_subtasks",
                sa.Column("status", sa.String(20), server_default="TODO", nullable=False),
            )
        if "start_date" not in sub_cols:
            op.add_column("task_subtasks", sa.Column("start_date", sa.Date(), nullable=True))
        if "due_date" not in sub_cols:
            op.add_column("task_subtasks", sa.Column("due_date", sa.Date(), nullable=True))

    # 3. task_subtask_assignees table
    if not insp.has_table("task_subtask_assignees"):
        op.create_table(
            "task_subtask_assignees",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column(
                "subtask_id",
                app.database.base.GUID(),
                sa.ForeignKey("task_subtasks.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column(
                "user_id",
                app.database.base.GUID(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                onupdate=sa.func.now(),
                nullable=False,
            ),
            sa.UniqueConstraint("subtask_id", "user_id", name="uq_subtask_assignee"),
        )

    # 4. task_escalations upgrades
    if insp.has_table("task_escalations"):
        esc_cols = [c["name"] for c in insp.get_columns("task_escalations")]
        if "escalation_type" not in esc_cols:
            op.add_column(
                "task_escalations",
                sa.Column(
                    "escalation_type",
                    sa.String(50),
                    server_default="ORGANIZATION_USER",
                    nullable=False,
                ),
            )
        if "due_date" not in esc_cols:
            op.add_column("task_escalations", sa.Column("due_date", sa.Date(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("task_subtask_assignees"):
        op.drop_table("task_subtask_assignees")

    if insp.has_table("task_escalations"):
        esc_cols = [c["name"] for c in insp.get_columns("task_escalations")]
        if "due_date" in esc_cols:
            op.drop_column("task_escalations", "due_date")
        if "escalation_type" in esc_cols:
            op.drop_column("task_escalations", "escalation_type")

    if insp.has_table("task_subtasks"):
        sub_cols = [c["name"] for c in insp.get_columns("task_subtasks")]
        for col in ["due_date", "start_date", "status", "priority", "description"]:
            if col in sub_cols:
                op.drop_column("task_subtasks", col)

    if insp.has_table("tasks"):
        task_cols = [c["name"] for c in insp.get_columns("tasks")]
        if "start_date" in task_cols:
            op.drop_index("ix_tasks_start_date", table_name="tasks")
            op.drop_column("tasks", "start_date")
