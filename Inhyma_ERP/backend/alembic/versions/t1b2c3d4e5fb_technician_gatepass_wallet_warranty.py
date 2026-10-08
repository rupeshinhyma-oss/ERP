"""technician_gatepass_wallet_warranty

Adds tables for:
- machine_warranties (Machine serial warranty lifecycle tracking)
- technician_gatepasses (Outward gatepass for spare parts taken out by technician)
- technician_gatepass_items (Items issued, consumed, and returned with SO reconciliation)
- technician_wallet_transactions (Technician cash collection and wallet balance ledger)

Revision ID: t1b2c3d4e5fb
Revises: s1b2c3d4e5fa
Create Date: 2026-10-08 12:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 't1b2c3d4e5fb'
down_revision: Union[str, None] = 's1b2c3d4e5fa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('machine_warranties'):
        op.create_table(
            'machine_warranties',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('serial_number', sa.String(100), unique=True, nullable=False),
            sa.Column('machine_model', sa.String(255), nullable=False),
            sa.Column('product_id', app.database.base.GUID(), sa.ForeignKey('products.id', ondelete='SET NULL'), nullable=True),
            sa.Column('company_name', sa.String(255), nullable=False),
            sa.Column('company_id', app.database.base.GUID(), nullable=True),
            sa.Column('invoice_number', sa.String(100), nullable=True),
            sa.Column('invoice_date', sa.Date(), nullable=False),
            sa.Column('warranty_months', sa.Integer(), server_default='12', nullable=False),
            sa.Column('warranty_end_date', sa.Date(), nullable=False),
            sa.Column('status', sa.String(50), server_default='UNDER_WARRANTY', nullable=False),
            sa.Column('contact_person', sa.String(150), nullable=True),
            sa.Column('contact_phone', sa.String(50), nullable=True),
            sa.Column('installation_city', sa.String(100), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index('ix_machine_warranties_serial', 'machine_warranties', ['serial_number'], unique=True)
        op.create_index('ix_machine_warranties_company', 'machine_warranties', ['company_name'], unique=False)

    if not insp.has_table('technician_gatepasses'):
        op.create_table(
            'technician_gatepasses',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('gatepass_number', sa.String(50), unique=True, nullable=False),
            sa.Column('technician_id', app.database.base.GUID(), sa.ForeignKey('technicians.id', ondelete='SET NULL'), nullable=True),
            sa.Column('technician_name', sa.String(150), nullable=False),
            sa.Column('technician_mobile', sa.String(50), nullable=True),
            sa.Column('technical_task_id', app.database.base.GUID(), sa.ForeignKey('technical_tasks.id', ondelete='SET NULL'), nullable=True),
            sa.Column('customer_name', sa.String(255), nullable=True),
            sa.Column('machine_serial_number', sa.String(100), nullable=True),
            sa.Column('is_warranty_service', sa.Boolean(), server_default='false', nullable=False),
            sa.Column('issue_date', sa.Date(), server_default=sa.func.current_date(), nullable=False),
            sa.Column('issued_by_name', sa.String(100), server_default='Warehouse', nullable=False),
            sa.Column('purpose', sa.String(150), server_default='Field Service Call', nullable=False),
            sa.Column('status', sa.String(50), server_default='ISSUED', nullable=False),
            sa.Column('so_required', sa.Boolean(), server_default='false', nullable=False),
            sa.Column('so_number', sa.String(100), nullable=True),
            sa.Column('so_created', sa.Boolean(), server_default='false', nullable=False),
            sa.Column('return_gatepass_number', sa.String(100), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index('ix_tech_gatepasses_number', 'technician_gatepasses', ['gatepass_number'], unique=True)
        op.create_index('ix_tech_gatepasses_tech_name', 'technician_gatepasses', ['technician_name'], unique=False)
        op.create_index('ix_tech_gatepasses_status', 'technician_gatepasses', ['status'], unique=False)

    if not insp.has_table('technician_gatepass_items'):
        op.create_table(
            'technician_gatepass_items',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('gatepass_id', app.database.base.GUID(), sa.ForeignKey('technician_gatepasses.id', ondelete='CASCADE'), nullable=False),
            sa.Column('product_id', app.database.base.GUID(), sa.ForeignKey('products.id', ondelete='SET NULL'), nullable=True),
            sa.Column('product_code', sa.String(50), nullable=True),
            sa.Column('product_name', sa.String(255), nullable=False),
            sa.Column('uom', sa.String(50), server_default='NOS', nullable=False),
            sa.Column('quantity_issued', sa.Numeric(12, 3), server_default='1.0', nullable=False),
            sa.Column('quantity_consumed', sa.Numeric(12, 3), server_default='0.0', nullable=False),
            sa.Column('quantity_returned', sa.Numeric(12, 3), server_default='0.0', nullable=False),
            sa.Column('unit_rate', sa.Numeric(14, 2), nullable=True),
            sa.Column('is_warranty_covered', sa.Boolean(), server_default='false', nullable=False),
            sa.Column('sales_order_number', sa.String(100), nullable=True),
            sa.Column('item_status', sa.String(50), server_default='ISSUED', nullable=False),
            sa.Column('remarks', sa.String(255), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        )
        op.create_index('ix_tech_gp_items_gatepass', 'technician_gatepass_items', ['gatepass_id'], unique=False)

    if not insp.has_table('technician_wallet_transactions'):
        op.create_table(
            'technician_wallet_transactions',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('transaction_number', sa.String(50), unique=True, nullable=False),
            sa.Column('technician_id', app.database.base.GUID(), sa.ForeignKey('technicians.id', ondelete='SET NULL'), nullable=True),
            sa.Column('technician_name', sa.String(150), nullable=False),
            sa.Column('technical_task_id', app.database.base.GUID(), sa.ForeignKey('technical_tasks.id', ondelete='SET NULL'), nullable=True),
            sa.Column('customer_name', sa.String(255), nullable=True),
            sa.Column('transaction_type', sa.String(50), nullable=False),
            sa.Column('amount', sa.Numeric(14, 2), nullable=False),
            sa.Column('payment_mode', sa.String(50), server_default='Cash', nullable=False),
            sa.Column('reference_no', sa.String(100), nullable=True),
            sa.Column('transaction_date', sa.Date(), server_default=sa.func.current_date(), nullable=False),
            sa.Column('receipt_url', sa.String(500), nullable=True),
            sa.Column('status', sa.String(50), server_default='VERIFIED', nullable=False),
            sa.Column('verified_by', sa.String(100), nullable=True),
            sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index('ix_tech_wallet_number', 'technician_wallet_transactions', ['transaction_number'], unique=True)
        op.create_index('ix_tech_wallet_tech_name', 'technician_wallet_transactions', ['technician_name'], unique=False)
        op.create_index('ix_tech_wallet_type', 'technician_wallet_transactions', ['transaction_type'], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table('technician_wallet_transactions'):
        op.drop_table('technician_wallet_transactions')
    if insp.has_table('technician_gatepass_items'):
        op.drop_table('technician_gatepass_items')
    if insp.has_table('technician_gatepasses'):
        op.drop_table('technician_gatepasses')
    if insp.has_table('machine_warranties'):
        op.drop_table('machine_warranties')
