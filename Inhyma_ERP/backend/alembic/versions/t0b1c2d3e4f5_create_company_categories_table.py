"""create_company_categories_table

Revision ID: t0b1c2d3e4f5
Revises: s9a0b1c2d3e4
Create Date: 2026-09-15 11:30:00.000000

"""
import uuid
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 't0b1c2d3e4f5'
down_revision: Union[str, None] = 's9a0b1c2d3e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INITIAL_COMPANY_CATEGORIES = [
    ("Traditional", "B2B"),
    ("Non Traditional", "B2B"),
    ("SME", "B2C"),
    ("Corporate", "B2C"),
]


def upgrade() -> None:
    """Create company_categories table and seed initial records."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('company_categories'):
        op.create_table(
            'company_categories',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('name', sa.String(100), nullable=False),
            sa.Column('business_type', sa.String(50), nullable=False, server_default='B2B'),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('status', sa.String(20), nullable=False, server_default='ACTIVE'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        )
        op.create_index('ix_company_categories_name', 'company_categories', ['name'], unique=True)
        op.create_index('ix_company_categories_business_type', 'company_categories', ['business_type'])
        op.create_index('ix_company_categories_status', 'company_categories', ['status'])

        # Seed initial records from legacy system
        company_categories_table = sa.table(
            'company_categories',
            sa.column('id', app.database.base.GUID()),
            sa.column('name', sa.String()),
            sa.column('business_type', sa.String()),
            sa.column('description', sa.Text()),
            sa.column('status', sa.String()),
            sa.column('version', sa.Integer()),
        )

        rows = [
            {
                "id": uuid.uuid4(),
                "name": name,
                "business_type": btype,
                "description": f"{name} ({btype}) category",
                "status": "ACTIVE",
                "version": 1,
            }
            for name, btype in INITIAL_COMPANY_CATEGORIES
        ]
        op.bulk_insert(company_categories_table, rows)


def downgrade() -> None:
    """Drop company_categories table."""
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table('company_categories'):
        op.drop_index('ix_company_categories_status', table_name='company_categories')
        op.drop_index('ix_company_categories_business_type', table_name='company_categories')
        op.drop_index('ix_company_categories_name', table_name='company_categories')
        op.drop_table('company_categories')
