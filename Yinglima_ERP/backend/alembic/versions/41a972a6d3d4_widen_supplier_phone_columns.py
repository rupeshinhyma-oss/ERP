"""widen_supplier_phone_columns

Revision ID: 41a972a6d3d4
Revises: ac0d0f6dc577
Create Date: 2026-10-14 13:20:04.745519

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '41a972a6d3d4'
down_revision = 'ac0d0f6dc577'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply this migration's schema changes."""
    op.alter_column('suppliers', 'contact_calling_number', type_=sa.String(150), existing_type=sa.String(20), existing_nullable=True)
    op.alter_column('suppliers', 'contact_whatsapp_number', type_=sa.String(150), existing_type=sa.String(20), existing_nullable=True)
    op.alter_column('suppliers', 'contact_wechat_number', type_=sa.String(150), existing_type=sa.String(20), existing_nullable=True)
    op.alter_column('supplier_contacts', 'calling_number', type_=sa.String(150), existing_type=sa.String(20), existing_nullable=True)
    op.alter_column('supplier_contacts', 'whatsapp_number', type_=sa.String(150), existing_type=sa.String(20), existing_nullable=True)
    op.alter_column('supplier_contacts', 'wechat_number', type_=sa.String(150), existing_type=sa.String(20), existing_nullable=True)


def downgrade() -> None:
    """Revert this migration's schema changes."""
    op.alter_column('supplier_contacts', 'wechat_number', type_=sa.String(20), existing_type=sa.String(150), existing_nullable=True)
    op.alter_column('supplier_contacts', 'whatsapp_number', type_=sa.String(20), existing_type=sa.String(150), existing_nullable=True)
    op.alter_column('supplier_contacts', 'calling_number', type_=sa.String(20), existing_type=sa.String(150), existing_nullable=True)
    op.alter_column('suppliers', 'contact_wechat_number', type_=sa.String(20), existing_type=sa.String(150), existing_nullable=True)
    op.alter_column('suppliers', 'contact_whatsapp_number', type_=sa.String(20), existing_type=sa.String(150), existing_nullable=True)
    op.alter_column('suppliers', 'contact_calling_number', type_=sa.String(20), existing_type=sa.String(150), existing_nullable=True)
