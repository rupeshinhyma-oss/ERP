"""create_proforma_invoices_table

Creates proforma_invoices and proforma_invoice_items, backing the
Proforma Invoices list at /proforma-invoice/list (see
erp.inhymasolutions.com/proforma-invoice/list, the SALE section's first
module). Follows the same table shape/style as
create_stock_transfers_table -- a denormalized header + line-items
child table, no seed data (this module starts empty; the legacy
screenshot's rows live in the old production system, not fabricated
here).

Revision ID: c04a837cccaf
Revises: c966c07b5020
Create Date: 2026-09-21 07:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.database.base

# revision identifiers, used by Alembic.
revision: str = "c04a837cccaf"
down_revision: Union[str, None] = "c966c07b5020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create proforma_invoices and proforma_invoice_items."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table("proforma_invoices"):
        op.create_table(
            "proforma_invoices",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("proforma_no", sa.String(length=50), nullable=False),
            sa.Column("proforma_date", sa.String(length=50), nullable=False),
            sa.Column("expected_delivery_date", sa.String(length=50), nullable=True),
            sa.Column("warehouse", sa.String(length=100), nullable=False),
            sa.Column("lead_source", sa.String(length=100), nullable=True),
            sa.Column("company_name", sa.String(length=255), nullable=False),
            sa.Column("city", sa.String(length=150), nullable=True),
            sa.Column("state", sa.String(length=150), nullable=True),
            sa.Column("sales_person", sa.String(length=150), nullable=True),
            sa.Column("amount_inc_gst", sa.Float(), server_default="0", nullable=False),
            sa.Column("discount", sa.Float(), server_default="0", nullable=False),
            sa.Column("status", sa.String(length=30), server_default="pending", nullable=False),
            sa.Column("remark", sa.Text(), nullable=True),
            sa.Column("created_by", sa.String(length=100), server_default="Admin User", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_proforma_invoices")),
        )
        op.create_index(op.f("ix_proforma_invoices_proforma_no"), "proforma_invoices", ["proforma_no"], unique=True)
        op.create_index(op.f("ix_proforma_invoices_proforma_date"), "proforma_invoices", ["proforma_date"], unique=False)
        op.create_index(
            op.f("ix_proforma_invoices_expected_delivery_date"),
            "proforma_invoices",
            ["expected_delivery_date"],
            unique=False,
        )
        op.create_index(op.f("ix_proforma_invoices_warehouse"), "proforma_invoices", ["warehouse"], unique=False)
        op.create_index(op.f("ix_proforma_invoices_company_name"), "proforma_invoices", ["company_name"], unique=False)
        op.create_index(op.f("ix_proforma_invoices_sales_person"), "proforma_invoices", ["sales_person"], unique=False)
        op.create_index(op.f("ix_proforma_invoices_status"), "proforma_invoices", ["status"], unique=False)

    if not insp.has_table("proforma_invoice_items"):
        op.create_table(
            "proforma_invoice_items",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("proforma_id", app.database.base.GUID(), nullable=False),
            sa.Column("product_name", sa.String(length=255), nullable=False),
            sa.Column("product_code", sa.String(length=100), nullable=True),
            sa.Column("hsn_code", sa.String(length=50), nullable=True),
            sa.Column("gst_rate", sa.String(length=20), server_default="18%", nullable=True),
            sa.Column("quantity", sa.Float(), server_default="1", nullable=False),
            sa.Column("uom", sa.String(length=50), server_default="Nos", nullable=False),
            sa.Column("rate", sa.Float(), server_default="0", nullable=False),
            sa.Column("amount", sa.Float(), server_default="0", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(
                ["proforma_id"],
                ["proforma_invoices.id"],
                name=op.f("fk_proforma_invoice_items_proforma_id_proforma_invoices"),
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_proforma_invoice_items")),
        )
        op.create_index(
            op.f("ix_proforma_invoice_items_proforma_id"), "proforma_invoice_items", ["proforma_id"], unique=False
        )


def downgrade() -> None:
    """Drop proforma_invoice_items and proforma_invoices."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("proforma_invoice_items"):
        op.drop_index(op.f("ix_proforma_invoice_items_proforma_id"), table_name="proforma_invoice_items")
        op.drop_table("proforma_invoice_items")

    if insp.has_table("proforma_invoices"):
        op.drop_index(op.f("ix_proforma_invoices_status"), table_name="proforma_invoices")
        op.drop_index(op.f("ix_proforma_invoices_sales_person"), table_name="proforma_invoices")
        op.drop_index(op.f("ix_proforma_invoices_company_name"), table_name="proforma_invoices")
        op.drop_index(op.f("ix_proforma_invoices_warehouse"), table_name="proforma_invoices")
        op.drop_index(op.f("ix_proforma_invoices_expected_delivery_date"), table_name="proforma_invoices")
        op.drop_index(op.f("ix_proforma_invoices_proforma_date"), table_name="proforma_invoices")
        op.drop_index(op.f("ix_proforma_invoices_proforma_no"), table_name="proforma_invoices")
        op.drop_table("proforma_invoices")
