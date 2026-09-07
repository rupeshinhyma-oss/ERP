"""create tasks and notifications tables

Revision ID: f1a2b3c4d5e6
Revises: e8f9a0b1c2d3
Create Date: 2026-09-04 16:15:00.000000

Creates:
  - tasks
  - task_assignees
  - task_subtasks
  - task_comments
  - task_escalations
  - notifications
"""

from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e8f9a0b1c2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1. tasks
    if not insp.has_table("tasks"):
        op.create_table(
            "tasks",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("priority", sa.String(20), nullable=False, server_default="MEDIUM"),
            sa.Column("status", sa.String(20), nullable=False, server_default="TODO"),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("created_by", app.database.base.GUID(), nullable=True),
            sa.Column("deleted_by", app.database.base.GUID(), nullable=True),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["deleted_by"], ["users.id"], ondelete="SET NULL"),
        )
        op.create_index("ix_tasks_title", "tasks", ["title"])
        op.create_index("ix_tasks_priority", "tasks", ["priority"])
        op.create_index("ix_tasks_status", "tasks", ["status"])
        op.create_index("ix_tasks_due_date", "tasks", ["due_date"])
        op.create_index("ix_tasks_created_by", "tasks", ["created_by"])
        op.create_index("ix_tasks_deleted_at", "tasks", ["deleted_at"])
    else:
        existing_cols = {c["name"] for c in insp.get_columns("tasks")}
        if "created_by" not in existing_cols:
            op.add_column("tasks", sa.Column("created_by", app.database.base.GUID(), nullable=True))
            op.create_foreign_key("fk_tasks_created_by", "tasks", "users", ["created_by"], ["id"], ondelete="SET NULL")
            op.create_index("ix_tasks_created_by", "tasks", ["created_by"])
        if "deleted_by" not in existing_cols:
            op.add_column("tasks", sa.Column("deleted_by", app.database.base.GUID(), nullable=True))
            op.create_foreign_key("fk_tasks_deleted_by", "tasks", "users", ["deleted_by"], ["id"], ondelete="SET NULL")
        if "version" not in existing_cols:
            op.add_column("tasks", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
        if "deleted_at" not in existing_cols:
            op.add_column("tasks", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
            op.create_index("ix_tasks_deleted_at", "tasks", ["deleted_at"])

    # 2. task_assignees
    if not insp.has_table("task_assignees"):
        op.create_table(
            "task_assignees",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("task_id", app.database.base.GUID(), nullable=False),
            sa.Column("user_id", app.database.base.GUID(), nullable=False),
            sa.Column("assignment_role", sa.String(50), nullable=False, server_default="ASSIGNEE"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("task_id", "user_id", name="uq_task_assignee"),
        )
        op.create_index("ix_task_assignees_task_id", "task_assignees", ["task_id"])
        op.create_index("ix_task_assignees_user_id", "task_assignees", ["user_id"])

    # 3. task_subtasks
    if not insp.has_table("task_subtasks"):
        op.create_table(
            "task_subtasks",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("task_id", app.database.base.GUID(), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("assignee_id", app.database.base.GUID(), nullable=True),
            sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["assignee_id"], ["users.id"], ondelete="SET NULL"),
        )
        op.create_index("ix_task_subtasks_task_id", "task_subtasks", ["task_id"])
        op.create_index("ix_task_subtasks_completed", "task_subtasks", ["completed"])
        op.create_index("ix_task_subtasks_assignee_id", "task_subtasks", ["assignee_id"])

    # 4. task_comments
    if not insp.has_table("task_comments"):
        op.create_table(
            "task_comments",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("task_id", app.database.base.GUID(), nullable=False),
            sa.Column("user_id", app.database.base.GUID(), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )
        op.create_index("ix_task_comments_task_id", "task_comments", ["task_id"])
        op.create_index("ix_task_comments_user_id", "task_comments", ["user_id"])

    # 5. task_escalations
    if not insp.has_table("task_escalations"):
        op.create_table(
            "task_escalations",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("task_id", app.database.base.GUID(), nullable=False),
            sa.Column("from_user", app.database.base.GUID(), nullable=False),
            sa.Column("to_user", app.database.base.GUID(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["from_user"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["to_user"], ["users.id"], ondelete="CASCADE"),
        )
        op.create_index("ix_task_escalations_task_id", "task_escalations", ["task_id"])
        op.create_index("ix_task_escalations_from_user", "task_escalations", ["from_user"])
        op.create_index("ix_task_escalations_to_user", "task_escalations", ["to_user"])

    # 6. notifications
    if not insp.has_table("notifications"):
        op.create_table(
            "notifications",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("user_id", app.database.base.GUID(), nullable=False),
            sa.Column("type", sa.String(50), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("link", sa.String(255), nullable=True),
            sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )
        op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
        op.create_index("ix_notifications_type", "notifications", ["type"])
        op.create_index("ix_notifications_is_read", "notifications", ["is_read"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    for table_name in [
        "notifications",
        "task_escalations",
        "task_comments",
        "task_subtasks",
        "task_assignees",
        "tasks",
    ]:
        if insp.has_table(table_name):
            op.drop_table(table_name)
