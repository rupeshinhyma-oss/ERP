"""phase7 backend completion (projections: supplier, product, inquiry; versioning; export delivery)

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-08

Adds:
- `version` column on `global_buyer_projections`
- `global_supplier_projections` table
- `global_product_projections` table
- `global_inquiry_projections` table
- File delivery columns on `report_export_jobs`: file_path, file_size_bytes, content_type, download_token, expires_at
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _guid():
    """Return a UUID column type: native Postgres UUID, or CHAR(36) elsewhere."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.UUID(as_uuid=True)
    return sa.CHAR(36)


def upgrade() -> None:
    guid = _guid()

    # 1. Add version column to global_buyer_projections
    op.add_column(
        "global_buyer_projections",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )

    # 2. Create global_supplier_projections
    op.create_table(
        "global_supplier_projections",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("source_erp_id", guid, nullable=False),
        sa.Column("source_entity_type", sa.String(length=100), nullable=False, server_default="supplier"),
        sa.Column("source_entity_id", guid, nullable=False),
        sa.Column("supplier_code", sa.String(length=100), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("country", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_event_id", guid, nullable=False),
        sa.Column("last_event_occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["source_erp_id"], ["erp_instances.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "source_erp_id", "source_entity_type", "source_entity_id", name="uq_global_supplier_projection_source"
        ),
    )
    op.create_index("ix_global_supplier_projections_source_erp_id", "global_supplier_projections", ["source_erp_id"])
    op.create_index("ix_global_supplier_projections_source_entity_id", "global_supplier_projections", ["source_entity_id"])
    op.create_index("ix_global_supplier_projections_name", "global_supplier_projections", ["name"])
    op.create_index("ix_global_supplier_projections_supplier_code", "global_supplier_projections", ["supplier_code"])

    # 3. Create global_product_projections
    op.create_table(
        "global_product_projections",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("source_erp_id", guid, nullable=False),
        sa.Column("source_entity_type", sa.String(length=100), nullable=False, server_default="product"),
        sa.Column("source_entity_id", guid, nullable=False),
        sa.Column("product_code", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("uom", sa.String(length=50), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_event_id", guid, nullable=False),
        sa.Column("last_event_occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["source_erp_id"], ["erp_instances.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "source_erp_id", "source_entity_type", "source_entity_id", name="uq_global_product_projection_source"
        ),
    )
    op.create_index("ix_global_product_projections_source_erp_id", "global_product_projections", ["source_erp_id"])
    op.create_index("ix_global_product_projections_source_entity_id", "global_product_projections", ["source_entity_id"])
    op.create_index("ix_global_product_projections_product_code", "global_product_projections", ["product_code"])
    op.create_index("ix_global_product_projections_name", "global_product_projections", ["name"])

    # 4. Create global_inquiry_projections
    op.create_table(
        "global_inquiry_projections",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("source_erp_id", guid, nullable=False),
        sa.Column("source_entity_type", sa.String(length=100), nullable=False, server_default="inquiry"),
        sa.Column("source_entity_id", guid, nullable=False),
        sa.Column("inquiry_number", sa.String(length=100), nullable=False),
        sa.Column("buyer_name", sa.String(length=255), nullable=True),
        sa.Column("season", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=True),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_event_id", guid, nullable=False),
        sa.Column("last_event_occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["source_erp_id"], ["erp_instances.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "source_erp_id", "source_entity_type", "source_entity_id", name="uq_global_inquiry_projection_source"
        ),
    )
    op.create_index("ix_global_inquiry_projections_source_erp_id", "global_inquiry_projections", ["source_erp_id"])
    op.create_index("ix_global_inquiry_projections_source_entity_id", "global_inquiry_projections", ["source_entity_id"])
    op.create_index("ix_global_inquiry_projections_inquiry_number", "global_inquiry_projections", ["inquiry_number"])
    op.create_index("ix_global_inquiry_projections_status", "global_inquiry_projections", ["status"])

    # 5. Add delivery fields to report_export_jobs
    op.add_column("report_export_jobs", sa.Column("file_path", sa.String(length=500), nullable=True))
    op.add_column("report_export_jobs", sa.Column("file_size_bytes", sa.Integer(), nullable=True))
    op.add_column("report_export_jobs", sa.Column("content_type", sa.String(length=100), nullable=True))
    op.add_column("report_export_jobs", sa.Column("download_token", sa.String(length=100), nullable=True))
    op.add_column("report_export_jobs", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_report_export_jobs_download_token", "report_export_jobs", ["download_token"])


def downgrade() -> None:
    op.drop_index("ix_report_export_jobs_download_token", table_name="report_export_jobs")
    op.drop_column("report_export_jobs", "expires_at")
    op.drop_column("report_export_jobs", "download_token")
    op.drop_column("report_export_jobs", "content_type")
    op.drop_column("report_export_jobs", "file_size_bytes")
    op.drop_column("report_export_jobs", "file_path")

    op.drop_index("ix_global_inquiry_projections_status", table_name="global_inquiry_projections")
    op.drop_index("ix_global_inquiry_projections_inquiry_number", table_name="global_inquiry_projections")
    op.drop_index("ix_global_inquiry_projections_source_entity_id", table_name="global_inquiry_projections")
    op.drop_index("ix_global_inquiry_projections_source_erp_id", table_name="global_inquiry_projections")
    op.drop_table("global_inquiry_projections")

    op.drop_index("ix_global_product_projections_name", table_name="global_product_projections")
    op.drop_index("ix_global_product_projections_product_code", table_name="global_product_projections")
    op.drop_index("ix_global_product_projections_source_entity_id", table_name="global_product_projections")
    op.drop_index("ix_global_product_projections_source_erp_id", table_name="global_product_projections")
    op.drop_table("global_product_projections")

    op.drop_index("ix_global_supplier_projections_supplier_code", table_name="global_supplier_projections")
    op.drop_index("ix_global_supplier_projections_name", table_name="global_supplier_projections")
    op.drop_index("ix_global_supplier_projections_source_entity_id", table_name="global_supplier_projections")
    op.drop_index("ix_global_supplier_projections_source_erp_id", table_name="global_supplier_projections")
    op.drop_table("global_supplier_projections")

    op.drop_column("global_buyer_projections", "version")
