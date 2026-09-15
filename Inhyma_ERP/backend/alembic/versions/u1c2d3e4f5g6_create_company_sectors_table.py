"""create_company_sectors_table

Revision ID: u1c2d3e4f5g6
Revises: t0b1c2d3e4f5
Create Date: 2026-09-15 11:36:00.000000

"""
import uuid
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'u1c2d3e4f5g6'
down_revision: Union[str, None] = 't0b1c2d3e4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INITIAL_COMPANY_SECTORS = [
    "Agriculture",
    "Pharma & Healthcare",
    "Packaging",
    "Construction & Building Materials",
    "FMCG",
    "Metals & Mining",
    "Chemical",
    "Other Food",
    "Textile",
    "Hardware",
    "Electronics",
    "Mechanical Items",
    "Electrical",
    "Automobile",
    "Others (Misc.)",
]


def upgrade() -> None:
    """Create company_sectors table and seed initial records."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('company_sectors'):
        op.create_table(
            'company_sectors',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('name', sa.String(100), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('status', sa.String(20), nullable=False, server_default='ACTIVE'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        )
        op.create_index('ix_company_sectors_name', 'company_sectors', ['name'], unique=True)
        op.create_index('ix_company_sectors_status', 'company_sectors', ['status'])

        # Seed initial records from legacy system
        company_sectors_table = sa.table(
            'company_sectors',
            sa.column('id', app.database.base.GUID()),
            sa.column('name', sa.String()),
            sa.column('description', sa.Text()),
            sa.column('status', sa.String()),
            sa.column('version', sa.Integer()),
        )

        rows = [
            {
                "id": uuid.uuid4(),
                "name": name,
                "description": f"{name} sector",
                "status": "ACTIVE",
                "version": 1,
            }
            for name in INITIAL_COMPANY_SECTORS
        ]
        op.bulk_insert(company_sectors_table, rows)


def downgrade() -> None:
    """Drop company_sectors table."""
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table('company_sectors'):
        op.drop_index('ix_company_sectors_status', table_name='company_sectors')
        op.drop_index('ix_company_sectors_name', table_name='company_sectors')
        op.drop_table('company_sectors')
