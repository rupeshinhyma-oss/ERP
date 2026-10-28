"""add_lr_file_and_dispatch_media_to_sales_orders

Adds LR document & multiple dispatch media columns to ``sales_orders`` and updates
the ``dispatched`` status rule in ``option_lists`` so ``Dispatched`` allows
transitioning to both ``lr`` and ``gatepass_cancelled`` (matching production
``erp.inhymasolutions.com/sale-order/list``).

Revision ID: w8b9c0d1e2f3
Revises: v7a8b9c0d1e2
Create Date: 2026-10-28 15:05:00.000000

"""
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.database.base

revision: str = "w8b9c0d1e2f3"
down_revision: Union[str, None] = "v7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _option_table():
    return sa.table(
        "option_lists",
        sa.column("id", app.database.base.GUID()),
        sa.column("group_key", sa.String),
        sa.column("value", sa.String),
        sa.column("meta", sa.JSON),
        sa.column("updated_at", sa.DateTime(timezone=True)),
        sa.column("deleted_at", sa.DateTime(timezone=True)),
    )


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("sales_orders"):
        cols = {c["name"] for c in insp.get_columns("sales_orders")}
        if "lr_date" not in cols:
            op.add_column("sales_orders", sa.Column("lr_date", sa.String(50), nullable=True))
        if "lr_file_url" not in cols:
            op.add_column("sales_orders", sa.Column("lr_file_url", sa.String(500), nullable=True))
        if "lr_file_name" not in cols:
            op.add_column("sales_orders", sa.Column("lr_file_name", sa.String(255), nullable=True))
        if "dispatch_media" not in cols:
            op.add_column("sales_orders", sa.Column("dispatch_media", sa.JSON(), nullable=True))

    if insp.has_table("option_lists"):
        t = _option_table()
        row = bind.execute(
            sa.select(t.c.id, t.c.meta).where(
                t.c.group_key == "sale.order.status",
                t.c.value == "dispatched",
                t.c.deleted_at.is_(None),
            )
        ).first()
        if row is not None:
            meta = dict(row.meta or {})
            next_list = list(meta.get("next") or [])
            if "lr" not in next_list:
                next_list.insert(0, "lr")
            if "gatepass_cancelled" not in next_list:
                next_list.append("gatepass_cancelled")
            perm_to = dict(meta.get("perm_to") or {})
            perm_to.setdefault("lr", "saleorder.warehouse")
            perm_to.setdefault("gatepass_cancelled", "saleorder.warehouse")
            phys_to = list(meta.get("physical_only_to") or [])
            if "lr" not in phys_to:
                phys_to.append("lr")
            if "gatepass_cancelled" not in phys_to:
                phys_to.append("gatepass_cancelled")
            meta["next"] = next_list
            meta["perm_to"] = perm_to
            meta["physical_only_to"] = phys_to
            bind.execute(
                sa.update(t)
                .where(t.c.id == row.id)
                .values(meta=meta, updated_at=datetime.now(timezone.utc))
            )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table("option_lists"):
        t = _option_table()
        row = bind.execute(
            sa.select(t.c.id, t.c.meta).where(
                t.c.group_key == "sale.order.status",
                t.c.value == "dispatched",
                t.c.deleted_at.is_(None),
            )
        ).first()
        if row is not None:
            meta = dict(row.meta or {})
            meta["next"] = [s for s in (meta.get("next") or []) if s != "gatepass_cancelled"]
            perm_to = dict(meta.get("perm_to") or {})
            perm_to.pop("gatepass_cancelled", None)
            meta["perm_to"] = perm_to
            meta["physical_only_to"] = [
                s for s in (meta.get("physical_only_to") or []) if s != "gatepass_cancelled"
            ]
            bind.execute(
                sa.update(t)
                .where(t.c.id == row.id)
                .values(meta=meta, updated_at=datetime.now(timezone.utc))
            )

