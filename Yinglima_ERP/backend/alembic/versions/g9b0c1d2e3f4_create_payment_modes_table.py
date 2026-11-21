"""Create payment_modes table

Revision ID: g9b0c1d2e3f4
Revises: f8a9b0c1d2e3
Create Date: 2026-11-19 16:30:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "g9b0c1d2e3f4"
down_revision: Union[str, None] = "f8a9b0c1d2e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    if "payment_modes" not in existing_tables:
        op.create_table(
            "payment_modes",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("name", sa.String(length=150), nullable=False),
            sa.Column("code", sa.String(length=50), nullable=False),
            sa.Column("account_type", sa.String(length=80), nullable=True),
            sa.Column("currency_code", sa.String(length=20), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("name", name="uq_payment_modes_name"),
            sa.UniqueConstraint("code", name="uq_payment_modes_code"),
        )
        op.create_index("ix_payment_modes_name", "payment_modes", ["name"])
        op.create_index("ix_payment_modes_code", "payment_modes", ["code"])
        op.create_index("ix_payment_modes_status", "payment_modes", ["status"])
        op.create_index("ix_payment_modes_deleted_at", "payment_modes", ["deleted_at"])


def downgrade() -> None:
    op.drop_table("payment_modes")
