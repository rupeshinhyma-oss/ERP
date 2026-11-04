"""upgrade_technician_ops_stock_and_so

Adds warehouse, machine_model, real sale_order_id linkage, and idempotent stock
deduction / return / SO-release tracking columns to technician_gatepasses and
technician_gatepass_items so outward spare-parts gatepasses, partial returns,
and Sales Order reconciliations stay strictly synchronized with physical
warehouse stock.

Revision ID: z7e8f9a0b1c2
Revises: z6d7e8f9a0b1
Create Date: 2026-11-03 16:45:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.database.base

revision: str = "z7e8f9a0b1c2"
down_revision: Union[str, None] = "z6d7e8f9a0b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if "technician_gatepasses" in tables:
        gp_cols = {c["name"] for c in insp.get_columns("technician_gatepasses")}
        if bind.dialect.name == "postgresql":
            op.execute(sa.text("ALTER TABLE technician_gatepasses ADD COLUMN IF NOT EXISTS warehouse_name VARCHAR(100);"))
            op.execute(sa.text("ALTER TABLE technician_gatepasses ADD COLUMN IF NOT EXISTS machine_model VARCHAR(255);"))
            if "sales_orders" in tables:
                op.execute(
                    sa.text(
                        "ALTER TABLE technician_gatepasses "
                        "ADD COLUMN IF NOT EXISTS sale_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL;"
                    )
                )
            else:
                op.execute(sa.text("ALTER TABLE technician_gatepasses ADD COLUMN IF NOT EXISTS sale_order_id UUID;"))
            op.execute(
                sa.text(
                    "ALTER TABLE technician_gatepasses "
                    "ADD COLUMN IF NOT EXISTS stock_deducted BOOLEAN NOT NULL DEFAULT FALSE;"
                )
            )
            op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_tech_gp_sale_order_id ON technician_gatepasses (sale_order_id);"))
        else:
            if "warehouse_name" not in gp_cols:
                op.add_column("technician_gatepasses", sa.Column("warehouse_name", sa.String(100), nullable=True))
            if "machine_model" not in gp_cols:
                op.add_column("technician_gatepasses", sa.Column("machine_model", sa.String(255), nullable=True))
            if "sale_order_id" not in gp_cols:
                op.add_column(
                    "technician_gatepasses",
                    sa.Column(
                        "sale_order_id",
                        app.database.base.GUID(),
                        sa.ForeignKey("sales_orders.id", ondelete="SET NULL") if "sales_orders" in tables else None,
                        nullable=True,
                    ),
                )
            if "stock_deducted" not in gp_cols:
                op.add_column(
                    "technician_gatepasses",
                    sa.Column("stock_deducted", sa.Boolean(), server_default=sa.false(), nullable=False),
                )

    if "technician_gatepass_items" in tables:
        item_cols = {c["name"] for c in insp.get_columns("technician_gatepass_items")}
        if bind.dialect.name == "postgresql":
            op.execute(
                sa.text(
                    "ALTER TABLE technician_gatepass_items "
                    "ADD COLUMN IF NOT EXISTS stock_returned_qty NUMERIC(12, 3) NOT NULL DEFAULT 0.0;"
                )
            )
            op.execute(
                sa.text(
                    "ALTER TABLE technician_gatepass_items "
                    "ADD COLUMN IF NOT EXISTS stock_billed_released_qty NUMERIC(12, 3) NOT NULL DEFAULT 0.0;"
                )
            )
        else:
            if "stock_returned_qty" not in item_cols:
                op.add_column(
                    "technician_gatepass_items",
                    sa.Column("stock_returned_qty", sa.Numeric(12, 3), server_default="0.0", nullable=False),
                )
            if "stock_billed_released_qty" not in item_cols:
                op.add_column(
                    "technician_gatepass_items",
                    sa.Column("stock_billed_released_qty", sa.Numeric(12, 3), server_default="0.0", nullable=False),
                )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if "technician_gatepass_items" in tables:
        item_cols = {c["name"] for c in insp.get_columns("technician_gatepass_items")}
        for col in ("stock_billed_released_qty", "stock_returned_qty"):
            if col in item_cols:
                op.drop_column("technician_gatepass_items", col)

    if "technician_gatepasses" in tables:
        gp_cols = {c["name"] for c in insp.get_columns("technician_gatepasses")}
        for col in ("stock_deducted", "sale_order_id", "machine_model", "warehouse_name"):
            if col in gp_cols:
                op.drop_column("technician_gatepasses", col)

