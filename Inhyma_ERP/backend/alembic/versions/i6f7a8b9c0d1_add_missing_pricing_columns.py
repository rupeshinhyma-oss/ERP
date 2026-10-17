"""add model columns that never had a migration (products.minimum_price, supplier_product_links pricing)

Revision ID: i6f7a8b9c0d1
Revises: h5e6f7a8b9c0
Create Date: 2026-10-12 18:00:00.000000

The models declare these columns, but no migration ever created them, so a database built only by migrations
was missing them (price-list / supplier-link queries would fail with "column does not exist").  Every statement
is IF NOT EXISTS, so it is a harmless no-op on databases that already have the columns (for example ones that were
altered by hand).  The downgrade is intentionally empty: these columns may hold real data that predates this
migration, and a repair migration must never delete it.
"""
from alembic import op

revision = "i6f7a8b9c0d1"
down_revision = "h5e6f7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS minimum_price NUMERIC(14, 2)")
    op.execute("ALTER TABLE supplier_product_links ADD COLUMN IF NOT EXISTS unit_price NUMERIC(14, 2)")
    op.execute("ALTER TABLE supplier_product_links ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'INR'")
    op.execute("ALTER TABLE supplier_product_links ADD COLUMN IF NOT EXISTS moq NUMERIC(12, 3)")
    op.execute("ALTER TABLE supplier_product_links ADD COLUMN IF NOT EXISTS notes TEXT")
    op.execute(
        "ALTER TABLE supplier_product_links "
        "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()"
    )


def downgrade() -> None:
    pass
