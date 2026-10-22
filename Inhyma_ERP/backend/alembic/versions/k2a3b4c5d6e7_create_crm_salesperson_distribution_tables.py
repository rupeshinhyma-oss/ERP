"""create_crm_salesperson_distribution_tables

Revision ID: k2a3b4c5d6e7
Revises: h5e6f7a8b9c0
Create Date: 2026-10-12 18:05:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'k2a3b4c5d6e7'
down_revision = 'h5e6f7a8b9c0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create persistent tables for CRM Salesperson Distribution configuration."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_tables = insp.get_table_names()

    # 1. crm_salesperson_configs
    if "crm_salesperson_configs" not in existing_tables:
        op.create_table(
            "crm_salesperson_configs",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
                unique=True,
                index=True,
            ),
            sa.Column("is_eligible", sa.Boolean(), server_default=sa.text("false"), nullable=False, index=True),
            sa.Column("priority", sa.Integer(), server_default="1", nullable=False),
            sa.Column("max_lead_capacity", sa.Integer(), nullable=True),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False, index=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )

    # 2. crm_salesperson_territories
    if "crm_salesperson_territories" not in existing_tables:
        op.create_table(
            "crm_salesperson_territories",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "salesperson_config_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("crm_salesperson_configs.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column(
                "state_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("states.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.UniqueConstraint("salesperson_config_id", "state_id", name="uq_crm_salesperson_territory"),
        )


def downgrade() -> None:
    """Drop salesperson distribution tables in reverse order."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_tables = insp.get_table_names()

    if "crm_salesperson_territories" in existing_tables:
        op.drop_table("crm_salesperson_territories")

    if "crm_salesperson_configs" in existing_tables:
        op.drop_table("crm_salesperson_configs")
