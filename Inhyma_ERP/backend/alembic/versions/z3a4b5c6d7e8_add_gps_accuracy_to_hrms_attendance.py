"""add_gps_accuracy_to_hrms_attendance

Adds punch_in_accuracy_meters and punch_out_accuracy_meters to hrms_attendance table.

Revision ID: z3a4b5c6d7e8
Revises: z2f3a4b5c6d7
Create Date: 2026-10-31 13:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "z3a4b5c6d7e8"
down_revision: Union[str, None] = "z2f3a4b5c6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("hrms_attendance"):
        cols = {c["name"]: c for c in insp.get_columns("hrms_attendance")}
        if "punch_in_accuracy_meters" not in cols:
            op.add_column(
                "hrms_attendance",
                sa.Column("punch_in_accuracy_meters", sa.Float(), nullable=True),
            )
        if "punch_out_accuracy_meters" not in cols:
            op.add_column(
                "hrms_attendance",
                sa.Column("punch_out_accuracy_meters", sa.Float(), nullable=True),
            )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("hrms_attendance"):
        cols = {c["name"]: c for c in insp.get_columns("hrms_attendance")}
        if "punch_out_accuracy_meters" in cols:
            op.drop_column("hrms_attendance", "punch_out_accuracy_meters")
        if "punch_in_accuracy_meters" in cols:
            op.drop_column("hrms_attendance", "punch_in_accuracy_meters")

