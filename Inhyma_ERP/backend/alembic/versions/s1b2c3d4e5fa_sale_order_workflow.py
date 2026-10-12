"""sale_order_workflow

Makes the Sale Order workflow database-driven and keeps stock consistent with it.

* adds ``sales_orders.cancel_reason``, ``terms_and_conditions``, ``booking_remarks`` and ``stock_applied``,
  and ``sales_order_items.is_additional_charge`` / ``charge_type``
* backfills ``stock_applied``: until now an order's quantities were deducted from stock when it was created,
  but only for physical warehouses, so existing orders in physical warehouses are marked as applied
* seeds the ``sale.order.status`` rules (statuses, allowed next steps, who may approve / confirm at accounts /
  create the gatepass, edit and delete rules, which steps need a physical warehouse, and which statuses hold stock)

Revision ID: s1b2c3d4e5fa
Revises: r1b2c3d4e5f9
Create Date: 2026-10-08 11:00:00.000000

"""
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.database.base

revision: str = "s1b2c3d4e5fa"
down_revision: Union[str, None] = "r1b2c3d4e5f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

GROUP = "sale.order.status"

# Spec (Sales & PI Process): Pending -> Sales Confirmed -> Admin Approved -> Acc Confirmed -> Gatepass Created ->
# Dispatched -> LR, with Gatepass Cancelled and Cancelled as side paths. Edit stops once Admin Approved; delete is
# admin-only except Pending (users granted saleorder.delete); LR is final (no edit, no delete).
RULES = {
    "pending": {
        "label": "Pending", "next": ["sales_confirmed", "cancelled"], "reason_required_to": ["cancelled"],
        "edit": "any", "delete": "perm:saleorder.delete", "initial": True, "stock_out": True,
        "action_label": "Confirm", "action_color": "#16a34a",
    },
    "sales_confirmed": {
        "label": "Sales Confirmed", "next": ["admin_approved", "cancelled"],
        "perm_to": {"admin_approved": "saleorder.approve"}, "reason_required_to": ["cancelled"],
        "physical_only_to": ["admin_approved"], "edit": "any", "delete": "admin", "stock_out": True,
        "action_label": "Admin Approve", "action_color": "#2563eb",
    },
    "admin_approved": {
        "label": "Admin Approved", "next": ["acc_confirmed", "cancelled"],
        "perm_to": {"acc_confirmed": "saleorder.accounts"}, "reason_required_to": ["cancelled"],
        "physical_only_to": ["acc_confirmed"], "edit": "none", "delete": "admin", "stock_out": True,
        "action_label": "Accounts Confirm", "action_color": "#7c3aed",
    },
    "acc_confirmed": {
        "label": "Acc. Confirmed", "next": ["gatepass_created"],
        "perm_to": {"gatepass_created": "saleorder.warehouse"}, "physical_only_to": ["gatepass_created"],
        "edit": "none", "delete": "admin", "stock_out": True,
        "action_label": "Create Gatepass", "action_color": "#0891b2",
    },
    "gatepass_created": {
        "label": "Gatepass Created", "next": ["dispatched", "gatepass_cancelled"],
        "perm_to": {"dispatched": "saleorder.warehouse", "gatepass_cancelled": "saleorder.warehouse"},
        "reason_required_to": ["gatepass_cancelled"], "physical_only_to": ["dispatched", "gatepass_cancelled"],
        "edit": "none", "delete": "admin", "stock_out": True,
        "action_label": "Dispatch", "action_color": "#d97706",
    },
    "dispatched": {
        "label": "Dispatched", "next": ["lr"], "perm_to": {"lr": "saleorder.warehouse"},
        "physical_only_to": ["lr"], "edit": "none", "delete": "admin", "stock_out": True,
        "action_label": "Attach LR", "action_color": "#059669",
    },
    "gatepass_cancelled": {
        "label": "Gatepass Cancelled", "next": ["gatepass_created", "cancelled"],
        "perm_to": {"gatepass_created": "saleorder.warehouse"}, "reason_required_to": ["cancelled"],
        "physical_only_to": ["gatepass_created"], "edit": "none", "delete": "admin", "stock_out": True,
        "action_label": "Create Gatepass", "action_color": "#0891b2",
    },
    "lr": {
        "label": "LR", "next": [], "edit": "none", "delete": "none", "stock_out": True,
        "action_label": "", "action_color": "#475569",
    },
    "cancelled": {
        "label": "Cancelled", "next": [], "edit": "none", "delete": "admin", "stock_out": False,
        "action_label": "", "action_color": "#dc2626",
    },
}


def _table():
    return sa.table(
        "option_lists",
        sa.column("id", app.database.base.GUID()), sa.column("group_key", sa.String), sa.column("value", sa.String),
        sa.column("label", sa.String), sa.column("sort_order", sa.Integer), sa.column("meta", sa.JSON),
        sa.column("status", sa.String), sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)), sa.column("version", sa.Integer),
        sa.column("deleted_at", sa.DateTime(timezone=True)),
    )


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    cols = {c["name"] for c in insp.get_columns("sales_orders")}
    added_stock_flag = "stock_applied" not in cols
    if "cancel_reason" not in cols:
        op.add_column("sales_orders", sa.Column("cancel_reason", sa.Text(), nullable=True))
    for name in ("terms_and_conditions", "booking_remarks"):
        if name not in cols:
            op.add_column("sales_orders", sa.Column(name, sa.Text(), nullable=True))
    if insp.has_table("sales_order_items"):
        item_cols = {c["name"] for c in insp.get_columns("sales_order_items")}
        if "is_additional_charge" not in item_cols:
            op.add_column("sales_order_items", sa.Column("is_additional_charge", sa.Boolean(), nullable=False, server_default=sa.false()))
        if "charge_type" not in item_cols:
            op.add_column("sales_order_items", sa.Column("charge_type", sa.String(100), nullable=True))
    if added_stock_flag:
        op.add_column("sales_orders", sa.Column("stock_applied", sa.Boolean(), nullable=False, server_default=sa.false()))
        # Orders created before this migration had their stock deducted at creation, in physical warehouses only.
        if insp.has_table("warehouses"):
            bind.execute(sa.text(
                "UPDATE sales_orders SET stock_applied = TRUE WHERE deleted_at IS NULL AND warehouse IN "
                "(SELECT name FROM warehouses WHERE main_warehouse_id IS NULL AND deleted_at IS NULL)"
            ))

    t = _table()
    now = datetime.now(timezone.utc)
    for order, (value, meta) in enumerate(RULES.items(), start=1):
        label = meta["label"]
        row = bind.execute(
            sa.select(t.c.id, t.c.meta).where(t.c.group_key == GROUP, t.c.value == value, t.c.deleted_at.is_(None))
        ).first()
        if row is None:
            bind.execute(sa.insert(t).values(
                id=uuid.uuid4(), group_key=GROUP, value=value, label=label, sort_order=order, meta=meta,
                status="ACTIVE", created_at=now, updated_at=now, version=1))
        else:
            bind.execute(sa.update(t).where(t.c.id == row.id).values(
                label=label, sort_order=order, meta={**(row.meta or {}), **meta}, status="ACTIVE", updated_at=now))


def downgrade() -> None:
    bind = op.get_bind()
    t = _table()
    bind.execute(sa.delete(t).where(t.c.group_key == GROUP))
    # the two columns are left in place: dropping them would lose stock bookkeeping on live orders
