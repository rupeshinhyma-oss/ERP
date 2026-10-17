"""create_crm_quotations_and_lead_products

Revision ID: p6e7f8g9h0i1
Revises: n5d6e7f8g9h0
Create Date: 2026-10-16 18:20:00.000000

Creates CRM Sales Quotations, Quotation Items, Quotation Versions, and Lead Product associations.
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from app.database.base import GUID


# revision identifiers, used by Alembic.
revision: str = "p6e7f8g9h0i1"
down_revision: Union[str, None] = "n5d6e7f8g9h0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. crm_lead_products
    op.create_table(
        "crm_lead_products",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("lead_id", GUID(), sa.ForeignKey("crm_leads.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("product_id", GUID(), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", GUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("lead_id", "product_id", name="uq_crm_lead_product"),
    )

    # 2. crm_sales_quotations
    op.create_table(
        "crm_sales_quotations",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("quotation_number", sa.String(50), unique=True, nullable=False, index=True),
        sa.Column("lead_id", GUID(), sa.ForeignKey("crm_leads.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("company_id", GUID(), sa.ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("status", sa.String(30), server_default="draft", nullable=False, index=True),
        sa.Column("quotation_date", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("currency", sa.String(10), server_default="INR", nullable=False),
        sa.Column("customer_name_snapshot", sa.String(255), nullable=False),
        sa.Column("customer_phone_snapshot", sa.String(50), nullable=True),
        sa.Column("customer_email_snapshot", sa.String(255), nullable=True),
        sa.Column("company_name_snapshot", sa.String(255), nullable=True),
        sa.Column("subtotal", sa.Numeric(14, 2), server_default="0.00", nullable=False),
        sa.Column("discount_total", sa.Numeric(14, 2), server_default="0.00", nullable=False),
        sa.Column("tax_total", sa.Numeric(14, 2), server_default="0.00", nullable=False),
        sa.Column("total_amount", sa.Numeric(14, 2), server_default="0.00", nullable=False),
        sa.Column("payment_terms", sa.String(255), nullable=True),
        sa.Column("delivery_terms", sa.String(255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("terms_and_conditions", sa.Text(), nullable=True),
        sa.Column("created_by", GUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("created_by_name", sa.String(150), nullable=True),
        sa.Column("updated_by", GUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_crm_sales_quotations_lead_status",
        "crm_sales_quotations",
        ["lead_id", "status"],
        unique=False,
    )

    # 3. crm_quotation_items
    op.create_table(
        "crm_quotation_items",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("quotation_id", GUID(), sa.ForeignKey("crm_sales_quotations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("product_id", GUID(), sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("position", sa.Integer(), server_default="1", nullable=False),
        sa.Column("product_name", sa.String(255), nullable=False),
        sa.Column("product_code", sa.String(50), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("specification", sa.Text(), nullable=True),
        sa.Column("uom", sa.String(50), server_default="Nos", nullable=False),
        sa.Column("include_images", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("selected_image_url", sa.String(1000), nullable=True),
        sa.Column("include_specifications", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("demo_link", sa.String(500), nullable=True),
        sa.Column("quantity", sa.Numeric(12, 3), server_default="1.000", nullable=False),
        sa.Column("unit_price", sa.Numeric(14, 2), server_default="0.00", nullable=False),
        sa.Column("unit_discount", sa.Numeric(14, 2), server_default="0.00", nullable=False),
        sa.Column("tax_rate", sa.Numeric(5, 2), server_default="0.00", nullable=False),
        sa.Column("taxable_amount", sa.Numeric(14, 2), server_default="0.00", nullable=False),
        sa.Column("tax_amount", sa.Numeric(14, 2), server_default="0.00", nullable=False),
        sa.Column("total_amount", sa.Numeric(14, 2), server_default="0.00", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # 4. crm_quotation_versions
    op.create_table(
        "crm_quotation_versions",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("quotation_id", GUID(), sa.ForeignKey("crm_sales_quotations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("snapshot_data", sa.JSON(), nullable=False),
        sa.Column("revision_notes", sa.String(500), nullable=True),
        sa.Column("created_by", GUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_name", sa.String(150), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("crm_quotation_versions")
    op.drop_table("crm_quotation_items")
    op.drop_index("ix_crm_sales_quotations_lead_status", table_name="crm_sales_quotations")
    op.drop_table("crm_sales_quotations")
    op.drop_table("crm_lead_products")
