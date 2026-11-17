"""create_cargo_overviews

Creates the ``cargo_overviews`` table used by the Cargo Overview module to
persist Consignment Gallery document uploads, Cargo Status shipment checklist
toggles, cargo remarks, ETD/ETA/forwarder/clearing-agent metadata, and
standalone/overlay Finance Planning & Product Summary records.

Revision ID: z9a0b1c2d3e4
Revises: z8f9a0b1c2d3
Create Date: 2026-11-16 15:48:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.database.base

revision: str = "z9a0b1c2d3e4"
down_revision: Union[str, None] = "z8f9a0b1c2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if "cargo_overviews" not in tables:
        op.create_table(
            "cargo_overviews",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("consignment_key", sa.String(length=120), nullable=False),
            sa.Column("source_module", sa.String(length=50), nullable=True),
            sa.Column("source_record_id", app.database.base.GUID(), nullable=True),
            sa.Column("display_title", sa.String(length=150), nullable=True),
            sa.Column("invoice_or_order_no", sa.String(length=150), nullable=True),
            sa.Column("batch_no", sa.String(length=120), nullable=True),
            sa.Column("supplier_name", sa.String(length=255), nullable=True),
            sa.Column("warehouse", sa.String(length=100), nullable=True),
            sa.Column("ordered_date", sa.Date(), nullable=True),
            sa.Column("etd_origin_date", sa.Date(), nullable=True),
            sa.Column("eta_port_date", sa.Date(), nullable=True),
            sa.Column("expected_arrival_date", sa.Date(), nullable=True),
            sa.Column("forwarder_name", sa.String(length=150), nullable=True),
            sa.Column("clearing_agent_name", sa.String(length=150), nullable=True),
            sa.Column("cargo_remarks", sa.Text(), nullable=True),
            sa.Column("documents_json", sa.JSON(), nullable=True),
            sa.Column("checklist_json", sa.JSON(), nullable=True),
            sa.Column("finance_lines_json", sa.JSON(), nullable=True),
            sa.Column("products_json", sa.JSON(), nullable=True),
            sa.Column("updated_by_id", app.database.base.GUID(), nullable=True),
            sa.Column("updated_by_name", sa.String(length=150), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("consignment_key", name="uq_cargo_overviews_consignment_key"),
        )
        op.create_index("ix_cargo_overviews_consignment_key", "cargo_overviews", ["consignment_key"], unique=True)
        op.create_index("ix_cargo_overviews_source_module", "cargo_overviews", ["source_module"], unique=False)
        op.create_index("ix_cargo_overviews_source_record_id", "cargo_overviews", ["source_record_id"], unique=False)
        op.create_index("ix_cargo_overviews_warehouse", "cargo_overviews", ["warehouse"], unique=False)
        op.create_index("ix_cargo_overviews_deleted_at", "cargo_overviews", ["deleted_at"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if "cargo_overviews" in tables:
        op.drop_table("cargo_overviews")
