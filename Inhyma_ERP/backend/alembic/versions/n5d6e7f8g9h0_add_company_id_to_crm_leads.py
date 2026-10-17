"""add_company_id_to_crm_leads

Revision ID: n5d6e7f8g9h0
Revises: m4c5d6e7f8g9
Create Date: 2026-10-16 17:05:00.000000

Adds nullable foreign key company_id from crm_leads to companies.id,
with index and ON DELETE SET NULL constraint.
Preserves existing company_name VARCHAR(200) column for backward-compatibility.
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from app.database.base import GUID


# revision identifiers, used by Alembic.
revision: str = "n5d6e7f8g9h0"
down_revision: Union[str, None] = "m4c5d6e7f8g9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add nullable company_id column to crm_leads
    op.add_column(
        "crm_leads",
        sa.Column(
            "company_id",
            GUID(),
            sa.ForeignKey("companies.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # 2. Create index on company_id
    op.create_index(
        "ix_crm_leads_company_id",
        "crm_leads",
        ["company_id"],
        unique=False,
    )


def downgrade() -> None:
    # 1. Drop index
    op.drop_index("ix_crm_leads_company_id", table_name="crm_leads")

    # 2. Drop column
    op.drop_column("crm_leads", "company_id")
