"""merge_inventory_and_crm_heads

Revision ID: d32a657d3f2f
Revises: m9c0d1e2f3a4, q2c3d4e5f6a7
Create Date: 2026-10-23 12:03:19.139135

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd32a657d3f2f'
down_revision = ('m9c0d1e2f3a4', 'q2c3d4e5f6a7')
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply this migration's schema changes."""
    pass


def downgrade() -> None:
    """Revert this migration's schema changes."""
    pass
