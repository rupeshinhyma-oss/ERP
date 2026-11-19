"""merge_crm_phase2_and_technician_dept_heads

Revision ID: z3b4c5d6e7f8
Revises: w0a1b2c3d4e5, z2a3b4c5d6e7
Create Date: 2026-11-18 17:06:39.485760

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'z3b4c5d6e7f8'
down_revision = ('w0a1b2c3d4e5', 'z2a3b4c5d6e7')
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply this migration's schema changes."""
    pass


def downgrade() -> None:
    """Revert this migration's schema changes."""
    pass
