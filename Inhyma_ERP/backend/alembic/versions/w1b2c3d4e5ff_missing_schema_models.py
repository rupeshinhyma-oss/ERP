"""missing_schema_models

Adds missing database tables and columns:
- products: product_type, applicable_machine_ids
- product_dimension_rows: package_name, net_weight, gross_weight
- product_machine_spares: mapping table linking spare parts to machines
- sales_order_items: serial_numbers (JSON)
- sales_orders: allocated_consignment (VARCHAR(100))
- gate_passes: full gate pass model
- price_lists: control panel price lists

Revision ID: w1b2c3d4e5ff
Revises: v1b2c3d4e5fe
Create Date: 2026-10-08 15:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.database.base

revision: str = 'w1b2c3d4e5ff'
down_revision: Union[str, None] = 'v1b2c3d4e5fe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1. products table columns
    if insp.has_table('products'):
        cols = {c['name'] for c in insp.get_columns('products')}
        if 'product_type' not in cols:
            op.add_column('products', sa.Column('product_type', sa.String(50), server_default='Machine', nullable=False))
            op.create_index('ix_products_product_type', 'products', ['product_type'])
        if 'applicable_machine_ids' not in cols:
            op.add_column('products', sa.Column('applicable_machine_ids', sa.JSON(), nullable=True))

    # 2. product_dimension_rows table columns
    if insp.has_table('product_dimension_rows'):
        dim_cols = {c['name'] for c in insp.get_columns('product_dimension_rows')}
        if 'package_name' not in dim_cols:
            op.add_column('product_dimension_rows', sa.Column('package_name', sa.String(255), nullable=True))
        if 'net_weight' not in dim_cols:
            op.add_column('product_dimension_rows', sa.Column('net_weight', sa.Numeric(12, 3), nullable=True))
        if 'gross_weight' not in dim_cols:
            op.add_column('product_dimension_rows', sa.Column('gross_weight', sa.Numeric(12, 3), nullable=True))

    # 3. product_machine_spares table
    if not insp.has_table('product_machine_spares'):
        op.create_table(
            'product_machine_spares',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('machine_id', app.database.base.GUID(), sa.ForeignKey('products.id', ondelete='CASCADE'), nullable=False),
            sa.Column('spare_part_id', app.database.base.GUID(), sa.ForeignKey('products.id', ondelete='CASCADE'), nullable=False),
            sa.Column('remarks', sa.String(255), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        )
        op.create_index('ix_product_machine_spares_machine', 'product_machine_spares', ['machine_id'])
        op.create_index('ix_product_machine_spares_spare', 'product_machine_spares', ['spare_part_id'])

    # 4. sales_order_items table columns
    if insp.has_table('sales_order_items'):
        so_item_cols = {c['name'] for c in insp.get_columns('sales_order_items')}
        if 'serial_numbers' not in so_item_cols:
            op.add_column('sales_order_items', sa.Column('serial_numbers', sa.JSON(), nullable=True))

    # 5. sales_orders table columns
    if insp.has_table('sales_orders'):
        so_cols = {c['name'] for c in insp.get_columns('sales_orders')}
        if 'allocated_consignment' not in so_cols:
            op.add_column('sales_orders', sa.Column('allocated_consignment', sa.String(100), nullable=True))

    # 6. gate_passes table
    if not insp.has_table('gate_passes'):
        op.create_table(
            'gate_passes',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('gatepass_no', sa.String(50), unique=True, nullable=False),
            sa.Column('gatepass_date', sa.Date(), server_default=sa.func.current_date(), nullable=False),
            sa.Column('so_id', app.database.base.GUID(), sa.ForeignKey('sales_orders.id', ondelete='SET NULL'), nullable=True),
            sa.Column('so_no', sa.String(100), nullable=True),
            sa.Column('so_date', sa.String(50), nullable=True),
            sa.Column('invoice_no', sa.String(100), nullable=True),
            sa.Column('invoice_date', sa.String(50), nullable=True),
            sa.Column('sales_person', sa.String(150), nullable=True),
            sa.Column('party_name', sa.String(255), nullable=False),
            sa.Column('billing_address', sa.Text(), nullable=True),
            sa.Column('shipping_address', sa.Text(), nullable=True),
            sa.Column('transport_name', sa.String(150), nullable=True),
            sa.Column('destination', sa.String(150), nullable=True),
            sa.Column('delivery_type', sa.String(50), server_default='Door', nullable=True),
            sa.Column('delivery_charges', sa.String(50), server_default='To Pay', nullable=True),
            sa.Column('handled_by', sa.String(150), nullable=True),
            sa.Column('remarks', sa.Text(), nullable=True),
            sa.Column('items', sa.JSON(), nullable=False),
            sa.Column('status', sa.String(50), server_default='ACTIVE', nullable=False),
            sa.Column('created_by', sa.String(150), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index('ix_gate_passes_no', 'gate_passes', ['gatepass_no'], unique=True)
        op.create_index('ix_gate_passes_so_id', 'gate_passes', ['so_id'])
        op.create_index('ix_gate_passes_party', 'gate_passes', ['party_name'])

    # 7. price_lists table
    if not insp.has_table('price_lists'):
        op.create_table(
            'price_lists',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('name', sa.String(150), nullable=False),
            sa.Column('code', sa.String(50), unique=True, nullable=False),
            sa.Column('currency', sa.String(10), server_default='INR', nullable=False),
            sa.Column('effective_from', sa.Date(), nullable=True),
            sa.Column('effective_to', sa.Date(), nullable=True),
            sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('items', sa.JSON(), nullable=False),
            sa.Column('created_by', sa.String(150), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index('ix_price_lists_code', 'price_lists', ['code'], unique=True)
        op.create_index('ix_price_lists_name', 'price_lists', ['name'])


def downgrade() -> None:
    pass
