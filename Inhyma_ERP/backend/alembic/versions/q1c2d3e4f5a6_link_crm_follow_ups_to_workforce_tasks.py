"""link_crm_follow_ups_to_workforce_tasks

Revision ID: q1c2d3e4f5a6
Revises: p6e7f8g9h0i1
Create Date: 2026-10-21 15:30:00.000000

Adds task_id foreign key column to crm_follow_ups table linking to tasks.id.
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from app.database.base import GUID

# revision identifiers, used by Alembic.
revision: str = "q1c2d3e4f5a6"
down_revision: Union[str, None] = "p6e7f8g9h0i1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c["name"] for c in insp.get_columns("crm_follow_ups")]
    if "task_id" not in cols:
        op.add_column(
            "crm_follow_ups",
            sa.Column(
                "task_id",
                GUID(),
                sa.ForeignKey("tasks.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index("ix_crm_follow_ups_task_id", "crm_follow_ups", ["task_id"])


def downgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c["name"] for c in insp.get_columns("crm_follow_ups")]
    if "task_id" in cols:
        op.drop_index("ix_crm_follow_ups_task_id", table_name="crm_follow_ups")
        op.drop_column("crm_follow_ups", "task_id")
