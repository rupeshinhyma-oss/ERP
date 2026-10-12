"""seed_proforma_rules

DB-driven Proforma workflow configuration (replaces hardcoded constants):
  * proforma.status    -> allowed transitions, who may edit/delete, admin-only and reason-required steps
  * proforma.defaults  -> default field values for a new PI (Sales & PI spec)
  * proforma.numbering -> PI number prefix and width (spec: 5 digits starting 00001)
  * delivery.type / delivery.charge aligned to the spec (Godown/Door, To Pay/Paid)

Revision ID: k1a2b3c4d5e8
Revises: j1a2b3c4d5e7
Create Date: 2026-10-05 10:05:00.000000

"""
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.database.base

revision: str = "k1a2b3c4d5e8"
down_revision: Union[str, None] = "j1a2b3c4d5e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STATUS_RULES = {
    "pending": {"next": ["admin_approved", "cancelled"], "admin_only_to": ["admin_approved"],
                "reason_required_to": ["cancelled"], "edit": "any", "delete": True, "initial": True},
    "admin_approved": {"next": ["confirmed", "cancelled"], "admin_only_to": [],
                       "reason_required_to": ["cancelled"], "edit": "admin", "delete": False,
                       "action_label": "Approve", "action_color": "#d97706"},
    "confirmed": {"next": [], "admin_only_to": [], "reason_required_to": [], "edit": "none", "delete": False,
                  "action_label": "Confirm", "action_color": "#16a34a"},
    "cancelled": {"next": [], "admin_only_to": [], "reason_required_to": [], "edit": "none", "delete": True,
                  "action_label": "Cancel", "action_color": "#dc2626"},
}

DEFAULTS = [
    ("payment_terms", "100% Advance"),
    ("transport_name", "Not Sure"),
    ("delivery_type", "Godown"),
    ("delivery_charge", "To Pay"),
    ("third_party_delivery", "No"),
    ("self_pickup_transport", "Self Pick-up"),
    ("terms_and_conditions", "Make all cheque payable to USER"),
]
NUMBERING = [("prefix", "PI-"), ("width", "5")]
SPEC_OPTIONS = {
    "delivery.type": ["Godown", "Door"],
    "delivery.charge": ["To Pay", "Paid"],
}


def _table():
    return sa.table(
        "option_lists",
        sa.column("id", app.database.base.GUID()),
        sa.column("group_key", sa.String),
        sa.column("value", sa.String),
        sa.column("label", sa.String),
        sa.column("sort_order", sa.Integer),
        sa.column("meta", sa.JSON),
        sa.column("status", sa.String),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
        sa.column("version", sa.Integer),
        sa.column("deleted_at", sa.DateTime(timezone=True)),
    )


def _upsert(t, bind, group, value, label, order, meta=None, merge_meta=False):
    row = bind.execute(
        sa.select(t.c.id, t.c.meta).where(t.c.group_key == group, t.c.value == value, t.c.deleted_at.is_(None))
    ).first()
    now = datetime.now(timezone.utc)
    if row is None:
        bind.execute(sa.insert(t).values(
            id=uuid.uuid4(), group_key=group, value=value, label=label, sort_order=order, meta=meta,
            status="ACTIVE", created_at=now, updated_at=now, version=1))
        return
    new_meta = row.meta
    if meta is not None:
        new_meta = {**(row.meta or {}), **meta} if merge_meta else meta
    bind.execute(sa.update(t).where(t.c.id == row.id).values(
        label=label, sort_order=order, meta=new_meta, status="ACTIVE", updated_at=now))


def upgrade() -> None:
    bind = op.get_bind()
    t = _table()
    for order, (status, rules) in enumerate(STATUS_RULES.items(), start=2):
        existing = bind.execute(
            sa.select(t.c.label).where(t.c.group_key == "proforma.status", t.c.value == status, t.c.deleted_at.is_(None))
        ).first()
        label = existing.label if existing else status.replace("_", " ").title()
        _upsert(t, bind, "proforma.status", status, label, order, rules, merge_meta=True)
    for order, (key, text) in enumerate(DEFAULTS, start=1):
        _upsert(t, bind, "proforma.defaults", key, text, order)
    for order, (key, text) in enumerate(NUMBERING, start=1):
        _upsert(t, bind, "proforma.numbering", key, text, order)
    now = datetime.now(timezone.utc)
    for group, values in SPEC_OPTIONS.items():
        for order, value in enumerate(values, start=1):
            _upsert(t, bind, group, value, value, order)
        # anything else in the group is not part of the spec: hide it (kept, not deleted)
        bind.execute(
            sa.update(t)
            .where(t.c.group_key == group, t.c.value.notin_(values), t.c.deleted_at.is_(None))
            .values(status="INACTIVE", updated_at=now)
        )


def downgrade() -> None:
    bind = op.get_bind()
    t = _table()
    bind.execute(sa.delete(t).where(t.c.group_key.in_(["proforma.defaults", "proforma.numbering"])))
