"""create_additional_charges_table

Revision ID: q7a8b9c0d1e2
Revises: p6a7b8c9d0e1
Create Date: 2026-09-12 17:40:00.000000

"""
import uuid
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'q7a8b9c0d1e2'
down_revision: Union[str, None] = 'p6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INITIAL_ADDITIONAL_CHARGES = [
    ("Transport Charges", "996511", 18.00),
    ("Packing & Forwarding Charges", "996713", 18.00),
]


def upgrade() -> None:
    """Create additional_charges table and seed initial records."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('additional_charges'):
        op.create_table(
            'additional_charges',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('name', sa.String(150), nullable=False),
            sa.Column('hsn_number', sa.String(50), nullable=True),
            sa.Column('gst_percent', sa.Numeric(5, 2), nullable=False, server_default='0.00'),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('status', sa.String(20), nullable=False, server_default='ACTIVE'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        )
        op.create_index('ix_additional_charges_name', 'additional_charges', ['name'], unique=True)
        op.create_index('ix_additional_charges_hsn_number', 'additional_charges', ['hsn_number'])
        op.create_index('ix_additional_charges_status', 'additional_charges', ['status'])

        # Seed initial records from legacy system
        additional_charges_table = sa.table(
            'additional_charges',
            sa.column('id', app.database.base.GUID()),
            sa.column('name', sa.String()),
            sa.column('hsn_number', sa.String()),
            sa.column('gst_percent', sa.Numeric()),
            sa.column('description', sa.Text()),
            sa.column('status', sa.String()),
            sa.column('version', sa.Integer()),
        )

        rows = [
            {
                "id": uuid.uuid4(),
                "name": name,
                "hsn_number": hsn,
                "gst_percent": gst,
                "description": None,
                "status": "ACTIVE",
                "version": 1,
            }
            for name, hsn, gst in INITIAL_ADDITIONAL_CHARGES
        ]
        op.bulk_insert(additional_charges_table, rows)


def downgrade() -> None:
    """Drop additional_charges table."""
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table('additional_charges'):
        op.drop_index('ix_additional_charges_status', table_name='additional_charges')
        op.drop_index('ix_additional_charges_hsn_number', table_name='additional_charges')
        op.drop_index('ix_additional_charges_name', table_name='additional_charges')
        op.drop_table('additional_charges')
