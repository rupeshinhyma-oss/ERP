"""add_state_id_to_buyers

Revision ID: 7a8b9c0d1e2f
Revises: 86ea2b62aa9c
Create Date: 2026-10-15 11:35:00.000000

"""
from alembic import op
import sqlalchemy as sa
from app.database.base import GUID


# revision identifiers, used by Alembic.
revision = '7a8b9c0d1e2f'
down_revision = '86ea2b62aa9c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply this migration's schema changes."""
    op.execute("ALTER TABLE buyers ADD COLUMN IF NOT EXISTS state_id UUID REFERENCES states(id) ON DELETE RESTRICT")
    op.execute("CREATE INDEX IF NOT EXISTS ix_buyers_state_id ON buyers (state_id)")


def downgrade() -> None:
    """Revert this migration's schema changes."""
    op.execute("DROP INDEX IF EXISTS ix_buyers_state_id")
    op.execute("ALTER TABLE buyers DROP COLUMN IF EXISTS state_id")
