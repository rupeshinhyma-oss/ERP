"""add task collaboration and escalation tables

Revision ID: i4d5e6f7g8h9
Revises: h3c4d5e6f7g8
Create Date: 2026-09-04 18:40:00.000000

Adds:
  - task_attachments
  - task_comment_attachments
  - task_voice_notes
  - task_subtask_comments
  - task_subtask_attachments
  - task_escalation_comments
  - task_comments.audio_url
"""

from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = "i4d5e6f7g8h9"
down_revision: Union[str, None] = "h3c4d5e6f7g8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1. task_comments.audio_url
    if insp.has_table("task_comments"):
        comment_cols = {c["name"] for c in insp.get_columns("task_comments")}
        if "audio_url" not in comment_cols:
            op.add_column("task_comments", sa.Column("audio_url", sa.String(500), nullable=True))

    # 2. task_attachments
    if not insp.has_table("task_attachments"):
        op.create_table(
            "task_attachments",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("task_id", app.database.base.GUID(), nullable=False),
            sa.Column("uploaded_by", app.database.base.GUID(), nullable=True),
            sa.Column("file_name", sa.String(255), nullable=False),
            sa.Column("file_url", sa.String(500), nullable=False),
            sa.Column("file_type", sa.String(100), nullable=False),
            sa.Column("file_size", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="SET NULL"),
        )
        op.create_index("ix_task_attachments_task_id", "task_attachments", ["task_id"])
        op.create_index("ix_task_attachments_uploaded_by", "task_attachments", ["uploaded_by"])

    # 3. task_comment_attachments
    if not insp.has_table("task_comment_attachments"):
        op.create_table(
            "task_comment_attachments",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("comment_id", app.database.base.GUID(), nullable=False),
            sa.Column("file_name", sa.String(255), nullable=False),
            sa.Column("file_url", sa.String(500), nullable=False),
            sa.Column("file_type", sa.String(100), nullable=False),
            sa.Column("file_size", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["comment_id"], ["task_comments.id"], ondelete="CASCADE"),
        )
        op.create_index("ix_task_comment_attachments_comment_id", "task_comment_attachments", ["comment_id"])

    # 4. task_voice_notes
    if not insp.has_table("task_voice_notes"):
        op.create_table(
            "task_voice_notes",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("task_id", app.database.base.GUID(), nullable=False),
            sa.Column("subtask_id", app.database.base.GUID(), nullable=True),
            sa.Column("comment_id", app.database.base.GUID(), nullable=True),
            sa.Column("uploaded_by", app.database.base.GUID(), nullable=True),
            sa.Column("file_name", sa.String(255), nullable=False),
            sa.Column("audio_url", sa.String(500), nullable=False),
            sa.Column("duration_seconds", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["subtask_id"], ["task_subtasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["comment_id"], ["task_comments.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="SET NULL"),
        )
        op.create_index("ix_task_voice_notes_task_id", "task_voice_notes", ["task_id"])
        op.create_index("ix_task_voice_notes_subtask_id", "task_voice_notes", ["subtask_id"])
        op.create_index("ix_task_voice_notes_comment_id", "task_voice_notes", ["comment_id"])

    # 5. task_subtask_comments
    if not insp.has_table("task_subtask_comments"):
        op.create_table(
            "task_subtask_comments",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("subtask_id", app.database.base.GUID(), nullable=False),
            sa.Column("user_id", app.database.base.GUID(), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("audio_url", sa.String(500), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["subtask_id"], ["task_subtasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )
        op.create_index("ix_task_subtask_comments_subtask_id", "task_subtask_comments", ["subtask_id"])
        op.create_index("ix_task_subtask_comments_user_id", "task_subtask_comments", ["user_id"])

    # 6. task_subtask_attachments
    if not insp.has_table("task_subtask_attachments"):
        op.create_table(
            "task_subtask_attachments",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("subtask_id", app.database.base.GUID(), nullable=False),
            sa.Column("uploaded_by", app.database.base.GUID(), nullable=True),
            sa.Column("file_name", sa.String(255), nullable=False),
            sa.Column("file_url", sa.String(500), nullable=False),
            sa.Column("file_type", sa.String(100), nullable=False),
            sa.Column("file_size", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["subtask_id"], ["task_subtasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="SET NULL"),
        )
        op.create_index("ix_task_subtask_attachments_subtask_id", "task_subtask_attachments", ["subtask_id"])

    # 7. task_escalation_comments
    if not insp.has_table("task_escalation_comments"):
        op.create_table(
            "task_escalation_comments",
            sa.Column("id", app.database.base.GUID(), primary_key=True, default=uuid.uuid4),
            sa.Column("escalation_id", app.database.base.GUID(), nullable=False),
            sa.Column("user_id", app.database.base.GUID(), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("audio_url", sa.String(500), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["escalation_id"], ["task_escalations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )
        op.create_index("ix_task_escalation_comments_escalation_id", "task_escalation_comments", ["escalation_id"])
        op.create_index("ix_task_escalation_comments_user_id", "task_escalation_comments", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("task_escalation_comments"):
        op.drop_table("task_escalation_comments")
    if insp.has_table("task_subtask_attachments"):
        op.drop_table("task_subtask_attachments")
    if insp.has_table("task_subtask_comments"):
        op.drop_table("task_subtask_comments")
    if insp.has_table("task_voice_notes"):
        op.drop_table("task_voice_notes")
    if insp.has_table("task_comment_attachments"):
        op.drop_table("task_comment_attachments")
    if insp.has_table("task_attachments"):
        op.drop_table("task_attachments")
    if insp.has_table("task_comments"):
        comment_cols = {c["name"] for c in insp.get_columns("task_comments")}
        if "audio_url" in comment_cols:
            op.drop_column("task_comments", "audio_url")
