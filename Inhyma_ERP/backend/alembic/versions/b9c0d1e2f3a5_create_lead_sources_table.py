"""create_lead_sources_table

Revision ID: b9c0d1e2f3a5
Revises: a8b9c0d1e2f4
Create Date: 2026-09-15 17:35:00.000000

"""
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'b9c0d1e2f3a5'
down_revision: Union[str, None] = 'a8b9c0d1e2f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create lead_sources table and seed the 7 legacy lead sources from screenshot."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('lead_sources'):
        op.create_table(
            'lead_sources',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('name', sa.String(100), nullable=False),
            sa.Column('status', sa.String(20), server_default='ACTIVE', nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint('name', name='uq_lead_sources_name'),
        )
        op.create_index(op.f('ix_lead_sources_name'), 'lead_sources', ['name'], unique=True)
        op.create_index(op.f('ix_lead_sources_status'), 'lead_sources', ['status'], unique=False)

    now = datetime.now(timezone.utc)
    lead_sources_table = sa.table(
        'lead_sources',
        sa.column('id', app.database.base.GUID()),
        sa.column('name', sa.String),
        sa.column('status', sa.String),
        sa.column('created_at', sa.DateTime(timezone=True)),
        sa.column('updated_at', sa.DateTime(timezone=True)),
        sa.column('version', sa.Integer),
    )

    legacy_sources = [
        {"name": "Own Website", "status": "ACTIVE"},
        {"name": "Indiamart", "status": "ACTIVE"},
        {"name": "Facebook", "status": "ACTIVE"},
        {"name": "Instagram", "status": "ACTIVE"},
        {"name": "Agent", "status": "ACTIVE"},
        {"name": "Other", "status": "ACTIVE"},
        {"name": "Data Scrapping", "status": "ACTIVE"},
    ]

    for item in legacy_sources:
        existing = bind.execute(
            sa.text("SELECT id FROM lead_sources WHERE name = :nm"),
            {"nm": item["name"]},
        ).fetchone()
        if not existing:
            row_data = {
                "id": uuid.uuid4(),
                "name": item["name"],
                "status": item["status"],
                "created_at": now,
                "updated_at": now,
                "version": 1,
            }
            op.bulk_insert(lead_sources_table, [row_data])


def downgrade() -> None:
    """Drop lead_sources table."""
    op.drop_table('lead_sources')
