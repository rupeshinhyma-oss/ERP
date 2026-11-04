"""create warehouses table and seed defaults

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-10-31 15:30:00.000000

Creates the warehouses table and seeds default warehouses:
- Main Godown
- Factory Staging Yard
- Transit Bay
- Customs Bonded Area
"""
import uuid
from datetime import datetime, timezone
from alembic import op
import sqlalchemy as sa


revision = 'f7a8b9c0d1e2'
down_revision = 'e6f7a8b9c0d1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if not inspector.has_table('warehouses'):
        warehouses_table = op.create_table(
            'warehouses',
            sa.Column('id', sa.UUID(), nullable=False),
            sa.Column('name', sa.String(length=150), nullable=False),
            sa.Column('code', sa.String(length=50), nullable=False),
            sa.Column('location', sa.String(length=200), nullable=True),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('status', sa.Enum('active', 'inactive', name='warehouse_status', native_enum=False, length=20), nullable=False, server_default='active'),
            sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('code'),
            sa.UniqueConstraint('name'),
        )
        op.create_index('ix_warehouses_code', 'warehouses', ['code'], unique=True)
        op.create_index('ix_warehouses_name', 'warehouses', ['name'], unique=True)
        op.create_index('ix_warehouses_status', 'warehouses', ['status'], unique=False)

        now = datetime.now(timezone.utc)
        op.bulk_insert(
            warehouses_table,
            [
                {
                    'id': uuid.uuid4(),
                    'name': 'Main Godown',
                    'code': 'WH-MAINGODOWN',
                    'location': 'Primary Storage Facility',
                    'description': 'Primary warehouse / godown for inward receipts and outward dispatches',
                    'status': 'ACTIVE',
                    'version': 1,
                    'created_at': now,
                    'updated_at': now,
                    'deleted_at': None,
                },
                {
                    'id': uuid.uuid4(),
                    'name': 'Factory Staging Yard',
                    'code': 'WH-FACTORYSTAG',
                    'location': 'Factory Floor / Loading Bay',
                    'description': 'Staging yard for supplier inward inspection and container loading',
                    'status': 'ACTIVE',
                    'version': 1,
                    'created_at': now,
                    'updated_at': now,
                    'deleted_at': None,
                },
                {
                    'id': uuid.uuid4(),
                    'name': 'Transit Bay',
                    'code': 'WH-TRANSITBAY',
                    'location': 'Port / Consolidation Hub',
                    'description': 'Intermediate transit bay for consolidation prior to container dispatch',
                    'status': 'ACTIVE',
                    'version': 1,
                    'created_at': now,
                    'updated_at': now,
                    'deleted_at': None,
                },
                {
                    'id': uuid.uuid4(),
                    'name': 'Customs Bonded Area',
                    'code': 'WH-CUSTOMSBOND',
                    'location': 'Port Customs Bonded Zone',
                    'description': 'Customs bonded storage area for export / import clearance',
                    'status': 'ACTIVE',
                    'version': 1,
                    'created_at': now,
                    'updated_at': now,
                    'deleted_at': None,
                },
            ],
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if inspector.has_table('warehouses'):
        op.drop_index('ix_warehouses_status', table_name='warehouses')
        op.drop_index('ix_warehouses_name', table_name='warehouses')
        op.drop_index('ix_warehouses_code', table_name='warehouses')
        op.drop_table('warehouses')

