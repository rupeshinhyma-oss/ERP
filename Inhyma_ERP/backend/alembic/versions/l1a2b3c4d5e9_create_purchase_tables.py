"""create_purchase_tables

Local Purchases and Import Purchases (with line items).

Revision ID: l1a2b3c4d5e9
Revises: k1a2b3c4d5e8
Create Date: 2026-10-06 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.database.base

revision: str = "l1a2b3c4d5e9"
down_revision: Union[str, None] = "k1a2b3c4d5e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())
    if "local_purchases" not in existing:
        op.create_table(
            "local_purchases",
            sa.Column("supplier_name", sa.String(255), nullable=False),
            sa.Column("supplier_id", app.database.base.GUID(), nullable=True),
            sa.Column("warehouse", sa.String(100), nullable=False),
            sa.Column("invoice_no", sa.String(100), nullable=False),
            sa.Column("invoice_date", sa.Date(), nullable=False),
            sa.Column("invoice_value_ex_gst", sa.Float(), nullable=False, server_default="0"),
            sa.Column("invoice_value_inc_gst", sa.Float(), nullable=False, server_default="0"),
            sa.Column("packing_forwarding", sa.Float(), nullable=False, server_default="0"),
            sa.Column("transport", sa.Float(), nullable=False, server_default="0"),
            sa.Column("offloading", sa.Float(), nullable=False, server_default="0"),
            sa.Column("total_expenses", sa.Float(), nullable=False, server_default="0"),
            sa.Column("loading_percent", sa.Float(), nullable=False, server_default="0"),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("bill_file_url", sa.String(500), nullable=True),
            sa.Column("bill_file_name", sa.String(255), nullable=True),
            sa.Column("status", sa.String(30), nullable=False),
            sa.Column("stock_applied", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_by", sa.String(100), nullable=False),
            sa.Column("confirmed_by", sa.String(100), nullable=True),
            sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("id", app.database.base.GUID(), primary_key=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(op.f("ix_local_purchases_supplier_name"), "local_purchases", ["supplier_name"], unique=False)
        op.create_index(op.f("ix_local_purchases_supplier_id"), "local_purchases", ["supplier_id"], unique=False)
        op.create_index(op.f("ix_local_purchases_warehouse"), "local_purchases", ["warehouse"], unique=False)
        op.create_index(op.f("ix_local_purchases_invoice_no"), "local_purchases", ["invoice_no"], unique=False)
        op.create_index(op.f("ix_local_purchases_invoice_date"), "local_purchases", ["invoice_date"], unique=False)
        op.create_index(op.f("ix_local_purchases_status"), "local_purchases", ["status"], unique=False)
    if "local_purchase_items" not in existing:
        op.create_table(
            "local_purchase_items",
            sa.Column("purchase_id", app.database.base.GUID(), sa.ForeignKey("local_purchases.id", ondelete="CASCADE"), nullable=False),
            sa.Column("product_name", sa.String(255), nullable=False),
            sa.Column("product_code", sa.String(100), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("uom", sa.String(50), nullable=True),
            sa.Column("unit_rate", sa.Float(), nullable=False, server_default="0"),
            sa.Column("item_total", sa.Float(), nullable=False, server_default="0"),
            sa.Column("expense_per_unit", sa.Float(), nullable=False, server_default="0"),
            sa.Column("unit_landing_value", sa.Float(), nullable=False, server_default="0"),
            sa.Column("id", app.database.base.GUID(), primary_key=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index(op.f("ix_local_purchase_items_purchase_id"), "local_purchase_items", ["purchase_id"], unique=False)
    if "import_purchases" not in existing:
        op.create_table(
            "import_purchases",
            sa.Column("consignment_no", sa.String(100), nullable=False),
            sa.Column("supplier_name", sa.String(255), nullable=False),
            sa.Column("supplier_id", app.database.base.GUID(), nullable=True),
            sa.Column("warehouse", sa.String(100), nullable=False),
            sa.Column("ordered_date", sa.Date(), nullable=False),
            sa.Column("etd_origin_date", sa.Date(), nullable=True),
            sa.Column("eta_port_date", sa.Date(), nullable=True),
            sa.Column("expected_arrival_date", sa.Date(), nullable=True),
            sa.Column("invoice_date", sa.Date(), nullable=True),
            sa.Column("conversion_rate", sa.Float(), nullable=False, server_default="0"),
            sa.Column("customs_conversion_rate", sa.Float(), nullable=False, server_default="0"),
            sa.Column("invoice_total_usd", sa.Float(), nullable=False, server_default="0"),
            sa.Column("invoice_total_inr", sa.Float(), nullable=False, server_default="0"),
            sa.Column("total_cbm", sa.Float(), nullable=False, server_default="0"),
            sa.Column("total_import_duty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("freight", sa.Float(), nullable=False, server_default="0"),
            sa.Column("insurance", sa.Float(), nullable=False, server_default="0"),
            sa.Column("stamp_duty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("shipping_line_charges", sa.Float(), nullable=False, server_default="0"),
            sa.Column("cfs_charges", sa.Float(), nullable=False, server_default="0"),
            sa.Column("clearing_transport", sa.Float(), nullable=False, server_default="0"),
            sa.Column("offloading", sa.Float(), nullable=False, server_default="0"),
            sa.Column("misc_charges", sa.Float(), nullable=False, server_default="0"),
            sa.Column("misc_remarks", sa.Text(), nullable=True),
            sa.Column("total_expenses", sa.Float(), nullable=False, server_default="0"),
            sa.Column("gross_total_landing", sa.Float(), nullable=False, server_default="0"),
            sa.Column("loading_percent_vb", sa.Float(), nullable=False, server_default="0"),
            sa.Column("loading_amount_per_cbm", sa.Float(), nullable=False, server_default="0"),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("bill_file_url", sa.String(500), nullable=True),
            sa.Column("bill_file_name", sa.String(255), nullable=True),
            sa.Column("status", sa.String(30), nullable=False),
            sa.Column("stock_applied", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_by", sa.String(100), nullable=False),
            sa.Column("confirmed_by", sa.String(100), nullable=True),
            sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("id", app.database.base.GUID(), primary_key=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(op.f("ix_import_purchases_consignment_no"), "import_purchases", ["consignment_no"], unique=False)
        op.create_index(op.f("ix_import_purchases_supplier_name"), "import_purchases", ["supplier_name"], unique=False)
        op.create_index(op.f("ix_import_purchases_supplier_id"), "import_purchases", ["supplier_id"], unique=False)
        op.create_index(op.f("ix_import_purchases_warehouse"), "import_purchases", ["warehouse"], unique=False)
        op.create_index(op.f("ix_import_purchases_ordered_date"), "import_purchases", ["ordered_date"], unique=False)
        op.create_index(op.f("ix_import_purchases_status"), "import_purchases", ["status"], unique=False)
    if "import_purchase_items" not in existing:
        op.create_table(
            "import_purchase_items",
            sa.Column("purchase_id", app.database.base.GUID(), sa.ForeignKey("import_purchases.id", ondelete="CASCADE"), nullable=False),
            sa.Column("product_name", sa.String(255), nullable=False),
            sa.Column("product_code", sa.String(100), nullable=True),
            sa.Column("uom", sa.String(50), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("pkg_unit_cbm", sa.Float(), nullable=False, server_default="0"),
            sa.Column("pkg_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("item_total_cbm", sa.Float(), nullable=False, server_default="0"),
            sa.Column("unit_rate_usd", sa.Float(), nullable=False, server_default="0"),
            sa.Column("unit_rate_inr", sa.Float(), nullable=False, server_default="0"),
            sa.Column("item_total_usd", sa.Float(), nullable=False, server_default="0"),
            sa.Column("duty_percent", sa.Float(), nullable=False, server_default="0"),
            sa.Column("unit_import_duty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("item_total_duty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("exp_per_unit_vb", sa.Float(), nullable=False, server_default="0"),
            sa.Column("exp_per_unit_cb", sa.Float(), nullable=False, server_default="0"),
            sa.Column("unit_landing_vb", sa.Float(), nullable=False, server_default="0"),
            sa.Column("unit_landing_cb", sa.Float(), nullable=False, server_default="0"),
            sa.Column("landing_diff", sa.Float(), nullable=False, server_default="0"),
            sa.Column("id", app.database.base.GUID(), primary_key=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index(op.f("ix_import_purchase_items_purchase_id"), "import_purchase_items", ["purchase_id"], unique=False)


def downgrade() -> None:
    op.drop_table("import_purchase_items")
    op.drop_table("import_purchases")
    op.drop_table("local_purchase_items")
    op.drop_table("local_purchases")
