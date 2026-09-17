"""merge_heads_f9a_and_g6a

Revision ID: ac0d0f6dc577
Revises: f9a0b1c2d3e4, g6a7b8c9d0e1
Create Date: 2026-09-17 13:32:55.118753

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ac0d0f6dc577'
down_revision = ('f9a0b1c2d3e4', 'g6a7b8c9d0e1')
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply this migration's schema changes."""
    pass


def downgrade() -> None:
    """Revert this migration's schema changes."""
    pass
