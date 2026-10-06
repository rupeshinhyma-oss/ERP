"""merge_option_lists_and_leave_rules

Revision ID: ff2303e833bb
Revises: i1a2b3c4d5e6, k1a2b3c4d5ed
Create Date: 2026-10-03 13:06:28.626154

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ff2303e833bb'
down_revision = ('i1a2b3c4d5e6', 'k1a2b3c4d5ed')
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply this migration's schema changes."""
    pass


def downgrade() -> None:
    """Revert this migration's schema changes."""
    pass
