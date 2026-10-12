"""merge_hrms_and_purchase_company_heads

Revision ID: caf675d2d5ef
Revises: d1c2d3e4f5b0, o1a2b3c4d5ec
Create Date: 2026-10-06 17:52:09.647660

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'caf675d2d5ef'
down_revision = ('d1c2d3e4f5b0', 'o1a2b3c4d5ec')
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply this migration's schema changes."""
    pass


def downgrade() -> None:
    """Revert this migration's schema changes."""
    pass
