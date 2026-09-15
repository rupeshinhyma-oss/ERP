"""create_billing_companies_table

Revision ID: w3e4f5g6h7i8
Revises: v2d3e4f5g6h7
Create Date: 2026-09-15 12:25:00.000000

"""
import uuid
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'w3e4f5g6h7i8'
down_revision: Union[str, None] = 'v2d3e4f5g6h7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create billing_companies table and seed 3 initial legacy records."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('billing_companies'):
        op.create_table(
            'billing_companies',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('name', sa.String(150), nullable=False),
            sa.Column('email', sa.String(100), nullable=True),
            sa.Column('mobile', sa.String(20), nullable=True),
            sa.Column('logo_url', sa.Text(), nullable=True),
            sa.Column('signature_url', sa.Text(), nullable=True),
            sa.Column('address', sa.Text(), nullable=True),
            sa.Column('city', sa.String(100), nullable=False),
            sa.Column('zip_code', sa.String(20), nullable=True),
            sa.Column('gst_no', sa.String(30), nullable=True),
            sa.Column('pan_no', sa.String(30), nullable=True),
            sa.Column('so_prefix', sa.String(30), nullable=False),
            sa.Column('pi_prefix', sa.String(30), nullable=False),
            sa.Column('bank_name', sa.String(100), nullable=False),
            sa.Column('terms_and_conditions', sa.Text(), nullable=True),
            sa.Column('status', sa.String(20), server_default='ACTIVE', nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        )
        op.create_index('ix_billing_companies_name', 'billing_companies', ['name'], unique=True)
        op.create_index('ix_billing_companies_city', 'billing_companies', ['city'])
        op.create_index('ix_billing_companies_gst_no', 'billing_companies', ['gst_no'])
        op.create_index('ix_billing_companies_pan_no', 'billing_companies', ['pan_no'])
        op.create_index('ix_billing_companies_status', 'billing_companies', ['status'])

        billing_companies_table = sa.table(
            'billing_companies',
            sa.column('id', app.database.base.GUID()),
            sa.column('name', sa.String()),
            sa.column('email', sa.String()),
            sa.column('mobile', sa.String()),
            sa.column('logo_url', sa.Text()),
            sa.column('signature_url', sa.Text()),
            sa.column('address', sa.Text()),
            sa.column('city', sa.String()),
            sa.column('zip_code', sa.String()),
            sa.column('gst_no', sa.String()),
            sa.column('pan_no', sa.String()),
            sa.column('so_prefix', sa.String()),
            sa.column('pi_prefix', sa.String()),
            sa.column('bank_name', sa.String()),
            sa.column('terms_and_conditions', sa.Text()),
            sa.column('status', sa.String()),
            sa.column('version', sa.Integer()),
        )

        initial_companies = [
            {
                "id": uuid.uuid4(),
                "name": "INHYMA SOLUTIONS LLP (MP)",
                "email": "Payment.Darsh@Gmail.Com",
                "mobile": "9876543210",
                "logo_url": None,
                "signature_url": None,
                "address": "Indore Central Logistics Hub, Madhya Pradesh",
                "city": "Indore",
                "zip_code": "452001",
                "gst_no": "23AABCI1234F1Z5",
                "pan_no": "AABCI1234F",
                "so_prefix": "IN/MP/SO/",
                "pi_prefix": "IN/MP/PI/",
                "bank_name": "HDFC Bank",
                "terms_and_conditions": "Payment within 30 days. Goods once sold will not be taken back.",
                "status": "ACTIVE",
                "version": 1,
            },
            {
                "id": uuid.uuid4(),
                "name": "INHYMA SOLUTIONS LLP (G)",
                "email": "Payment.Darsh@Gmail.Com",
                "mobile": "9876543211",
                "logo_url": None,
                "signature_url": None,
                "address": "Ahmedabad Logistics Hub, Gujarat",
                "city": "Ahmedabad",
                "zip_code": "380001",
                "gst_no": "24AABCI1234F1Z6",
                "pan_no": "AABCI1234F",
                "so_prefix": "IN/G/SO/",
                "pi_prefix": "IN/G/PI/",
                "bank_name": "HDFC Bank",
                "terms_and_conditions": "Payment within 30 days. Goods once sold will not be taken back.",
                "status": "ACTIVE",
                "version": 1,
            },
            {
                "id": uuid.uuid4(),
                "name": "INHYMA SOLUTIONS LLP (M)",
                "email": "Payment.Darsh@Gmail.Com",
                "mobile": "9876543212",
                "logo_url": None,
                "signature_url": None,
                "address": "Mumbai Logistics Headquarters, Maharashtra",
                "city": "Mumbai",
                "zip_code": "400001",
                "gst_no": "27AABCI1234F1Z7",
                "pan_no": "AABCI1234F",
                "so_prefix": "IN/M/SO/",
                "pi_prefix": "IN/M/PI/",
                "bank_name": "HDFC Bank",
                "terms_and_conditions": "Payment within 30 days. Goods once sold will not be taken back.",
                "status": "ACTIVE",
                "version": 1,
            },
        ]
        op.bulk_insert(billing_companies_table, initial_companies)


def downgrade() -> None:
    """Drop billing_companies table."""
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table('billing_companies'):
        op.drop_index('ix_billing_companies_status', table_name='billing_companies')
        op.drop_index('ix_billing_companies_pan_no', table_name='billing_companies')
        op.drop_index('ix_billing_companies_gst_no', table_name='billing_companies')
        op.drop_index('ix_billing_companies_city', table_name='billing_companies')
        op.drop_index('ix_billing_companies_name', table_name='billing_companies')
        op.drop_table('billing_companies')
