"""extend_proforma_invoice

Persist every field the Sales & PI spec requires (commercial terms, addresses, per-line
pricing breakdown, approval / cancellation tracking, minimum-price flag).

Revision ID: j1a2b3c4d5e7
Revises: i1a2b3c4d5e6
Create Date: 2026-10-05 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "j1a2b3c4d5e7"
down_revision: Union[str, None] = "i1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

HEADER_COLUMNS = [
    ("payment_terms", sa.String(100), {}),
    ("transport_name", sa.String(150), {}),
    ("transport_destination", sa.String(150), {}),
    ("delivery_type", sa.String(50), {}),
    ("delivery_charge", sa.String(50), {}),
    ("third_party_delivery", sa.String(10), {}),
    ("billing_address", sa.Text(), {}),
    ("shipping_address", sa.Text(), {}),
    ("terms_and_conditions", sa.Text(), {}),
    ("taxable_amount", sa.Float(), {"nullable": False, "server_default": "0"}),
    ("gst_amount", sa.Float(), {"nullable": False, "server_default": "0"}),
    ("below_min_price", sa.Boolean(), {"nullable": False, "server_default": sa.false()}),
    ("cancel_reason", sa.Text(), {}),
    ("approved_by", sa.String(100), {}),
    ("approved_at", sa.DateTime(timezone=True), {}),
    ("confirmed_by", sa.String(100), {}),
    ("confirmed_at", sa.DateTime(timezone=True), {}),
    ("cancelled_by", sa.String(100), {}),
    ("cancelled_at", sa.DateTime(timezone=True), {}),
]

ITEM_COLUMNS = [
    ("unit_discount", sa.Float(), {"nullable": False, "server_default": "0"}),
    ("taxable_amount", sa.Float(), {"nullable": False, "server_default": "0"}),
    ("gst_percent", sa.Float(), {"nullable": False, "server_default": "0"}),
    ("gst_amount", sa.Float(), {"nullable": False, "server_default": "0"}),
    ("total", sa.Float(), {"nullable": False, "server_default": "0"}),
    ("is_additional_charge", sa.Boolean(), {"nullable": False, "server_default": sa.false()}),
    ("charge_type", sa.String(150), {}),
]


def _add_missing(table: str, columns) -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}
    for name, col_type, kwargs in columns:
        if name not in existing:
            op.add_column(table, sa.Column(name, col_type, **({"nullable": True} | kwargs)))


def upgrade() -> None:
    _add_missing("proforma_invoices", HEADER_COLUMNS)
    _add_missing("proforma_invoice_items", ITEM_COLUMNS)


def downgrade() -> None:
    for name, *_ in reversed(ITEM_COLUMNS):
        op.drop_column("proforma_invoice_items", name)
    for name, *_ in reversed(HEADER_COLUMNS):
        op.drop_column("proforma_invoices", name)
