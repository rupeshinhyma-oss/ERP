"""seed_company_option_lists

DB-driven option lists for the Company form fields that were hardcoded in the frontend
(Business Type, Business Category, Monthly Turnover, Potential Business per month,
Direct Import from China, Monthly Import Volume) -- spec: "Add Company (client profile) Inhyma".

Revision ID: o1a2b3c4d5ec
Revises: n1a2b3c4d5eb
Create Date: 2026-10-07 09:05:00.000000

"""
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.database.base

revision: str = "o1a2b3c4d5ec"
down_revision: Union[str, None] = "n1a2b3c4d5eb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _simple(*labels):
    return [(x, x, None) for x in labels]


SEED = {
    "company.business_type": _simple("B2B", "B2C"),
    "company.business_category": _simple("Manufacturer", "Trader"),
    "company.monthly_turnover": _simple("0-25 L", "25-50 L", "50-100 L", "100-200 L", "Above 200 Lakhs"),
    "company.potential_business_per_month": _simple("0-2 L", "2-5 L", "5-10 L", "10-20 L", "Above 20 Lakhs"),
    "company.direct_import_from_china": _simple("Yes", "No"),
    "company.monthly_import_volume": _simple("10-25 L", "25-50 L", "Above 50 L"),
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
    for group, items in SEED.items():
        for order, (value, label, meta) in enumerate(items, start=1):
            row = bind.execute(
                sa.select(t.c.id).where(t.c.group_key == group, t.c.value == value, t.c.deleted_at.is_(None))
            ).first()
            if row is None:
                bind.execute(sa.insert(t).values(
                    id=uuid.uuid4(), group_key=group, value=value, label=label, sort_order=order, meta=meta,
                    status="ACTIVE", created_at=now, updated_at=now, version=1))


def downgrade() -> None:
    bind = op.get_bind()
    t = _table()
    bind.execute(sa.delete(t).where(t.c.group_key.in_(list(SEED))))
