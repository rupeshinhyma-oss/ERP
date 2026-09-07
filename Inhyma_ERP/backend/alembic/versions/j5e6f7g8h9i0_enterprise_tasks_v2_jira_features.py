"""enterprise tasks v2 jira features

Revision ID: j5e6f7g8h9i0
Revises: i4d5e6f7g8h9
Create Date: 2026-09-07 11:10:00.000000

Adds:
  - task_sprints
  - tasks.issue_type
  - tasks.parent_task_id
  - tasks.sprint_id
  - tasks.approval_status
  - tasks.approver_id
  - tasks.approval_notes
  - tasks.approved_at
  - task_labels
  - task_label_links
  - task_templates
  - task_dependencies
  - task_saved_filters
  - task_reactions
  - task_mentions
"""

from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = "j5e6f7g8h9i0"
down_revision: Union[str, None] = "i4d5e6f7g8h9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1. task_sprints table (must exist before tasks.sprint_id FK)
    if not insp.has_table("task_sprints"):
        op.create_table(
            "task_sprints",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("goal", sa.Text(), nullable=True),
            sa.Column("status", sa.String(20), server_default="PLANNED", nullable=False),
            sa.Column("start_date", sa.Date(), nullable=True),
            sa.Column("end_date", sa.Date(), nullable=True),
            sa.Column("created_by", app.database.base.GUID(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        )
        op.create_index("ix_task_sprints_status", "task_sprints", ["status"])

    # 2. Add additive columns to tasks table
    if insp.has_table("tasks"):
        task_cols = {c["name"] for c in insp.get_columns("tasks")}
        if "issue_type" not in task_cols:
            op.add_column("tasks", sa.Column("issue_type", sa.String(20), server_default="TASK", nullable=False))
            op.create_index("ix_tasks_issue_type", "tasks", ["issue_type"])
        if "parent_task_id" not in task_cols:
            op.add_column("tasks", sa.Column("parent_task_id", app.database.base.GUID(), nullable=True))
            op.create_foreign_key("fk_tasks_parent_task_id", "tasks", "tasks", ["parent_task_id"], ["id"], ondelete="SET NULL")
            op.create_index("ix_tasks_parent_task_id", "tasks", ["parent_task_id"])
        if "sprint_id" not in task_cols:
            op.add_column("tasks", sa.Column("sprint_id", app.database.base.GUID(), nullable=True))
            op.create_foreign_key("fk_tasks_sprint_id", "tasks", "task_sprints", ["sprint_id"], ["id"], ondelete="SET NULL")
            op.create_index("ix_tasks_sprint_id", "tasks", ["sprint_id"])
        if "approval_status" not in task_cols:
            op.add_column("tasks", sa.Column("approval_status", sa.String(20), server_default="NONE", nullable=False))
            op.create_index("ix_tasks_approval_status", "tasks", ["approval_status"])
        if "approver_id" not in task_cols:
            op.add_column("tasks", sa.Column("approver_id", app.database.base.GUID(), nullable=True))
            op.create_foreign_key("fk_tasks_approver_id", "tasks", "users", ["approver_id"], ["id"], ondelete="SET NULL")
            op.create_index("ix_tasks_approver_id", "tasks", ["approver_id"])
        if "approval_notes" not in task_cols:
            op.add_column("tasks", sa.Column("approval_notes", sa.Text(), nullable=True))
        if "approved_at" not in task_cols:
            op.add_column("tasks", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))

    # 3. task_labels
    if not insp.has_table("task_labels"):
        op.create_table(
            "task_labels",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("color", sa.String(20), server_default="#3b82f6", nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("created_by", app.database.base.GUID(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("name", name="uq_task_label_name"),
        )
        op.create_index("ix_task_labels_name", "task_labels", ["name"])

    # 4. task_label_links
    if not insp.has_table("task_label_links"):
        op.create_table(
            "task_label_links",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("task_id", app.database.base.GUID(), nullable=False),
            sa.Column("label_id", app.database.base.GUID(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["label_id"], ["task_labels.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("task_id", "label_id", name="uq_task_label_link"),
        )
        op.create_index("ix_task_label_links_task_id", "task_label_links", ["task_id"])
        op.create_index("ix_task_label_links_label_id", "task_label_links", ["label_id"])

    # 5. task_templates
    if not insp.has_table("task_templates"):
        op.create_table(
            "task_templates",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("issue_type", sa.String(20), server_default="TASK", nullable=False),
            sa.Column("priority", sa.String(20), server_default="MEDIUM", nullable=False),
            sa.Column("default_subtasks", sa.JSON(), nullable=True),
            sa.Column("default_labels", sa.JSON(), nullable=True),
            sa.Column("default_watcher_ids", sa.JSON(), nullable=True),
            sa.Column("is_shared", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("created_by", app.database.base.GUID(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        )

    # 6. task_dependencies
    if not insp.has_table("task_dependencies"):
        op.create_table(
            "task_dependencies",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("task_id", app.database.base.GUID(), nullable=False),
            sa.Column("depends_on_task_id", app.database.base.GUID(), nullable=False),
            sa.Column("relationship_type", sa.String(20), server_default="BLOCKS", nullable=False),
            sa.Column("created_by", app.database.base.GUID(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["depends_on_task_id"], ["tasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("task_id", "depends_on_task_id", "relationship_type", name="uq_task_dependency"),
        )
        op.create_index("ix_task_dependencies_task_id", "task_dependencies", ["task_id"])
        op.create_index("ix_task_dependencies_depends_on_task_id", "task_dependencies", ["depends_on_task_id"])

    # 7. task_saved_filters
    if not insp.has_table("task_saved_filters"):
        op.create_table(
            "task_saved_filters",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("user_id", app.database.base.GUID(), nullable=False),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("filter_criteria", sa.JSON(), nullable=False),
            sa.Column("is_default", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )
        op.create_index("ix_task_saved_filters_user_id", "task_saved_filters", ["user_id"])

    # 8. task_reactions
    if not insp.has_table("task_reactions"):
        op.create_table(
            "task_reactions",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("task_id", app.database.base.GUID(), nullable=True),
            sa.Column("comment_id", app.database.base.GUID(), nullable=True),
            sa.Column("user_id", app.database.base.GUID(), nullable=False),
            sa.Column("emoji", sa.String(10), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["comment_id"], ["task_comments.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )
        op.create_index("ix_task_reactions_task_id", "task_reactions", ["task_id"])
        op.create_index("ix_task_reactions_comment_id", "task_reactions", ["comment_id"])
        op.create_index("ix_task_reactions_user_id", "task_reactions", ["user_id"])

    # 9. task_mentions
    if not insp.has_table("task_mentions"):
        op.create_table(
            "task_mentions",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("task_id", app.database.base.GUID(), nullable=False),
            sa.Column("comment_id", app.database.base.GUID(), nullable=True),
            sa.Column("mentioned_user_id", app.database.base.GUID(), nullable=False),
            sa.Column("mentioned_by", app.database.base.GUID(), nullable=False),
            sa.Column("context_type", sa.String(30), server_default="TASK_COMMENT", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["comment_id"], ["task_comments.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["mentioned_user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["mentioned_by"], ["users.id"], ondelete="CASCADE"),
        )
        op.create_index("ix_task_mentions_task_id", "task_mentions", ["task_id"])
        op.create_index("ix_task_mentions_mentioned_user_id", "task_mentions", ["mentioned_user_id"])


def downgrade() -> None:
    # Non-breaking, additive only
    pass
