"""add_consignment_and_organization_to_local_purchases

Revision ID: 9c0d1e2f3a4b
Revises: 8b9c0d1e2f3a
Create Date: 2026-10-16 16:02:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '9c0d1e2f3a4b'
down_revision = '8b9c0d1e2f3a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply this migration's schema changes."""
    op.execute("ALTER TABLE local_purchases ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES master_companies(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE local_purchases ADD COLUMN IF NOT EXISTS organization_name VARCHAR(200)")
    op.execute("ALTER TABLE local_purchases ADD COLUMN IF NOT EXISTS branch_id VARCHAR(100)")
    op.execute("ALTER TABLE local_purchases ADD COLUMN IF NOT EXISTS branch_name VARCHAR(150)")
    op.execute("ALTER TABLE local_purchases ADD COLUMN IF NOT EXISTS group_label VARCHAR(50)")
    op.execute("ALTER TABLE local_purchases ADD COLUMN IF NOT EXISTS consignment_code VARCHAR(100)")
    op.execute("ALTER TABLE local_purchases ADD COLUMN IF NOT EXISTS planning_sheet_id UUID REFERENCES planning_sheets(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE local_purchases ADD COLUMN IF NOT EXISTS planning_column_id UUID REFERENCES planning_columns(id) ON DELETE SET NULL")

    op.execute("CREATE INDEX IF NOT EXISTS ix_local_purchases_org_id ON local_purchases (organization_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_local_purchases_planning_sheet_id ON local_purchases (planning_sheet_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_local_purchases_planning_column_id ON local_purchases (planning_column_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_local_purchases_consignment_code ON local_purchases (consignment_code)")


def downgrade() -> None:
    """Revert this migration's schema changes."""
    op.execute("DROP INDEX IF EXISTS ix_local_purchases_consignment_code")
    op.execute("DROP INDEX IF EXISTS ix_local_purchases_planning_column_id")
    op.execute("DROP INDEX IF EXISTS ix_local_purchases_planning_sheet_id")
    op.execute("DROP INDEX IF EXISTS ix_local_purchases_org_id")

    op.execute("ALTER TABLE local_purchases DROP COLUMN IF EXISTS planning_column_id")
    op.execute("ALTER TABLE local_purchases DROP COLUMN IF EXISTS planning_sheet_id")
    op.execute("ALTER TABLE local_purchases DROP COLUMN IF EXISTS consignment_code")
    op.execute("ALTER TABLE local_purchases DROP COLUMN IF EXISTS group_label")
    op.execute("ALTER TABLE local_purchases DROP COLUMN IF EXISTS branch_name")
    op.execute("ALTER TABLE local_purchases DROP COLUMN IF EXISTS branch_id")
    op.execute("ALTER TABLE local_purchases DROP COLUMN IF EXISTS organization_name")
    op.execute("ALTER TABLE local_purchases DROP COLUMN IF EXISTS organization_id")
