"""merge_crm_foundation_and_missing_schema_models

Revision ID: h5e6f7a8b9c0
Revises: g4e5f6a7b8c9, w1b2c3d4e5ff
Create Date: 2026-10-12 15:30:56.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'h5e6f7a8b9c0'
down_revision = ('g4e5f6a7b8c9', 'w1b2c3d4e5ff')
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply this migration's schema changes."""
    pass


def downgrade() -> None:
    """Revert this migration's schema changes."""
    pass
