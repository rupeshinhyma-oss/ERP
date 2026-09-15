"""create_warehouses_table

Revision ID: v2d3e4f5g6h7
Revises: u1c2d3e4f5g6
Create Date: 2026-09-15 11:48:00.000000

"""
import uuid
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'v2d3e4f5g6h7'
down_revision: Union[str, None] = 'u1c2d3e4f5g6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create warehouses table and seed 9 initial records."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('warehouses'):
        op.create_table(
            'warehouses',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('name', sa.String(100), nullable=False),
            sa.Column('address', sa.Text(), nullable=False),
            sa.Column('billing_company', sa.String(150), nullable=False),
            sa.Column('over_selling', sa.Boolean(), server_default=sa.text('false'), nullable=False),
            sa.Column('is_primary', sa.Boolean(), server_default=sa.text('false'), nullable=False),
            sa.Column('main_warehouse_id', app.database.base.GUID(), sa.ForeignKey('warehouses.id', ondelete='SET NULL'), nullable=True),
            sa.Column('color', sa.String(20), server_default='#2563EB', nullable=False),
            sa.Column('status', sa.String(20), server_default='ACTIVE', nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        )
        op.create_index('ix_warehouses_name', 'warehouses', ['name'], unique=True)
        op.create_index('ix_warehouses_billing_company', 'warehouses', ['billing_company'])
        op.create_index('ix_warehouses_main_warehouse_id', 'warehouses', ['main_warehouse_id'])
        op.create_index('ix_warehouses_status', 'warehouses', ['status'])

        warehouses_table = sa.table(
            'warehouses',
            sa.column('id', app.database.base.GUID()),
            sa.column('name', sa.String()),
            sa.column('address', sa.Text()),
            sa.column('billing_company', sa.String()),
            sa.column('over_selling', sa.Boolean()),
            sa.column('is_primary', sa.Boolean()),
            sa.column('main_warehouse_id', app.database.base.GUID()),
            sa.column('color', sa.String()),
            sa.column('status', sa.String()),
            sa.column('version', sa.Integer()),
        )

        mumbai_id = uuid.uuid4()
        ahmedabad_id = uuid.uuid4()
        indore_id = uuid.uuid4()

        initial_warehouses = [
            # Primary Warehouses
            {
                "id": mumbai_id,
                "name": "Mumbai",
                "address": "Mumbai Main Logistics Hub, Maharashtra",
                "billing_company": "INHYMA SOLUTIONS LLP (M)",
                "over_selling": False,
                "is_primary": True,
                "main_warehouse_id": None,
                "color": "#2563EB",
                "status": "ACTIVE",
                "version": 1,
            },
            {
                "id": ahmedabad_id,
                "name": "Ahmedabad",
                "address": "Ahmedabad Central Warehouse, Gujarat",
                "billing_company": "INHYMA SOLUTIONS LLP (G)",
                "over_selling": False,
                "is_primary": True,
                "main_warehouse_id": None,
                "color": "#3B82F6",
                "status": "ACTIVE",
                "version": 1,
            },
            {
                "id": indore_id,
                "name": "Indore",
                "address": "Indore Central Warehouse, Madhya Pradesh",
                "billing_company": "INHYMA SOLUTIONS LLP (MP)",
                "over_selling": False,
                "is_primary": True,
                "main_warehouse_id": None,
                "color": "#6366F1",
                "status": "ACTIVE",
                "version": 1,
            },
            # Secondary / Transit / Ordered Warehouses
            {
                "id": uuid.uuid4(),
                "name": "Mumbai Transit",
                "address": "Mumbai Transit Facility, Maharashtra",
                "billing_company": "INHYMA SOLUTIONS LLP (M)",
                "over_selling": True,
                "is_primary": False,
                "main_warehouse_id": mumbai_id,
                "color": "#F59E0B",
                "status": "ACTIVE",
                "version": 1,
            },
            {
                "id": uuid.uuid4(),
                "name": "Mumbai Ordered",
                "address": "Mumbai Inbound Hub, Maharashtra",
                "billing_company": "INHYMA SOLUTIONS LLP (M)",
                "over_selling": True,
                "is_primary": False,
                "main_warehouse_id": mumbai_id,
                "color": "#10B981",
                "status": "ACTIVE",
                "version": 1,
            },
            {
                "id": uuid.uuid4(),
                "name": "Ahmedabad Transit",
                "address": "Ahmedabad Transit Depot, Gujarat",
                "billing_company": "INHYMA SOLUTIONS LLP (G)",
                "over_selling": True,
                "is_primary": False,
                "main_warehouse_id": ahmedabad_id,
                "color": "#F59E0B",
                "status": "ACTIVE",
                "version": 1,
            },
            {
                "id": uuid.uuid4(),
                "name": "Ahmedabad Ordered",
                "address": "Ahmedabad Inbound Staging, Gujarat",
                "billing_company": "INHYMA SOLUTIONS LLP (G)",
                "over_selling": True,
                "is_primary": False,
                "main_warehouse_id": ahmedabad_id,
                "color": "#10B981",
                "status": "ACTIVE",
                "version": 1,
            },
            {
                "id": uuid.uuid4(),
                "name": "Indore Transit",
                "address": "Indore Transit Depot, Madhya Pradesh",
                "billing_company": "INHYMA SOLUTIONS LLP (MP)",
                "over_selling": True,
                "is_primary": False,
                "main_warehouse_id": indore_id,
                "color": "#F59E0B",
                "status": "ACTIVE",
                "version": 1,
            },
            {
                "id": uuid.uuid4(),
                "name": "Indore Ordered",
                "address": "Indore Inbound Staging, Madhya Pradesh",
                "billing_company": "INHYMA SOLUTIONS LLP (MP)",
                "over_selling": True,
                "is_primary": False,
                "main_warehouse_id": indore_id,
                "color": "#10B981",
                "status": "ACTIVE",
                "version": 1,
            },
        ]
        op.bulk_insert(warehouses_table, initial_warehouses)


def downgrade() -> None:
    """Drop warehouses table."""
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table('warehouses'):
        op.drop_index('ix_warehouses_status', table_name='warehouses')
        op.drop_index('ix_warehouses_main_warehouse_id', table_name='warehouses')
        op.drop_index('ix_warehouses_billing_company', table_name='warehouses')
        op.drop_index('ix_warehouses_name', table_name='warehouses')
        op.drop_table('warehouses')
