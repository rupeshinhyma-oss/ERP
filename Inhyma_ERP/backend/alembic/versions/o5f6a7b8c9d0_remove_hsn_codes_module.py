"""remove_hsn_codes_module

Revision ID: o5f6a7b8c9d0
Revises: n4e5f6a7b8c9
Create Date: 2026-09-12 16:50:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'o5f6a7b8c9d0'
down_revision: Union[str, None] = 'n4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop hsn_codes table, products.hsn_id column, and related permissions."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1. Drop foreign key constraint on products.hsn_id if exists
    if insp.has_table('products'):
        fks = insp.get_foreign_keys('products')
        for fk in fks:
            if fk.get('referred_table') == 'hsn_codes' or 'hsn_id' in fk.get('constrained_columns', []):
                op.drop_constraint(fk['name'], 'products', type_='foreignkey')

        # Drop index on products.hsn_id if exists
        indexes = insp.get_indexes('products')
        for idx in indexes:
            if 'hsn_id' in idx.get('column_names', []):
                op.drop_index(idx['name'], table_name='products')

        # Drop column products.hsn_id if exists
        cols = [c['name'] for c in insp.get_columns('products')]
        if 'hsn_id' in cols:
            op.drop_column('products', 'hsn_id')

    # 2. Drop hsn_codes table if exists
    if insp.has_table('hsn_codes'):
        op.drop_table('hsn_codes')

    # 3. Clean up permissions for hsn
    try:
        bind.execute(sa.text("DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE module = 'hsn' OR code LIKE 'hsn.%');"))
        bind.execute(sa.text("DELETE FROM permissions WHERE module = 'hsn' OR code LIKE 'hsn.%';"))
    except Exception:
        pass


def downgrade() -> None:
    """Recreate hsn_codes table and products.hsn_id."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('hsn_codes'):
        op.create_table(
            'hsn_codes',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('code', sa.String(20), nullable=False, unique=True),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('gst_percent', sa.Numeric(5, 2), nullable=False, server_default='0.0'),
            sa.Column('refund_vat_percent', sa.Numeric(5, 2), nullable=False, server_default='0.0'),
            sa.Column('status', sa.String(20), nullable=False, server_default='ACTIVE'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        )
        op.create_index('ix_hsn_codes_code', 'hsn_codes', ['code'])

    if insp.has_table('products'):
        cols = [c['name'] for c in insp.get_columns('products')]
        if 'hsn_id' not in cols:
            op.add_column(
                'products',
                sa.Column('hsn_id', app.database.base.GUID(), sa.ForeignKey('hsn_codes.id', ondelete='RESTRICT'), nullable=True),
            )
            op.create_index('ix_products_hsn_id', 'products', ['hsn_id'])
