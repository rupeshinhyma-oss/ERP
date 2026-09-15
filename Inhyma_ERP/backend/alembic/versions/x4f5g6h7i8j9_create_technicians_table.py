"""create_technicians_table

Revision ID: x4f5g6h7i8j9
Revises: w3e4f5g6h7i8
Create Date: 2026-09-15 12:53:00.000000

"""
import uuid
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'x4f5g6h7i8j9'
down_revision: Union[str, None] = 'w3e4f5g6h7i8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create technicians table and seed 4 initial legacy records."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('technicians'):
        op.create_table(
            'technicians',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('name', sa.String(100), nullable=False),
            sa.Column('mobile', sa.String(20), nullable=False),
            sa.Column('city', sa.String(100), nullable=False),
            sa.Column('password_hash', sa.String(255), nullable=True),
            sa.Column('status', sa.String(20), server_default='ACTIVE', nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        )
        op.create_index('ix_technicians_name', 'technicians', ['name'])
        op.create_index('ix_technicians_mobile', 'technicians', ['mobile'], unique=True)
        op.create_index('ix_technicians_city', 'technicians', ['city'])
        op.create_index('ix_technicians_status', 'technicians', ['status'])

        technicians_table = sa.table(
            'technicians',
            sa.column('id', app.database.base.GUID()),
            sa.column('name', sa.String()),
            sa.column('mobile', sa.String()),
            sa.column('city', sa.String()),
            sa.column('status', sa.String()),
            sa.column('version', sa.Integer()),
        )

        initial_technicians = [
            {
                "id": uuid.uuid4(),
                "name": "Mangal Pandey",
                "mobile": "7420960969",
                "city": "Mumbai",
                "status": "ACTIVE",
                "version": 1,
            },
            {
                "id": uuid.uuid4(),
                "name": "Devendra Pandey",
                "mobile": "9987987923",
                "city": "Mumbai",
                "status": "ACTIVE",
                "version": 1,
            },
            {
                "id": uuid.uuid4(),
                "name": "Devendra Marade",
                "mobile": "8657041027",
                "city": "Mumbai",
                "status": "ACTIVE",
                "version": 1,
            },
            {
                "id": uuid.uuid4(),
                "name": "Mukesh Paudwal",
                "mobile": "9833390364",
                "city": "Mumbai",
                "status": "ACTIVE",
                "version": 1,
            },
        ]
        op.bulk_insert(technicians_table, initial_technicians)


def downgrade() -> None:
    """Drop technicians table."""
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table('technicians'):
        op.drop_index('ix_technicians_status', table_name='technicians')
        op.drop_index('ix_technicians_city', table_name='technicians')
        op.drop_index('ix_technicians_mobile', table_name='technicians')
        op.drop_index('ix_technicians_name', table_name='technicians')
        op.drop_table('technicians')
