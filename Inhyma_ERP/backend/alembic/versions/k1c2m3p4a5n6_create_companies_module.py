"""create_companies_module

Revision ID: k1c2m3p4a5n6
Revises: g6a7b8c9d0e1
Create Date: 2026-09-12 14:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'k1c2m3p4a5n6'
down_revision: Union[str, None] = 'g6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Apply this migration's schema changes."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # --- companies -----------------------------------------------------------------------
    if not insp.has_table('companies'):
        op.create_table(
            'companies',
            sa.Column('company_name', sa.String(length=255), nullable=False),
            sa.Column('company_type', sa.String(length=150), nullable=True),
            sa.Column('brand_description', sa.Text(), nullable=True),
            sa.Column('country_id', app.database.base.GUID(), nullable=False),
            sa.Column('state_id', app.database.base.GUID(), nullable=False),
            sa.Column('city_id', app.database.base.GUID(), nullable=False),
            sa.Column('contact_salutation', sa.String(length=10), nullable=True),
            sa.Column('contact_full_name', sa.String(length=150), nullable=True),
            sa.Column('contact_designation', sa.String(length=150), nullable=True),
            sa.Column('contact_calling_number', sa.String(length=20), nullable=True),
            sa.Column('contact_whatsapp_number', sa.String(length=20), nullable=True),
            sa.Column('contact_wechat_number', sa.String(length=20), nullable=True),
            sa.Column('tax_id_number', sa.String(length=100), nullable=True),
            sa.Column('address', sa.Text(), nullable=True),
            sa.Column('town', sa.String(length=150), nullable=True),
            sa.Column('primary_website', sa.Text(), nullable=True),
            sa.Column('secondary_website', sa.Text(), nullable=True),
            sa.Column('company_grade', sa.String(length=5), nullable=True),
            sa.Column('current_status', sa.String(length=20), nullable=True),
            sa.Column('potential', sa.String(length=10), nullable=True),
            sa.Column('potential_reason', sa.Text(), nullable=True),
            sa.Column('secondary_products_description', sa.Text(), nullable=True),
            sa.Column('visited_factory_office', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('visit_remarks', sa.Text(), nullable=True),
            sa.Column('visit_media', sa.JSON(), nullable=True),
            sa.Column('overall_remarks', sa.Text(), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('id', app.database.base.GUID(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['country_id'], ['countries.id'], ondelete='RESTRICT'),
            sa.ForeignKeyConstraint(['state_id'], ['states.id'], ondelete='RESTRICT'),
            sa.ForeignKeyConstraint(['city_id'], ['cities.id'], ondelete='RESTRICT'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index(op.f('ix_companies_company_name'), 'companies', ['company_name'], unique=False)
        op.create_index(op.f('ix_companies_country_id'), 'companies', ['country_id'], unique=False)
        op.create_index(op.f('ix_companies_state_id'), 'companies', ['state_id'], unique=False)
        op.create_index(op.f('ix_companies_city_id'), 'companies', ['city_id'], unique=False)
        op.create_index(op.f('ix_companies_is_active'), 'companies', ['is_active'], unique=False)

    # --- company_emails -------------------------------------------------------------------
    if not insp.has_table('company_emails'):
        op.create_table(
            'company_emails',
            sa.Column('company_id', app.database.base.GUID(), nullable=False),
            sa.Column('email', sa.String(length=255), nullable=False),
            sa.Column('id', app.database.base.GUID(), nullable=False),
            sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('company_id', 'email', name='uq_company_email'),
        )
        op.create_index(op.f('ix_company_emails_company_id'), 'company_emails', ['company_id'], unique=False)
        op.create_index(op.f('ix_company_emails_email'), 'company_emails', ['email'], unique=False)

    # --- company_contacts -----------------------------------------------------------------
    if not insp.has_table('company_contacts'):
        op.create_table(
            'company_contacts',
            sa.Column('company_id', app.database.base.GUID(), nullable=False),
            sa.Column('salutation', sa.String(length=10), nullable=True),
            sa.Column('person_name', sa.String(length=150), nullable=False),
            sa.Column('designation', sa.String(length=150), nullable=True),
            sa.Column('handling_territory', sa.String(length=150), nullable=True),
            sa.Column('country_id', app.database.base.GUID(), nullable=True),
            sa.Column('calling_number', sa.String(length=20), nullable=True),
            sa.Column('whatsapp_number', sa.String(length=20), nullable=True),
            sa.Column('wechat_number', sa.String(length=20), nullable=True),
            sa.Column('email', sa.String(length=255), nullable=True),
            sa.Column('is_primary', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('id', app.database.base.GUID(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['country_id'], ['countries.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index(op.f('ix_company_contacts_company_id'), 'company_contacts', ['company_id'], unique=False)
        op.create_index(op.f('ix_company_contacts_country_id'), 'company_contacts', ['country_id'], unique=False)

    # --- company_category_links -----------------------------------------------------------
    if not insp.has_table('company_category_links'):
        op.create_table(
            'company_category_links',
            sa.Column('company_id', app.database.base.GUID(), nullable=False),
            sa.Column('category_id', app.database.base.GUID(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('id', app.database.base.GUID(), nullable=False),
            sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['category_id'], ['product_categories.id'], ondelete='RESTRICT'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('company_id', 'category_id', name='uq_company_category'),
        )
        op.create_index(
            op.f('ix_company_category_links_company_id'), 'company_category_links', ['company_id'], unique=False
        )
        op.create_index(
            op.f('ix_company_category_links_category_id'), 'company_category_links', ['category_id'], unique=False
        )

    # --- company_sub_category_links -------------------------------------------------------
    if not insp.has_table('company_sub_category_links'):
        op.create_table(
            'company_sub_category_links',
            sa.Column('company_id', app.database.base.GUID(), nullable=False),
            sa.Column('sub_category_id', app.database.base.GUID(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('id', app.database.base.GUID(), nullable=False),
            sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['sub_category_id'], ['product_sub_categories.id'], ondelete='RESTRICT'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('company_id', 'sub_category_id', name='uq_company_subcategory'),
        )
        op.create_index(
            op.f('ix_company_sub_category_links_company_id'),
            'company_sub_category_links',
            ['company_id'],
            unique=False,
        )
        op.create_index(
            op.f('ix_company_sub_category_links_sub_category_id'),
            'company_sub_category_links',
            ['sub_category_id'],
            unique=False,
        )

    # --- company_product_links ------------------------------------------------------------
    if not insp.has_table('company_product_links'):
        op.create_table(
            'company_product_links',
            sa.Column('company_id', app.database.base.GUID(), nullable=False),
            sa.Column('product_id', app.database.base.GUID(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('id', app.database.base.GUID(), nullable=False),
            sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='RESTRICT'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('company_id', 'product_id', name='uq_company_product'),
        )
        op.create_index(
            op.f('ix_company_product_links_company_id'), 'company_product_links', ['company_id'], unique=False
        )
        op.create_index(
            op.f('ix_company_product_links_product_id'), 'company_product_links', ['product_id'], unique=False
        )


def downgrade() -> None:
    """Revert this migration's schema changes."""
    op.drop_table('company_product_links')
    op.drop_table('company_sub_category_links')
    op.drop_table('company_category_links')
    op.drop_table('company_contacts')
    op.drop_table('company_emails')
    op.drop_table('companies')
