"""create_call_types_table

Revision ID: b9c0d1e2f3a7
Revises: b9c0d1e2f3a6
Create Date: 2026-09-15 18:25:00.000000

"""
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'b9c0d1e2f3a7'
down_revision: Union[str, None] = 'b9c0d1e2f3a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create call_types table and seed initial call types from legacy system."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('call_types'):
        op.create_table(
            'call_types',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('name', sa.String(100), nullable=False),
            sa.Column('status', sa.String(20), server_default='ACTIVE', nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint('name', name='uq_call_types_name'),
        )
        op.create_index(op.f('ix_call_types_name'), 'call_types', ['name'], unique=True)
        op.create_index(op.f('ix_call_types_status'), 'call_types', ['status'], unique=False)

    now = datetime.now(timezone.utc)
    call_types_table = sa.table(
        'call_types',
        sa.column('id', app.database.base.GUID()),
        sa.column('name', sa.String),
        sa.column('status', sa.String),
        sa.column('created_at', sa.DateTime(timezone=True)),
        sa.column('updated_at', sa.DateTime(timezone=True)),
        sa.column('version', sa.Integer),
    )

    legacy_call_types = [
        {"name": "Trial", "status": "ACTIVE"},
        {"name": "Demo", "status": "ACTIVE"},
        {"name": "Repair", "status": "ACTIVE"},
    ]

    for item in legacy_call_types:
        existing = bind.execute(
            sa.text("SELECT id FROM call_types WHERE name = :nm"),
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
            op.bulk_insert(call_types_table, [row_data])


def downgrade() -> None:
    """Drop call_types table."""
    op.drop_table('call_types')
