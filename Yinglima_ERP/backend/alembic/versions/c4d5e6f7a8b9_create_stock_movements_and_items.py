"""create_stock_movements_and_items

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-10-21 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'c4d5e6f7a8b9'
down_revision = 'b3c4d5e6f7a8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create stock_movements table
    op.execute("""
    CREATE TABLE IF NOT EXISTS stock_movements (
        id UUID PRIMARY KEY,
        movement_no VARCHAR(50) UNIQUE NOT NULL,
        movement_type VARCHAR(20) NOT NULL,
        movement_date DATE NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'confirmed',
        source_type VARCHAR(30) NOT NULL DEFAULT 'direct',
        purchase_id UUID REFERENCES local_purchases(id) ON DELETE SET NULL,
        purchase_invoice_no VARCHAR(100),
        sale_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
        sale_order_no VARCHAR(100),
        supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
        supplier_name VARCHAR(200),
        buyer_id UUID REFERENCES buyers(id) ON DELETE SET NULL,
        buyer_name VARCHAR(200),
        reference_no VARCHAR(100),
        warehouse_location VARCHAR(150),
        vehicle_no VARCHAR(100),
        transporter_name VARCHAR(150),
        container_no VARCHAR(100),
        total_quantity NUMERIC(14, 2) NOT NULL DEFAULT 0.0,
        total_items_count INT NOT NULL DEFAULT 0,
        remarks TEXT,
        created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_by_name VARCHAR(150),
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_stock_movements_movement_no ON stock_movements(movement_no)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_stock_movements_movement_type ON stock_movements(movement_type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_stock_movements_movement_date ON stock_movements(movement_date)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_stock_movements_purchase_id ON stock_movements(purchase_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_stock_movements_sale_order_id ON stock_movements(sale_order_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_stock_movements_supplier_id ON stock_movements(supplier_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_stock_movements_buyer_id ON stock_movements(buyer_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_stock_movements_status ON stock_movements(status)")

    # 2. Create stock_movement_items table
    op.execute("""
    CREATE TABLE IF NOT EXISTS stock_movement_items (
        id UUID PRIMARY KEY,
        movement_id UUID NOT NULL REFERENCES stock_movements(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id) ON DELETE SET NULL,
        product_name VARCHAR(255) NOT NULL,
        product_code VARCHAR(100),
        expected_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0.0,
        quantity NUMERIC(12, 2) NOT NULL DEFAULT 0.0,
        damaged_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0.0,
        accepted_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0.0,
        unit_rate NUMERIC(15, 2) NOT NULL DEFAULT 0.0,
        package_details VARCHAR(150),
        remarks TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_stock_movement_items_movement_id ON stock_movement_items(movement_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_stock_movement_items_product_id ON stock_movement_items(product_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS stock_movement_items")
    op.execute("DROP TABLE IF EXISTS stock_movements")
