"""Reconcile schema drift on fresh PG18 DBs (products, hsn_codes, supplier_product_links)

Revision ID: h0c1d2e3f4a5
Revises: g9b0c1d2e3f4
Create Date: 2026-11-28 11:50:00.000000

Idempotently reconciles ORM-mapped columns missing on fresh Alembic upgrades:
- ``products.supplier_id`` (UUID FK -> suppliers.id, indexed)
- ``products.purchase_vat_percent`` (NUMERIC(5, 2) NOT NULL DEFAULT 0.0)
- ``hsn_codes.import_duty_percent`` (NUMERIC(5, 2) NOT NULL DEFAULT 0.0)
- ``hsn_codes.purchase_vat_percent`` (NUMERIC(5, 2) NOT NULL DEFAULT 0.0)
- ``supplier_product_links.unit_price`` (FLOAT NULL)
- ``supplier_product_links.currency`` (VARCHAR(10) NOT NULL DEFAULT 'CNY')
- ``supplier_product_links.moq`` (FLOAT NULL)
- ``supplier_product_links.notes`` (TEXT NULL)
- ``supplier_product_links.updated_at`` (TIMESTAMPTZ NOT NULL DEFAULT now())
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "h0c1d2e3f4a5"
down_revision: Union[str, None] = "g9b0c1d2e3f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "products" in existing_tables:
        product_cols = {c["name"] for c in inspector.get_columns("products")}
        if "supplier_id" not in product_cols:
            op.add_column(
                "products",
                sa.Column(
                    "supplier_id",
                    postgresql.UUID(as_uuid=True),
                    sa.ForeignKey("suppliers.id", ondelete="SET NULL"),
                    nullable=True,
                ),
            )
        if "purchase_vat_percent" not in product_cols:
            op.add_column(
                "products",
                sa.Column(
                    "purchase_vat_percent",
                    sa.Numeric(5, 2),
                    server_default="0.00",
                    nullable=False,
                ),
            )
        product_indexes = {idx["name"] for idx in inspector.get_indexes("products")}
        if "ix_products_supplier_id" not in product_indexes:
            op.create_index("ix_products_supplier_id", "products", ["supplier_id"], unique=False)

    if "hsn_codes" in existing_tables:
        hsn_cols = {c["name"] for c in inspector.get_columns("hsn_codes")}
        if "import_duty_percent" not in hsn_cols:
            op.add_column(
                "hsn_codes",
                sa.Column(
                    "import_duty_percent",
                    sa.Numeric(5, 2),
                    server_default="0.00",
                    nullable=False,
                ),
            )
        if "purchase_vat_percent" not in hsn_cols:
            op.add_column(
                "hsn_codes",
                sa.Column(
                    "purchase_vat_percent",
                    sa.Numeric(5, 2),
                    server_default="0.00",
                    nullable=False,
                ),
            )

    if "supplier_product_links" in existing_tables:
        spl_cols = {c["name"] for c in inspector.get_columns("supplier_product_links")}
        if "unit_price" not in spl_cols:
            op.add_column("supplier_product_links", sa.Column("unit_price", sa.Float(), nullable=True))
        if "currency" not in spl_cols:
            op.add_column(
                "supplier_product_links",
                sa.Column("currency", sa.String(length=10), server_default="CNY", nullable=False),
            )
        if "moq" not in spl_cols:
            op.add_column("supplier_product_links", sa.Column("moq", sa.Float(), nullable=True))
        if "notes" not in spl_cols:
            op.add_column("supplier_product_links", sa.Column("notes", sa.Text(), nullable=True))
        if "updated_at" not in spl_cols:
            op.add_column(
                "supplier_product_links",
                sa.Column(
                    "updated_at",
                    sa.DateTime(timezone=True),
                    server_default=sa.func.now(),
                    nullable=False,
                ),
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "supplier_product_links" in existing_tables:
        spl_cols = {c["name"] for c in inspector.get_columns("supplier_product_links")}
        for col_name in ("updated_at", "notes", "moq", "currency", "unit_price"):
            if col_name in spl_cols:
                op.drop_column("supplier_product_links", col_name)

    if "hsn_codes" in existing_tables:
        hsn_cols = {c["name"] for c in inspector.get_columns("hsn_codes")}
        for col_name in ("purchase_vat_percent", "import_duty_percent"):
            if col_name in hsn_cols:
                op.drop_column("hsn_codes", col_name)

    if "products" in existing_tables:
        product_indexes = {idx["name"] for idx in inspector.get_indexes("products")}
        if "ix_products_supplier_id" in product_indexes:
            op.drop_index("ix_products_supplier_id", table_name="products")
        product_cols = {c["name"] for c in inspector.get_columns("products")}
        for col_name in ("purchase_vat_percent", "supplier_id"):
            if col_name in product_cols:
                op.drop_column("products", col_name)
