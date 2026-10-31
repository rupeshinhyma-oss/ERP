"""add_product_specification_documents

Creates ``product_specification_documents`` table to store uploaded Product Master
specification documents (PDF, DOC, DOCX, XLS, XLSX, etc.) directly in PostgreSQL
and adds lightweight metadata columns (``specification_doc_id``,
``specification_doc_name``, ``specification_doc_mime``, ``specification_doc_url``)
to ``products`` so document links are saved on each product and auto-attached to CRM Quotations.

Revision ID: z4b5c6d7e8f9
Revises: z3a4b5c6d7e8
Create Date: 2026-10-31 15:55:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.database.base

revision: str = "z4b5c6d7e8f9"
down_revision: Union[str, None] = "z3a4b5c6d7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table("product_specification_documents"):
        op.create_table(
            "product_specification_documents",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("product_id", app.database.base.GUID(), nullable=True),
            sa.Column("filename", sa.String(length=255), nullable=False),
            sa.Column("content_type", sa.String(length=120), nullable=False),
            sa.Column("file_size", sa.Integer(), server_default="0", nullable=False),
            sa.Column("file_data", sa.LargeBinary(), nullable=False),
            sa.Column("uploaded_by", app.database.base.GUID(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_product_specification_documents_product_id",
            "product_specification_documents",
            ["product_id"],
            unique=False,
        )

    if insp.has_table("products"):
        cols = {c["name"] for c in insp.get_columns("products")}
        if "specification_doc_id" not in cols:
            op.add_column("products", sa.Column("specification_doc_id", app.database.base.GUID(), nullable=True))
            op.create_index("ix_products_specification_doc_id", "products", ["specification_doc_id"], unique=False)
        if "specification_doc_name" not in cols:
            op.add_column("products", sa.Column("specification_doc_name", sa.String(length=255), nullable=True))
        if "specification_doc_mime" not in cols:
            op.add_column("products", sa.Column("specification_doc_mime", sa.String(length=120), nullable=True))
        if "specification_doc_url" not in cols:
            op.add_column("products", sa.Column("specification_doc_url", sa.String(length=1000), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("products"):
        existing_ix = {ix["name"] for ix in insp.get_indexes("products")}
        if "ix_products_specification_doc_id" in existing_ix:
            op.drop_index("ix_products_specification_doc_id", table_name="products")
        cols = {c["name"] for c in insp.get_columns("products")}
        for col_name in (
            "specification_doc_url",
            "specification_doc_mime",
            "specification_doc_name",
            "specification_doc_id",
        ):
            if col_name in cols:
                op.drop_column("products", col_name)

    if insp.has_table("product_specification_documents"):
        op.drop_table("product_specification_documents")

