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
    """Apply this migration's schema changes (creating local_purchases tables if absent on fresh DB)."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS local_purchases (
            id UUID PRIMARY KEY,
            organization_id UUID REFERENCES master_companies(id) ON DELETE SET NULL,
            organization_name VARCHAR(200),
            branch_id VARCHAR(100),
            branch_name VARCHAR(150),
            group_label VARCHAR(50),
            consignment_code VARCHAR(100),
            planning_sheet_id UUID REFERENCES planning_sheets(id) ON DELETE SET NULL,
            planning_column_id UUID REFERENCES planning_columns(id) ON DELETE SET NULL,
            supplier_id UUID NOT NULL REFERENCES suppliers(id),
            supplier_name VARCHAR(200) NOT NULL,
            invoice_no VARCHAR(100) NOT NULL,
            invoice_date DATE NOT NULL,
            currency VARCHAR(10) NOT NULL DEFAULT 'RMB',
            invoice_total_value NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
            bill_file_url TEXT,
            packing_forwarding NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            transport_expense NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            offloading_expense NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            other_expense NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            total_expenses NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
            loading_expense_pct NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
            items_total_basic NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
            items_total_vat NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
            items_total_landing NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
            total_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            remarks TEXT,
            status VARCHAR(30) NOT NULL DEFAULT 'Pending',
            created_by_id UUID REFERENCES users(id),
            created_by_name VARCHAR(150),
            deleted_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS local_purchase_items (
            id UUID PRIMARY KEY,
            purchase_id UUID NOT NULL REFERENCES local_purchases(id) ON DELETE CASCADE,
            product_id UUID REFERENCES products(id) ON DELETE SET NULL,
            product_name VARCHAR(255) NOT NULL,
            product_code VARCHAR(100),
            hsn_code VARCHAR(50),
            quantity NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            unit_rate NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
            vat_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
            item_total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
            vat_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
            expense_per_unit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            unit_landing_rate NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
            total_landing_rate NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_local_purchases_supplier_id ON local_purchases (supplier_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_local_purchases_invoice_no ON local_purchases (invoice_no)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_local_purchases_status ON local_purchases (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_local_purchase_items_purchase_id ON local_purchase_items (purchase_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_local_purchase_items_product_id ON local_purchase_items (product_id)")

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
