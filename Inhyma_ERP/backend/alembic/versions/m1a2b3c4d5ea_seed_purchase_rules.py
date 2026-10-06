"""seed_purchase_rules

DB-driven workflow for Local and Import Purchases (statuses, who may edit / delete / confirm,
which status adds stock) plus the import form defaults. Nothing here is hardcoded in the app.

Revision ID: m1a2b3c4d5ea
Revises: l1a2b3c4d5e9
Create Date: 2026-10-06 10:05:00.000000

"""
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.database.base

revision: str = "m1a2b3c4d5ea"
down_revision: Union[str, None] = "l1a2b3c4d5e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEUTRAL, ACTIVE, WARN, DONE = "badge badge-neutral", "badge badge-active", "badge badge-warning", "badge badge-neutral"

# group -> [(value, label, meta)]
SEED = {
    "purchase.local.status": [
        ("all", "All", {"card_label": "ALL", "badge": NEUTRAL}),
        ("pending", "Pending", {
            "card_label": "PENDING", "badge": NEUTRAL, "next": ["confirmed"], "admin_only_to": [],
            "perm_to": {"confirmed": "localpurchase.confirm"}, "reason_required_to": [],
            "edit": "perm:localpurchase.update", "delete": "admin", "initial": True}),
        ("confirmed", "Confirmed", {
            "card_label": "CONFIRMED", "badge": ACTIVE, "next": [], "admin_only_to": [], "reason_required_to": [],
            "edit": "none", "delete": "admin", "stock_in": True, "action_label": "Confirm", "action_color": "#16a34a"}),
    ],
    "purchase.import.status": [
        ("all", "All", {"card_label": "ALL", "badge": NEUTRAL}),
        ("pending", "Pending", {
            "card_label": "PENDING", "badge": NEUTRAL, "next": ["confirmed"], "admin_only_to": [], "reason_required_to": [],
            "edit": "any", "delete": "any", "initial": True, "stock_in": True}),
        ("confirmed", "Confirmed", {
            "card_label": "CONFIRMED", "badge": ACTIVE, "next": ["received"], "admin_only_to": [], "reason_required_to": [],
            "edit": "admin", "delete": "admin", "action_label": "Confirm", "action_color": "#16a34a"}),
        ("received", "Received", {
            "card_label": "RECEIVED", "badge": WARN, "next": ["closed"], "admin_only_to": ["closed"], "reason_required_to": [],
            "edit": "any", "delete": "none", "action_label": "Receive", "action_color": "#2563eb"}),
        ("closed", "Closed", {
            "card_label": "CLOSED", "badge": DONE, "next": [], "admin_only_to": [], "reason_required_to": [],
            "edit": "none", "delete": "none", "action_label": "Close", "action_color": "#475569"}),
    ],
    "purchase.import.defaults": [
        ("supplier", "Yinglima", None),
        ("warehouse", "Mumbai Ordered", None),
    ],
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
    t = _table()
    now = datetime.now(timezone.utc)
    for group, rows in SEED.items():
        for order, (value, label, meta) in enumerate(rows, start=1):
            row = bind.execute(
                sa.select(t.c.id).where(t.c.group_key == group, t.c.value == value, t.c.deleted_at.is_(None))
            ).first()
            if row is None:
                bind.execute(sa.insert(t).values(
                    id=uuid.uuid4(), group_key=group, value=value, label=label, sort_order=order, meta=meta,
                    status="ACTIVE", created_at=now, updated_at=now, version=1))
            else:
                bind.execute(sa.update(t).where(t.c.id == row.id).values(
                    label=label, sort_order=order, meta=meta, status="ACTIVE", updated_at=now))


def downgrade() -> None:
    bind = op.get_bind()
    t = _table()
    bind.execute(sa.delete(t).where(t.c.group_key.in_(list(SEED))))
