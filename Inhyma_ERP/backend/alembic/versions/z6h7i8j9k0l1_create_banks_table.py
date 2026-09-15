"""create_banks_table

Revision ID: z6h7i8j9k0l1
Revises: y5g6h7i8j9k0
Create Date: 2026-09-15 13:15:00.000000

"""
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'z6h7i8j9k0l1'
down_revision: Union[str, None] = 'y5g6h7i8j9k0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create banks table and seed the 3 legacy accounts."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('banks'):
        op.create_table(
            'banks',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('bank_name', sa.String(150), nullable=False),
            sa.Column('account_number', sa.String(50), nullable=False),
            sa.Column('account_holder_name', sa.String(200), nullable=False),
            sa.Column('ifsc_code', sa.String(20), nullable=False),
            sa.Column('branch', sa.String(150), nullable=False),
            sa.Column('status', sa.String(20), server_default='ACTIVE', nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint('account_number', name='uq_banks_account_number'),
        )
        op.create_index(op.f('ix_banks_bank_name'), 'banks', ['bank_name'], unique=False)
        op.create_index(op.f('ix_banks_account_number'), 'banks', ['account_number'], unique=True)
        op.create_index(op.f('ix_banks_account_holder_name'), 'banks', ['account_holder_name'], unique=False)
        op.create_index(op.f('ix_banks_ifsc_code'), 'banks', ['ifsc_code'], unique=False)
        op.create_index(op.f('ix_banks_status'), 'banks', ['status'], unique=False)

    # Seed the 3 legacy bank accounts from screenshot
    now = datetime.now(timezone.utc)
    banks_table = sa.table(
        'banks',
        sa.column('id', app.database.base.GUID()),
        sa.column('bank_name', sa.String),
        sa.column('account_number', sa.String),
        sa.column('account_holder_name', sa.String),
        sa.column('ifsc_code', sa.String),
        sa.column('branch', sa.String),
        sa.column('status', sa.String),
        sa.column('created_at', sa.DateTime(timezone=True)),
        sa.column('updated_at', sa.DateTime(timezone=True)),
        sa.column('version', sa.Integer),
    )

    legacy_banks = [
        {
            "id": uuid.uuid4(),
            "account_holder_name": "INHYMA SOLUTIONS LLP (GUJARAT)",
            "bank_name": "HDFC BANK",
            "account_number": "50200117491557",
            "ifsc_code": "HDFC0000118",
            "branch": "PARMESHWARI PLAZA MULUND (W)",
            "status": "ACTIVE",
            "created_at": now,
            "updated_at": now,
            "version": 1,
        },
        {
            "id": uuid.uuid4(),
            "account_holder_name": "INHYMA SOLUTIONS LLP (MP)",
            "bank_name": "HDFC BANK",
            "account_number": "50200113062369",
            "ifsc_code": "HDFC0000118",
            "branch": "PARMESHWARI PLAZA MULUND (W)",
            "status": "ACTIVE",
            "created_at": now,
            "updated_at": now,
            "version": 1,
        },
        {
            "id": uuid.uuid4(),
            "account_holder_name": "INHYMA SOLUTIONS LLP (MUMBAI)",
            "bank_name": "HDFC BANK",
            "account_number": "50200102929151",
            "ifsc_code": "HDFC0000118",
            "branch": "PARMESHWARI PLAZA MULUND (W)",
            "status": "ACTIVE",
            "created_at": now,
            "updated_at": now,
            "version": 1,
        },
    ]

    for bank_data in legacy_banks:
        # Check if already exists to ensure idempotency
        existing = bind.execute(
            sa.text("SELECT id FROM banks WHERE account_number = :acc"),
            {"acc": bank_data["account_number"]},
        ).fetchone()
        if not existing:
            op.bulk_insert(banks_table, [bank_data])


def downgrade() -> None:
    """Drop banks table."""
    op.drop_table('banks')
