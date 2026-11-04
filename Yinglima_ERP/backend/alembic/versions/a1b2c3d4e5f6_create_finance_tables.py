"""Create finance_record_meta and finance_payments tables

Revision ID: a1b2c3d4e5f6
Revises: f7a8b9c0d1e2
Create Date: 2026-11-02 12:35:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    if "finance_record_meta" not in existing_tables:
        op.create_table(
            "finance_record_meta",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("source_type", sa.String(length=32), nullable=False),
            sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("payment_terms", sa.String(length=120), nullable=True),
            sa.Column("expected_dispatch_date", sa.Date(), nullable=True),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("delivery_status", sa.String(length=80), nullable=True),
            sa.Column("attachment_url", sa.String(length=500), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("tt_received_date", sa.Date(), nullable=True),
            sa.Column("expected_stuffing_date", sa.String(length=100), nullable=True),
            sa.Column("bl_details", sa.String(length=150), nullable=True),
            sa.Column("bl_status", sa.String(length=80), nullable=True),
            sa.Column("bill_status", sa.String(length=80), nullable=True),
            sa.Column("agent_name", sa.String(length=150), nullable=True),
            sa.Column(
                "agent_local_charge",
                sa.Numeric(15, 2),
                nullable=False,
                server_default=sa.text("0.00"),
            ),
            sa.Column(
                "agent_freight_charge",
                sa.Numeric(15, 2),
                nullable=False,
                server_default=sa.text("0.00"),
            ),
            sa.Column(
                "agent_inv_amount",
                sa.Numeric(15, 2),
                nullable=False,
                server_default=sa.text("0.00"),
            ),
            sa.Column("agent_payment_date", sa.Date(), nullable=True),
            sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("updated_by_name", sa.String(length=150), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.UniqueConstraint("source_type", "source_id", name="uq_finance_record_meta_source"),
        )
        op.create_index(
            "ix_finance_record_meta_source",
            "finance_record_meta",
            ["source_type", "source_id"],
        )

    if "finance_payments" not in existing_tables:
        op.create_table(
            "finance_payments",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("source_type", sa.String(length=32), nullable=False),
            sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("payment_date", sa.Date(), nullable=False),
            sa.Column(
                "amount",
                sa.Numeric(15, 2),
                nullable=False,
                server_default=sa.text("0.00"),
            ),
            sa.Column(
                "currency",
                sa.String(length=16),
                nullable=False,
                server_default=sa.text("'RMB'"),
            ),
            sa.Column("payment_mode", sa.String(length=100), nullable=True),
            sa.Column(
                "bank_charges",
                sa.Numeric(15, 2),
                nullable=False,
                server_default=sa.text("0.00"),
            ),
            sa.Column("reference_no", sa.String(length=150), nullable=True),
            sa.Column("attachment_url", sa.String(length=500), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("created_by_name", sa.String(length=150), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(
            "ix_finance_payments_source",
            "finance_payments",
            ["source_type", "source_id"],
        )
        op.create_index(
            "ix_finance_payments_date",
            "finance_payments",
            ["payment_date"],
        )

    if "consignment_overviews" not in existing_tables:
        op.create_table(
            "consignment_overviews",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("consignment_key", sa.String(length=120), nullable=False),
            sa.Column("documents_json", sa.Text(), nullable=True, server_default=sa.text("'{}'")),
            sa.Column("checklist_json", sa.Text(), nullable=True, server_default=sa.text("'{}'")),
            sa.Column("cargo_remarks", sa.Text(), nullable=True),
            sa.Column("etd_origin_date", sa.Date(), nullable=True),
            sa.Column("eta_port_date", sa.Date(), nullable=True),
            sa.Column("forwarder_name", sa.String(length=150), nullable=True),
            sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("updated_by_name", sa.String(length=150), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.UniqueConstraint("consignment_key", name="uq_consignment_overviews_key"),
        )
        op.create_index(
            "ix_consignment_overviews_key",
            "consignment_overviews",
            ["consignment_key"],
        )

    if "vat_return_records" not in existing_tables:
        op.create_table(
            "vat_return_records",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("source_type", sa.String(length=32), nullable=False, server_default=sa.text("'sale_order'")),
            sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("exp_no", sa.String(length=120), nullable=False),
            sa.Column("invoice_date", sa.Date(), nullable=True),
            sa.Column("financial_year", sa.String(length=32), nullable=True),
            sa.Column("consignment_code", sa.String(length=120), nullable=True),
            sa.Column("buyer_name", sa.String(length=200), nullable=True),
            sa.Column("organization_name", sa.String(length=150), nullable=True),
            sa.Column("first_filing_date", sa.Date(), nullable=True),
            sa.Column("receiving_date_text", sa.String(length=150), nullable=True),
            sa.Column("status_override", sa.String(length=40), nullable=True),
            sa.Column("total_rmb_incl_vat_override", sa.Numeric(15, 2), nullable=True),
            sa.Column("total_vat_return_override", sa.Numeric(15, 2), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("items_override_json", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
            sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("updated_by_name", sa.String(length=150), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("exp_no", name="uq_vat_return_records_exp_no"),
        )
        op.create_index("ix_vat_return_records_exp_no", "vat_return_records", ["exp_no"])
        op.create_index("ix_vat_return_records_source", "vat_return_records", ["source_type", "source_id"])

    if "vat_return_receipts" not in existing_tables:
        op.create_table(
            "vat_return_receipts",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("vat_record_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("exp_no", sa.String(length=120), nullable=False),
            sa.Column("receipt_date", sa.Date(), nullable=False),
            sa.Column("amount_rmb", sa.Numeric(15, 2), nullable=False, server_default=sa.text("0.00")),
            sa.Column("reference_no", sa.String(length=150), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("created_by_name", sa.String(length=150), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_vat_return_receipts_record", "vat_return_receipts", ["vat_record_id"])
        op.create_index("ix_vat_return_receipts_exp_no", "vat_return_receipts", ["exp_no"])
        op.create_index("ix_vat_return_receipts_date", "vat_return_receipts", ["receipt_date"])


def downgrade() -> None:
    op.drop_table("vat_return_receipts")
    op.drop_table("vat_return_records")
    op.drop_table("consignment_overviews")
    op.drop_table("finance_payments")
    op.drop_table("finance_record_meta")

