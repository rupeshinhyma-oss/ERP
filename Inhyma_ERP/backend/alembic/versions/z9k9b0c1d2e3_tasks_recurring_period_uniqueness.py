"""tasks_recurring_period_uniqueness

Revision ID: z9k9b0c1d2e3
Revises: z9j8a9b0c1d2
Create Date: 2026-11-19 16:26:00.000000

Enforces database-level idempotency for recurring task generation (BUG-03):
Creates partial unique index ``uq_tasks_recurring_schedule_period`` on
``tasks (recurring_schedule_id, recurrence_period)`` for active
(non-soft-deleted) recurring task instances.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "z9k9b0c1d2e3"
down_revision: Union[str, Sequence[str], None] = "z9j8a9b0c1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if not insp.has_table("tasks"):
        return

    dialect = bind.dialect.name
    if dialect == "postgresql":
        # Non-destructively archive any pre-existing duplicate active recurring
        # instances (preserving the earliest row) so unique index creation succeeds.
        bind.execute(
            sa.text(
                """
                WITH ranked AS (
                    SELECT
                        id,
                        ROW_NUMBER() OVER (
                            PARTITION BY recurring_schedule_id, recurrence_period
                            ORDER BY created_at ASC, id ASC
                        ) AS rn
                    FROM tasks
                    WHERE recurring_schedule_id IS NOT NULL
                      AND recurrence_period IS NOT NULL
                      AND deleted_at IS NULL
                )
                UPDATE tasks t
                SET deleted_at = NOW()
                FROM ranked r
                WHERE t.id = r.id
                  AND r.rn > 1
                """
            )
        )
        bind.execute(
            sa.text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_recurring_schedule_period
                ON tasks (recurring_schedule_id, recurrence_period)
                WHERE recurring_schedule_id IS NOT NULL
                  AND recurrence_period IS NOT NULL
                  AND deleted_at IS NULL
                """
            )
        )
    else:
        existing_indexes = {idx["name"] for idx in insp.get_indexes("tasks") if idx.get("name")}
        if "uq_tasks_recurring_schedule_period" not in existing_indexes:
            op.create_index(
                "uq_tasks_recurring_schedule_period",
                "tasks",
                ["recurring_schedule_id", "recurrence_period"],
                unique=True,
                sqlite_where=sa.text(
                    "recurring_schedule_id IS NOT NULL "
                    "AND recurrence_period IS NOT NULL "
                    "AND deleted_at IS NULL"
                ),
            )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if not insp.has_table("tasks"):
        return

    dialect = bind.dialect.name
    if dialect == "postgresql":
        bind.execute(sa.text("DROP INDEX IF EXISTS uq_tasks_recurring_schedule_period"))
    else:
        existing_indexes = {idx["name"] for idx in insp.get_indexes("tasks") if idx.get("name")}
        if "uq_tasks_recurring_schedule_period" in existing_indexes:
            op.drop_index("uq_tasks_recurring_schedule_period", table_name="tasks")
