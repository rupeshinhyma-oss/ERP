"""add_created_by_id_to_buyers

Revision ID: 8b9c0d1e2f3a
Revises: 7a8b9c0d1e2f
Create Date: 2026-10-15 18:30:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '8b9c0d1e2f3a'
down_revision = '7a8b9c0d1e2f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply this migration's schema changes."""
    op.execute("ALTER TABLE buyers ADD COLUMN IF NOT EXISTS created_by_id UUID REFERENCES users(id) ON DELETE SET NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_buyers_created_by_id ON buyers (created_by_id)")
    # Buyers that existed before this change were all added by the admin user.
    op.execute(
        """
        UPDATE buyers
        SET created_by_id = (SELECT id FROM users WHERE lower(username) = 'admin' LIMIT 1)
        WHERE created_by_id IS NULL
        """
    )


def downgrade() -> None:
    """Revert this migration's schema changes."""
    op.execute("DROP INDEX IF EXISTS ix_buyers_created_by_id")
    op.execute("ALTER TABLE buyers DROP COLUMN IF EXISTS created_by_id")
