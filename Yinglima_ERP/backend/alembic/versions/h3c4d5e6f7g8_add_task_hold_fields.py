"""add task hold fields

Revision ID: h3c4d5e6f7g8
Revises: g2b3c4d5e6f7
Create Date: 2026-09-04 18:15:00.000000

Adds:
  - tasks.hold_reason (Text, nullable=True)
  - tasks.hold_until (Date, nullable=True)
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "h3c4d5e6f7g8"
down_revision: Union[str, None] = "g2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("tasks"):
        task_cols = [c["name"] for c in insp.get_columns("tasks")]
        if "hold_reason" not in task_cols:
            op.add_column("tasks", sa.Column("hold_reason", sa.Text(), nullable=True))
        if "hold_until" not in task_cols:
            op.add_column("tasks", sa.Column("hold_until", sa.Date(), nullable=True))
            op.create_index("ix_tasks_hold_until", "tasks", ["hold_until"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("tasks"):
        task_cols = [c["name"] for c in insp.get_columns("tasks")]
        if "hold_until" in task_cols:
            op.drop_index("ix_tasks_hold_until", table_name="tasks")
            op.drop_column("tasks", "hold_until")
        if "hold_reason" in task_cols:
            op.drop_column("tasks", "hold_reason")
