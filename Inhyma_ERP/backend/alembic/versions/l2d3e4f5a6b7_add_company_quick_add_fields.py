"""add_company_quick_add_fields

Revision ID: l2d3e4f5a6b7
Revises: k1c2m3p4a5n6
Create Date: 2026-09-12 14:15:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'l2d3e4f5a6b7'
down_revision: Union[str, None] = 'k1c2m3p4a5n6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Apply this migration's schema changes."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table('companies'):
        existing_cols = {c['name'] for c in insp.get_columns('companies')}

        # Make country_id, state_id, city_id nullable
        op.alter_column('companies', 'country_id', nullable=True)
        op.alter_column('companies', 'state_id', nullable=True)
        op.alter_column('companies', 'city_id', nullable=True)

        # Alter phone number lengths to 30 for safety
        op.alter_column('companies', 'contact_calling_number', type_=sa.String(length=30))
        op.alter_column('companies', 'contact_whatsapp_number', type_=sa.String(length=30))
        op.alter_column('companies', 'contact_wechat_number', type_=sa.String(length=30))

        if 'area' not in existing_cols:
            op.add_column('companies', sa.Column('area', sa.String(length=255), nullable=True))

        if 'district' not in existing_cols:
            op.add_column('companies', sa.Column('district', sa.String(length=150), nullable=True))

        if 'contact_indiamart_number' not in existing_cols:
            op.add_column('companies', sa.Column('contact_indiamart_number', sa.String(length=30), nullable=True))

        if 'sales_person_id' not in existing_cols:
            op.add_column('companies', sa.Column('sales_person_id', app.database.base.GUID(), nullable=True))
            op.create_foreign_key(
                'fk_companies_sales_person_id_users',
                'companies',
                'users',
                ['sales_person_id'],
                ['id'],
                ondelete='SET NULL',
            )
            op.create_index(op.f('ix_companies_sales_person_id'), 'companies', ['sales_person_id'], unique=False)


def downgrade() -> None:
    """Revert this migration's schema changes."""
    op.drop_constraint('fk_companies_sales_person_id_users', 'companies', type_='foreignkey')
    op.drop_index(op.f('ix_companies_sales_person_id'), table_name='companies')
    op.drop_column('companies', 'sales_person_id')
    op.drop_column('companies', 'contact_indiamart_number')
    op.drop_column('companies', 'district')
    op.drop_column('companies', 'area')
