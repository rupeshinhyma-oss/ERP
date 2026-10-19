"""drop_town_from_suppliers

Revision ID: 86ea2b62aa9c
Revises: 41a972a6d3d4
Create Date: 2026-10-14 15:00:00.516901

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '86ea2b62aa9c'
down_revision = '41a972a6d3d4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply this migration's schema changes."""
    op.execute("ALTER TABLE suppliers DROP COLUMN IF EXISTS town")


def downgrade() -> None:
    """Revert this migration's schema changes."""
    op.add_column('suppliers', sa.Column('town', sa.String(length=150), nullable=True))
