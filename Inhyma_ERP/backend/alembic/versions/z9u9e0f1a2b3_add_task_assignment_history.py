"""Add immutable task_assignment_history table for tasks and recurring schedules

Revision ID: z9u9e0f1a2b3
Revises: z9t8d9e0f1a2
Create Date: 2026-11-28 15:20:00.000000

Adds the ``task_assignment_history`` table so task and recurring-schedule
reassignments preserve previous assignee records instead of permanently
deleting them, enabling previous-assignee task history visibility and
auditable assignment timelines.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "z9u9e0f1a2b3"
down_revision: Union[str, None] = "z9t8d9e0f1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _guid_type(bind) -> sa.types.TypeEngine:
    if bind.dialect.name == "postgresql":
        return postgresql.UUID(as_uuid=True)
    return sa.String(length=36)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    guid = _guid_type(bind)

    if "task_assignment_history" not in existing_tables:
        op.create_table(
            "task_assignment_history",
            sa.Column("id", guid, primary_key=True, nullable=False),
            sa.Column(
                "task_id",
                guid,
                sa.ForeignKey("tasks.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column(
                "recurring_schedule_id",
                guid,
                sa.ForeignKey("task_recurring_schedules.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column(
                "user_id",
                guid,
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("assignment_role", sa.String(length=50), nullable=False, server_default="ASSIGNEE"),
            sa.Column(
                "assigned_by",
                guid,
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "assigned_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("unassigned_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "unassigned_by",
                guid,
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "reassigned_to_user_id",
                guid,
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("source", sa.String(length=40), nullable=False, server_default="MANUAL"),
        )

    existing_indexes = {
        idx["name"] for idx in inspector.get_indexes("task_assignment_history")
    } if "task_assignment_history" in set(sa.inspect(bind).get_table_names()) else set()

    index_defs = [
        ("ix_task_assignment_history_task_id", ["task_id"]),
        ("ix_task_assignment_history_recurring_schedule_id", ["recurring_schedule_id"]),
        ("ix_task_assignment_history_user_id", ["user_id"]),
        ("ix_task_assignment_history_unassigned_at", ["unassigned_at"]),
        ("ix_task_assignment_history_task_user", ["task_id", "user_id", "unassigned_at"]),
        ("ix_task_assignment_history_user_unassigned", ["user_id", "unassigned_at"]),
        ("ix_task_assignment_history_schedule_assigned", ["recurring_schedule_id", "assigned_at"]),
    ]
    for idx_name, cols in index_defs:
        if idx_name not in existing_indexes:
            op.create_index(idx_name, "task_assignment_history", cols, unique=False)

    # Backfill initial open assignment history rows for existing active task assignees
    # and recurring task schedules (idempotent: only inserts when no matching open row exists).
    if bind.dialect.name == "postgresql":
        if "task_assignees" in existing_tables and "tasks" in existing_tables:
            op.execute(
                sa.text(
                    """
                    INSERT INTO task_assignment_history (
                        id, task_id, recurring_schedule_id, user_id, assignment_role,
                        assigned_by, assigned_at, unassigned_at, unassigned_by,
                        reassigned_to_user_id, source
                    )
                    SELECT
                        ta.id,
                        ta.task_id,
                        t.recurring_schedule_id,
                        ta.user_id,
                        ta.assignment_role,
                        t.created_by,
                        COALESCE(ta.created_at, t.created_at, NOW()),
                        NULL,
                        NULL,
                        NULL,
                        CASE WHEN t.recurring_schedule_id IS NOT NULL THEN 'RECURRING_GENERATED' ELSE 'BACKFILL' END
                    FROM task_assignees ta
                    JOIN tasks t ON t.id = ta.task_id
                    WHERE ta.assignment_role <> 'WATCHER'
                      AND NOT EXISTS (
                          SELECT 1 FROM task_assignment_history h
                          WHERE h.task_id = ta.task_id
                            AND h.user_id = ta.user_id
                            AND h.unassigned_at IS NULL
                      )
                    """
                )
            )
        if "task_recurring_schedules" in existing_tables:
            op.execute(
                sa.text(
                    """
                    INSERT INTO task_assignment_history (
                        id, task_id, recurring_schedule_id, user_id, assignment_role,
                        assigned_by, assigned_at, unassigned_at, unassigned_by,
                        reassigned_to_user_id, source
                    )
                    SELECT
                        trs.id,
                        NULL,
                        trs.id,
                        trs.assignee_id,
                        'ASSIGNEE',
                        trs.created_by,
                        COALESCE(trs.created_at, NOW()),
                        NULL,
                        NULL,
                        NULL,
                        'RECURRING_SCHEDULE'
                    FROM task_recurring_schedules trs
                    WHERE trs.assignee_id IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM task_assignment_history h
                          WHERE h.task_id IS NULL
                            AND h.recurring_schedule_id = trs.id
                            AND h.user_id = trs.assignee_id
                            AND h.unassigned_at IS NULL
                      )
                    """
                )
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "task_assignment_history" in set(inspector.get_table_names()):
        op.drop_table("task_assignment_history")
