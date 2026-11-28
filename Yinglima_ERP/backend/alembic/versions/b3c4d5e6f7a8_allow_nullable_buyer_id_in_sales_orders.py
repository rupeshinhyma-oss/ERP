"""allow_nullable_buyer_id_in_sales_orders

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-10-21 11:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'b3c4d5e6f7a8'
down_revision = 'a2b3c4d5e6f7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Ensure sales_orders and sales_order_items exist on a fresh database
    # (historically created via Base.metadata.create_all() before this migration).
    op.execute("""
    CREATE TABLE IF NOT EXISTS sales_orders (
        id UUID PRIMARY KEY,
        order_no VARCHAR(100) UNIQUE NOT NULL,
        organization_id UUID NOT NULL REFERENCES master_companies(id),
        organization_name VARCHAR(150) NOT NULL DEFAULT 'Yinglima',
        buyer_id UUID REFERENCES buyers(id) ON DELETE SET NULL,
        buyer_name VARCHAR(200) NOT NULL,
        buyer_branch_id VARCHAR(100),
        buyer_branch_name VARCHAR(150),
        consignment_code VARCHAR(100),
        planning_sheet_id UUID REFERENCES planning_sheets(id),
        planning_column_id UUID REFERENCES planning_columns(id),
        order_date DATE NOT NULL,
        delivery_date DATE,
        currency VARCHAR(10) NOT NULL DEFAULT 'RMB',
        status VARCHAR(30) NOT NULL DEFAULT 'pending',
        total_basic NUMERIC(15, 2) NOT NULL DEFAULT 0.0,
        total_tax NUMERIC(15, 2) NOT NULL DEFAULT 0.0,
        total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.0,
        total_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0.0,
        container_no VARCHAR(100),
        bl_no VARCHAR(100),
        lr_no VARCHAR(100),
        transporter_name VARCHAR(150),
        port_of_loading VARCHAR(100),
        port_of_discharge VARCHAR(100),
        ocean_freight_usd NUMERIC(15, 2) NOT NULL DEFAULT 0.0,
        local_charges_coc_usd NUMERIC(15, 2) NOT NULL DEFAULT 0.0,
        usd_exchange_rate NUMERIC(8, 4) NOT NULL DEFAULT 6.70,
        profit_percent NUMERIC(6, 2) NOT NULL DEFAULT 3.0,
        total_container_cbm NUMERIC(12, 4) NOT NULL DEFAULT 0.0,
        remarks TEXT,
        created_by_id UUID REFERENCES users(id),
        created_by_name VARCHAR(150),
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_sales_orders_order_no ON sales_orders(order_no)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_sales_orders_organization_id ON sales_orders(organization_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_sales_orders_buyer_id ON sales_orders(buyer_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_sales_orders_consignment_code ON sales_orders(consignment_code)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_sales_orders_status ON sales_orders(status)")

    op.execute("""
    CREATE TABLE IF NOT EXISTS sales_order_items (
        id UUID PRIMARY KEY,
        order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        product_name VARCHAR(255) NOT NULL,
        product_code VARCHAR(100),
        hsn_code VARCHAR(50),
        quantity NUMERIC(12, 2) NOT NULL DEFAULT 1.0,
        unit_rate NUMERIC(15, 2) NOT NULL DEFAULT 0.0,
        tax_percent NUMERIC(6, 2) NOT NULL DEFAULT 0.0,
        tax_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.0,
        item_total NUMERIC(15, 2) NOT NULL DEFAULT 0.0,
        supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
        supplier_name VARCHAR(150),
        unit_price_rmb_with_vat NUMERIC(15, 2) NOT NULL DEFAULT 0.0,
        unit_price_rmb_ex_vat NUMERIC(15, 2) NOT NULL DEFAULT 0.0,
        profit_percent NUMERIC(6, 2) NOT NULL DEFAULT 3.0,
        fob_price_usd NUMERIC(15, 4) NOT NULL DEFAULT 0.0,
        freight_unit_usd NUMERIC(15, 4) NOT NULL DEFAULT 0.0,
        cfr_price_usd NUMERIC(15, 2) NOT NULL DEFAULT 0.0,
        cbm_per_unit NUMERIC(12, 6) NOT NULL DEFAULT 0.0,
        total_cbm NUMERIC(12, 4) NOT NULL DEFAULT 0.0,
        total_supplier_amount_rmb NUMERIC(15, 2) NOT NULL DEFAULT 0.0,
        planning_row_id UUID REFERENCES planning_rows(id),
        remarks TEXT,
        is_spare BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_sales_order_items_order_id ON sales_order_items(order_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_sales_order_items_product_id ON sales_order_items(product_id)")

    op.execute("ALTER TABLE sales_orders ALTER COLUMN buyer_id DROP NOT NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE sales_orders ALTER COLUMN buyer_id SET NOT NULL")
