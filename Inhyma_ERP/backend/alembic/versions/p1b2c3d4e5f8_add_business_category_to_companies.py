"""add_business_category_to_companies

Revision ID: p1b2c3d4e5f8
Revises: caf675d2d5ef
Create Date: 2026-10-07 11:55:00.000000

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = 'p1b2c3d4e5f8'
down_revision: Union[str, None] = 'caf675d2d5ef'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("companies")}
    if "business_category" not in cols:
        op.add_column("companies", sa.Column("business_category", sa.String(100), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("companies")}
    if "business_category" in cols:
        op.drop_column("companies", "business_category")
