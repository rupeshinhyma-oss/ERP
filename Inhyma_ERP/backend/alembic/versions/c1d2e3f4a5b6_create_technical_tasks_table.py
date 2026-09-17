"""create_technical_tasks_table

Revision ID: c1d2e3f4a5b6
Revises: b9c0d1e2f3a7
Create Date: 2026-09-17 17:15:00.000000

"""
import uuid
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, None] = 'b9c0d1e2f3a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('technical_tasks'):
        op.create_table(
            'technical_tasks',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('company_name', sa.String(255), nullable=False),
            sa.Column('task_type', sa.String(100), server_default='In-House', nullable=False),
            sa.Column('city', sa.String(100), nullable=False),
            sa.Column('third_party', sa.String(100), nullable=True),
            sa.Column('priority', sa.String(10), server_default='A', nullable=False),
            sa.Column('machine_model', sa.String(255), nullable=False),
            sa.Column('task_description', sa.Text(), server_default='', nullable=False),
            sa.Column('contact_person_name', sa.String(150), nullable=True),
            sa.Column('contact_designation', sa.String(100), nullable=True),
            sa.Column('contact_phone', sa.String(50), nullable=True),
            sa.Column('created_by_name', sa.String(100), server_default='Admin', nullable=False),
            sa.Column('task_created_date', sa.Date(), server_default=sa.func.current_date(), nullable=False),
            sa.Column('service_type', sa.String(50), server_default='Free', nullable=False),
            sa.Column('service_charge', sa.Numeric(12, 2), nullable=True),
            sa.Column('call_type', sa.String(50), server_default='Demo', nullable=False),
            sa.Column('task_approved_by', sa.String(100), nullable=True),
            sa.Column('task_approved_date', sa.Date(), nullable=True),
            sa.Column('task_allotted_to', sa.String(100), nullable=True),
            sa.Column('payment_status', sa.String(50), nullable=True),
            sa.Column('status', sa.String(50), server_default='Pending', nullable=False),
            sa.Column('completed_date', sa.Date(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(op.f('ix_technical_tasks_company_name'), 'technical_tasks', ['company_name'], unique=False)
        op.create_index(op.f('ix_technical_tasks_task_type'), 'technical_tasks', ['task_type'], unique=False)
        op.create_index(op.f('ix_technical_tasks_city'), 'technical_tasks', ['city'], unique=False)
        op.create_index(op.f('ix_technical_tasks_priority'), 'technical_tasks', ['priority'], unique=False)
        op.create_index(op.f('ix_technical_tasks_call_type'), 'technical_tasks', ['call_type'], unique=False)
        op.create_index(op.f('ix_technical_tasks_task_allotted_to'), 'technical_tasks', ['task_allotted_to'], unique=False)
        op.create_index(op.f('ix_technical_tasks_status'), 'technical_tasks', ['status'], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table('technical_tasks'):
        op.drop_table('technical_tasks')
