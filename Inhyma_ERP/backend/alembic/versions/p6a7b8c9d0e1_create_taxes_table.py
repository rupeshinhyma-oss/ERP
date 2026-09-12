"""create_taxes_table

Revision ID: p6a7b8c9d0e1
Revises: o5f6a7b8c9d0
Create Date: 2026-09-12 17:05:00.000000

"""
import uuid
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'p6a7b8c9d0e1'
down_revision: Union[str, None] = 'o5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INITIAL_TAXES = [
    ("8431.20.90", 18.00, 8.25),
    ("9987.19.00", 18.00, 0.00),
    ("8427.90.00", 18.00, 8.25),
    ("8428.32.00", 18.00, 8.25),
    ("9801.00.30", 18.00, 8.25),
    ("8443.91.00", 18.00, 8.25),
    ("8431.39.90", 18.00, 8.25),
    ("8443.32.50", 18.00, 8.25),
    ("9612.10.90", 18.00, 11.00),
]


def upgrade() -> None:
    """Create taxes table and seed initial records."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('taxes'):
        op.create_table(
            'taxes',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('hsn_number', sa.String(50), nullable=False),
            sa.Column('gst_percent', sa.Numeric(5, 2), nullable=False, server_default='0.00'),
            sa.Column('import_duty_percent', sa.Numeric(5, 2), nullable=False, server_default='0.00'),
            sa.Column('status', sa.String(20), nullable=False, server_default='active'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        )
        op.create_index('ix_taxes_hsn_number', 'taxes', ['hsn_number'], unique=True)
        op.create_index('ix_taxes_status', 'taxes', ['status'])

        # Seed initial records from legacy system
        taxes_table = sa.table(
            'taxes',
            sa.column('id', app.database.base.GUID()),
            sa.column('hsn_number', sa.String()),
            sa.column('gst_percent', sa.Numeric()),
            sa.column('import_duty_percent', sa.Numeric()),
            sa.column('status', sa.String()),
            sa.column('version', sa.Integer()),
        )
        for hsn, gst, duty in INITIAL_TAXES:
            bind.execute(
                taxes_table.insert().values(
                    id=uuid.uuid4(),
                    hsn_number=hsn,
                    gst_percent=gst,
                    import_duty_percent=duty,
                    status="active",
                    version=1,
                )
            )


def downgrade() -> None:
    """Drop taxes table."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table('taxes'):
        op.drop_index('ix_taxes_status', table_name='taxes')
        op.drop_index('ix_taxes_hsn_number', table_name='taxes')
        op.drop_table('taxes')
