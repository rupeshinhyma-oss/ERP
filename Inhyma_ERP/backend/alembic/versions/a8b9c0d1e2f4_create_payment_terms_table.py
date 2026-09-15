"""create_payment_terms_table

Revision ID: a8b9c0d1e2f4
Revises: z7i8j9k0l1m2
Create Date: 2026-09-15 17:15:00.000000

"""
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'a8b9c0d1e2f4'
down_revision: Union[str, None] = 'z7i8j9k0l1m2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create payment_terms table and seed the 7 legacy payment terms from screenshot."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('payment_terms'):
        op.create_table(
            'payment_terms',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('name', sa.String(100), nullable=False),
            sa.Column('status', sa.String(20), server_default='ACTIVE', nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint('name', name='uq_payment_terms_name'),
        )
        op.create_index(op.f('ix_payment_terms_name'), 'payment_terms', ['name'], unique=True)
        op.create_index(op.f('ix_payment_terms_status'), 'payment_terms', ['status'], unique=False)

    now = datetime.now(timezone.utc)
    payment_terms_table = sa.table(
        'payment_terms',
        sa.column('id', app.database.base.GUID()),
        sa.column('name', sa.String),
        sa.column('status', sa.String),
        sa.column('created_at', sa.DateTime(timezone=True)),
        sa.column('updated_at', sa.DateTime(timezone=True)),
        sa.column('version', sa.Integer),
    )

    legacy_terms = [
        {"name": "100% Advance", "status": "ACTIVE"},
        {"name": "Full Credit", "status": "INACTIVE"},
        {"name": "Partial Credit", "status": "INACTIVE"},
        {"name": "7 Days Credit", "status": "ACTIVE"},
        {"name": "15 Days Credit", "status": "ACTIVE"},
        {"name": "21 Days Credit", "status": "ACTIVE"},
        {"name": "30 Days Credit", "status": "ACTIVE"},
    ]

    for item in legacy_terms:
        existing = bind.execute(
            sa.text("SELECT id FROM payment_terms WHERE name = :nm"),
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
            op.bulk_insert(payment_terms_table, [row_data])


def downgrade() -> None:
    """Drop payment_terms table."""
    op.drop_table('payment_terms')
