"""add organization logo_data column

Revision ID: z0a1b2c3d4e7
Revises: g9b0c1d2e3f4
Create Date: 2026-11-27 16:45:00.000000

Adds Organization.logo_data (Text, nullable=True) for database-backed
logo persistence and widens logo_url to Text.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "z0a1b2c3d4e7"
down_revision = "g9b0c1d2e3f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"]: c for c in inspector.get_columns("organizations")}
    if "logo_data" not in cols:
        op.add_column("organizations", sa.Column("logo_data", sa.Text(), nullable=True))
    if "logo_url" in cols and conn.dialect.name == "postgresql":
        op.alter_column(
            "organizations",
            "logo_url",
            existing_type=sa.String(length=500),
            type_=sa.Text(),
            existing_nullable=True,
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = [c["name"] for c in inspector.get_columns("organizations")]
    if "logo_data" in cols:
        op.drop_column("organizations", "logo_data")
