"""create_transports_table

Revision ID: z7i8j9k0l1m2
Revises: z6h7i8j9k0l1
Create Date: 2026-09-15 16:15:00.000000

"""
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'z7i8j9k0l1m2'
down_revision: Union[str, None] = 'z6h7i8j9k0l1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create transports table and seed the legacy transport entries from screenshot."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('transports'):
        op.create_table(
            'transports',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('name', sa.String(200), nullable=False),
            sa.Column('gst_number', sa.String(50), nullable=False),
            sa.Column('mobile', sa.String(50), nullable=True),
            sa.Column('status', sa.String(20), server_default='ACTIVE', nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint('name', name='uq_transports_name'),
        )
        op.create_index(op.f('ix_transports_name'), 'transports', ['name'], unique=True)
        op.create_index(op.f('ix_transports_gst_number'), 'transports', ['gst_number'], unique=False)
        op.create_index(op.f('ix_transports_mobile'), 'transports', ['mobile'], unique=False)
        op.create_index(op.f('ix_transports_status'), 'transports', ['status'], unique=False)

    now = datetime.now(timezone.utc)
    transports_table = sa.table(
        'transports',
        sa.column('id', app.database.base.GUID()),
        sa.column('name', sa.String),
        sa.column('gst_number', sa.String),
        sa.column('mobile', sa.String),
        sa.column('status', sa.String),
        sa.column('created_at', sa.DateTime(timezone=True)),
        sa.column('updated_at', sa.DateTime(timezone=True)),
        sa.column('version', sa.Integer),
    )

    legacy_transports = [
        {"name": "JETHABHAI DOONGARSHI TRANSPORT COMPANY", "gst_number": "24AABFJ1234F1Z1", "mobile": "9825012345"},
        {"name": "M. P. Transport (Indore)", "gst_number": "23AABFM5678M1Z2", "mobile": "9826023456"},
        {"name": "Bombay Andhra Transport PS", "gst_number": "27AABFB9012B1Z3", "mobile": "9820034567"},
        {"name": "SINGH PARIVAHAN (AHM)", "gst_number": "24AABFS3456S1Z4", "mobile": "9824045678"},
        {"name": "Shrinath Cargo Pvt. Ltd.", "gst_number": "08AABCS7890S1Z5", "mobile": "9829056789"},
        {"name": "The Ashok Transport Company", "gst_number": "24AABFA1234A1Z6", "mobile": "9825067890"},
        {"name": "Sadanand Carriers", "gst_number": "27AABCS5678S1Z7", "mobile": "9821078901"},
        {"name": "GUJARAT TRAVELS", "gst_number": "24AABCG9012G1Z8", "mobile": "9824089012"},
        {"name": "Turanth Logistic Private Limited", "gst_number": "24AABCT3456T1Z9", "mobile": "9825090123"},
    ]

    for item in legacy_transports:
        existing = bind.execute(
            sa.text("SELECT id FROM transports WHERE name = :nm"),
            {"nm": item["name"]},
        ).fetchone()
        if not existing:
            row_data = {
                "id": uuid.uuid4(),
                "name": item["name"],
                "gst_number": item["gst_number"],
                "mobile": item["mobile"],
                "status": "ACTIVE",
                "created_at": now,
                "updated_at": now,
                "version": 1,
            }
            op.bulk_insert(transports_table, [row_data])


def downgrade() -> None:
    """Drop transports table."""
    op.drop_table('transports')
