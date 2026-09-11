"""reconcile schema and version columns

Revision ID: g6a7b8c9d0e1
Revises: f5a6b7c8d9e0
Create Date: 2026-09-11 16:35:00.000000

Reconciles missing OCC version columns and table parity:
- units_of_measurement.version
- hsn_codes.version
- consignment_codes.version & branch_id
- inquiry_items.version
- inquiries.branch_id
- planning_sheets.item_description
- planning_columns.description
- inquiry_messages table
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "g6a7b8c9d0e1"
down_revision: Union[str, None] = "f5a6b7c8d9e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OCC_TABLES = [
    "units_of_measurement",
    "hsn_codes",
    "consignment_codes",
    "inquiry_items",
    "master_companies",
    "supplier_types",
    "buyer_types",
]

def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1. Add version columns if missing
    for table_name in OCC_TABLES:
        if insp.has_table(table_name):
            cols = {c["name"] for c in insp.get_columns(table_name)}
            if "version" not in cols:
                op.add_column(
                    table_name,
                    sa.Column("version", sa.Integer(), nullable=False, server_default="1")
                )

    # 2. Planning enhancements
    if insp.has_table("planning_sheets"):
        cols = {c["name"] for c in insp.get_columns("planning_sheets")}
        if "item_description" not in cols:
            op.add_column("planning_sheets", sa.Column("item_description", sa.Text(), nullable=True))

    if insp.has_table("planning_columns"):
        cols = {c["name"] for c in insp.get_columns("planning_columns")}
        if "description" not in cols:
            op.add_column("planning_columns", sa.Column("description", sa.Text(), nullable=True))

    # 3. Branch IDs
    if insp.has_table("consignment_codes"):
        cols = {c["name"] for c in insp.get_columns("consignment_codes")}
        if "branch_id" not in cols:
            op.add_column("consignment_codes", sa.Column("branch_id", sa.String(100), nullable=True))

    if insp.has_table("inquiries"):
        cols = {c["name"] for c in insp.get_columns("inquiries")}
        if "branch_id" not in cols:
            op.add_column("inquiries", sa.Column("branch_id", sa.String(100), nullable=True))

    # 4. User permissions is_granted
    if insp.has_table("user_permissions"):
        cols = {c["name"] for c in insp.get_columns("user_permissions")}
        if "is_granted" not in cols:
            op.add_column("user_permissions", sa.Column("is_granted", sa.Boolean(), nullable=False, server_default="true"))

    # 5. Inquiry messages table
    if not insp.has_table("inquiry_messages"):
        op.create_table(
            "inquiry_messages",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("inquiry_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("inquiries.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("inquiry_item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("inquiry_items.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("supplier_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("channel", sa.String(30), nullable=False, server_default="wechat", index=True),
            sa.Column("direction", sa.String(20), nullable=False, server_default="inbound", index=True),
            sa.Column("sender_name", sa.String(100), nullable=True),
            sa.Column("sender_contact", sa.String(100), nullable=True),
            sa.Column("recipient_contact", sa.String(100), nullable=True),
            sa.Column("message_text", sa.Text(), nullable=False),
            sa.Column("attachment_url", sa.String(500), nullable=True),
            sa.Column("attachment_filename", sa.String(255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )

def downgrade() -> None:
    pass
