"""product_hsn_link_and_dimension_rows

Adds products.hsn_id (FK -> taxes.id), the live HSN Code / GST % / Import
Duty % master (see p6a7b8c9d0e1_create_taxes_table -- this replaced the
now-removed hsn_codes table from o5f6a7b8c9d0_remove_hsn_codes_module),
and a new product_dimension_rows child table backing the multi-row
"Dimensions" table on the Add/Edit Product form (title/length/width/
height/cbm per row, distinct from the single length_cm/width_cm/height_cm/
packaging_unit_cbm "Dimensions For CBM" fields already on products).

Revision ID: c966c07b5020
Revises: f3a4b5c6d7e8
Create Date: 2026-09-21 06:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.database.base

# revision identifiers, used by Alembic.
revision: str = "c966c07b5020"
down_revision: Union[str, None] = "f3a4b5c6d7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add products.hsn_id and create product_dimension_rows."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    product_columns = {c["name"] for c in insp.get_columns("products")}
    if "hsn_id" not in product_columns:
        op.add_column(
            "products",
            sa.Column("hsn_id", app.database.base.GUID(), nullable=True),
        )
        op.create_index(op.f("ix_products_hsn_id"), "products", ["hsn_id"], unique=False)
        op.create_foreign_key(
            "fk_products_hsn_id_taxes",
            "products",
            "taxes",
            ["hsn_id"],
            ["id"],
            ondelete="RESTRICT",
        )

    if not insp.has_table("product_dimension_rows"):
        op.create_table(
            "product_dimension_rows",
            sa.Column("id", app.database.base.GUID(), primary_key=True),
            sa.Column(
                "product_id",
                app.database.base.GUID(),
                sa.ForeignKey("products.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("title", sa.String(255), nullable=True),
            sa.Column("length", sa.Numeric(12, 3), nullable=True),
            sa.Column("width", sa.Numeric(12, 3), nullable=True),
            sa.Column("height", sa.Numeric(12, 3), nullable=True),
            sa.Column("cbm", sa.Numeric(12, 6), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                onupdate=sa.func.now(),
                nullable=False,
            ),
        )
        op.create_index(
            op.f("ix_product_dimension_rows_product_id"),
            "product_dimension_rows",
            ["product_id"],
            unique=False,
        )


def downgrade() -> None:
    """Drop product_dimension_rows and products.hsn_id."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("product_dimension_rows"):
        op.drop_index(op.f("ix_product_dimension_rows_product_id"), table_name="product_dimension_rows")
        op.drop_table("product_dimension_rows")

    product_columns = {c["name"] for c in insp.get_columns("products")}
    if "hsn_id" in product_columns:
        op.drop_constraint("fk_products_hsn_id_taxes", "products", type_="foreignkey")
        op.drop_index(op.f("ix_products_hsn_id"), table_name="products")
        op.drop_column("products", "hsn_id")
