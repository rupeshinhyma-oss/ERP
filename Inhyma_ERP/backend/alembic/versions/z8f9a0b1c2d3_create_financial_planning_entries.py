"""create_financial_planning_entries

Creates the financial_planning_entries persistent overlay table used by the
Financial Planning Report module to store payment terms, due-date overrides,
attached invoices/vouchers, and recorded settlement ledger entries on top of
confirmed Import Purchase, Local Purchase, and Acc. Confirmed Sales Process
records.

Revision ID: z8f9a0b1c2d3
Revises: z7e8f9a0b1c2
Create Date: 2026-11-04 13:15:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.database.base

revision: str = "z8f9a0b1c2d3"
down_revision: Union[str, None] = "z7e8f9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if "financial_planning_entries" not in tables:
        op.create_table(
            "financial_planning_entries",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("entry_key", sa.String(length=160), nullable=False),
            sa.Column("source_module", sa.String(length=50), nullable=False),
            sa.Column("source_record_id", app.database.base.GUID(), nullable=False),
            sa.Column("paid_amount", sa.Float(), server_default="0", nullable=False),
            sa.Column("payment_terms_override", sa.String(length=150), nullable=True),
            sa.Column("due_date_override", sa.String(length=50), nullable=True),
            sa.Column("invoice_attachment_url", sa.String(length=500), nullable=True),
            sa.Column("invoice_attachment_name", sa.String(length=255), nullable=True),
            sa.Column("payment_attachment_url", sa.String(length=500), nullable=True),
            sa.Column("payment_attachment_name", sa.String(length=255), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("payments_history", sa.JSON(), nullable=True),
            sa.Column("updated_by_name", sa.String(length=150), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("entry_key", name="uq_financial_planning_entries_entry_key"),
        )
        op.create_index(
            "ix_financial_planning_entries_entry_key",
            "financial_planning_entries",
            ["entry_key"],
            unique=True,
        )
        op.create_index(
            "ix_financial_planning_entries_source_module",
            "financial_planning_entries",
            ["source_module"],
            unique=False,
        )
        op.create_index(
            "ix_financial_planning_entries_source_record_id",
            "financial_planning_entries",
            ["source_record_id"],
            unique=False,
        )
        op.create_index(
            "ix_financial_planning_entries_deleted_at",
            "financial_planning_entries",
            ["deleted_at"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if "financial_planning_entries" in tables:
        op.drop_table("financial_planning_entries")

