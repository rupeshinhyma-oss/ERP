"""create_adjustment_purposes_table

Revision ID: b9c0d1e2f3a6
Revises: b9c0d1e2f3a5
Create Date: 2026-09-15 18:05:00.000000

"""
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'b9c0d1e2f3a6'
down_revision: Union[str, None] = 'b9c0d1e2f3a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create adjustment_purposes table and seed initial adjustment purposes from legacy system."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('adjustment_purposes'):
        op.create_table(
            'adjustment_purposes',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('name', sa.String(100), nullable=False),
            sa.Column('status', sa.String(20), server_default='ACTIVE', nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint('name', name='uq_adjustment_purposes_name'),
        )
        op.create_index(op.f('ix_adjustment_purposes_name'), 'adjustment_purposes', ['name'], unique=True)
        op.create_index(op.f('ix_adjustment_purposes_status'), 'adjustment_purposes', ['status'], unique=False)

    now = datetime.now(timezone.utc)
    adjustment_purposes_table = sa.table(
        'adjustment_purposes',
        sa.column('id', app.database.base.GUID()),
        sa.column('name', sa.String),
        sa.column('status', sa.String),
        sa.column('created_at', sa.DateTime(timezone=True)),
        sa.column('updated_at', sa.DateTime(timezone=True)),
        sa.column('version', sa.Integer),
    )

    legacy_purposes = [
        {"name": "Return To Supplier", "status": "ACTIVE"},
        {"name": "Sample / Testing", "status": "ACTIVE"},
        {"name": "Stock Audit", "status": "ACTIVE"},
        {"name": "Theft / Loss", "status": "ACTIVE"},
        {"name": "Non Working (Damage)", "status": "ACTIVE"},
        {"name": "Removed Parts", "status": "ACTIVE"},
        {"name": "Free From Supplier", "status": "ACTIVE"},
        {"name": "Split", "status": "ACTIVE"},
        {"name": "Self Use", "status": "ACTIVE"},
        {"name": "Scrap", "status": "ACTIVE"},
        {"name": "Damage", "status": "ACTIVE"},
        {"name": "Opening Stock", "status": "ACTIVE"},
        {"name": "Return From Client", "status": "ACTIVE"},
    ]

    for item in legacy_purposes:
        existing = bind.execute(
            sa.text("SELECT id FROM adjustment_purposes WHERE name = :nm"),
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
            op.bulk_insert(adjustment_purposes_table, [row_data])


def downgrade() -> None:
    """Drop adjustment_purposes table."""
    op.drop_table('adjustment_purposes')
