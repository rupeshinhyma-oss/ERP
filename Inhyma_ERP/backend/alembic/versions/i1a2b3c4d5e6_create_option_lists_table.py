"""create_option_lists_table

Generic DB-backed option lists replacing hardcoded frontend dropdown constants.

Revision ID: i1a2b3c4d5e6
Revises: h1a2b3c4d5ea
Create Date: 2026-10-01 12:00:00.000000

"""
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.database.base

revision: str = "i1a2b3c4d5e6"
down_revision: Union[str, None] = "h1a2b3c4d5ea"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _simple(*labels):
    return [(x, x, None) for x in labels]


# group_key -> list of (value, label, meta)
SEED = {
    "common.yes_no": _simple("No", "Yes"),
    "delivery.type": _simple("Door Delivery", "Godown Delivery", "To Pay", "Paid", "Self Pickup", "Courier"),
    "delivery.charge": _simple("Paid", "To Pay", "Inclusive", "Exclusive", "Extra as Actual", "Free Delivery"),
    "technical_task.task_type": _simple(
        "Telecall", "Onsite Visit - Client Location", "Onsite Visit - Third-Party Location", "In-house"
    ),
    "technical_task.priority": _simple("A", "B", "C"),
    "technical_task.service_type": _simple("Chargeable", "Free"),
    "technical_task.status": _simple("Pending", "Approved", "Completed", "Cancel"),
    "lead.priority": _simple("Urgent", "High", "Medium", "Low"),
    "lead.status": _simple("New", "Contacted", "In Discussion", "Qualified", "Won", "Lost"),
    "lead.business_type": _simple(
        "Manufacturer", "Trader", "B2B", "Retailer", "OEM", "Distributor", "Service Provider", "Corporate", "Exporter", "Other"
    ),
    "followup.call_type": _simple(
        "Telecall", "Outgoing Call", "Incoming Call", "Site Visit", "Email Correspondence", "WhatsApp Message", "Video Conference"
    ),
    "followup.business_type": _simple("Manufacturer", "Trader", "OEM", "Distributor", "Wholesaler", "Service Provider"),
    "followup.status": _simple("New", "Existing", "Hot Lead", "Warm Lead", "Cold", "In Progress", "Closed / Won"),
    "followup.grade": _simple("Grade A", "Grade B", "Grade C", "Premium"),
    "followup.potential": _simple("High", "Medium", "Low", "None"),
    "user.status": [
        ("ACTIVE", "Active", None),
        ("INACTIVE", "Inactive", None),
        ("SUSPENDED", "Suspended", None),
        ("LOCKED", "Locked", None),
    ],
    "audit.action": [
        ("CREATE", "Create", None), ("UPDATE", "Update", None), ("DELETE", "Delete", None),
        ("LOGIN", "Login", None), ("LOGIN_FAILED", "Login Failed", None), ("LOGOUT", "Logout", None),
        ("PASSWORD_CHANGE", "Password Change", None), ("PASSWORD_RESET", "Password Reset", None),
        ("ROLE_ASSIGNED", "Role Assigned", None), ("ROLE_REMOVED", "Role Removed", None),
        ("IMPORT", "Import", None), ("EXPORT", "Export", None),
        ("FILE_UPLOAD", "File Upload", None), ("FILE_DELETE", "File Delete", None), ("OTHER", "Other", None),
    ],
    "proforma.status": [
        ("all", "All", {"card_label": "ALL", "badge": "badge badge-neutral"}),
        ("pending", "Pending", {"card_label": "PENDING", "badge": "badge badge-neutral"}),
        ("admin_approved", "Admin Approved", {"card_label": "ADMIN APPROVED", "badge": "badge badge-warning"}),
        ("confirmed", "Confirmed", {"card_label": "CONFIRMED", "badge": "badge badge-active"}),
        ("cancelled", "Cancelled", {"card_label": "CANCELLED", "badge": "badge badge-danger"}),
    ],
    "task.status": [
        ("TODO", "To Do", None), ("IN_PROGRESS", "In Progress", None), ("REVIEW", "In Review", None),
        ("DONE", "Completed", None), ("ON_HOLD", "⏸️ On Hold", None), ("PENDING_APPROVAL", "⏳ Pending Approval", None),
    ],
    "task.board_column": [
        ("TODO", "To Do", {"color": "#64748b", "bg": "#f1f5f9"}),
        ("IN_PROGRESS", "In Progress", {"color": "#2563eb", "bg": "#eff6ff"}),
        ("ON_HOLD", "On Hold", {"color": "#d97706", "bg": "#fffbeb"}),
        ("DONE", "Completed", {"color": "#16a34a", "bg": "#f0fdf4"}),
    ],
    "task.kanban_column": [
        ("TODO", "To Do", {"color": "#64748b"}),
        ("IN_PROGRESS", "In Progress", {"color": "#3b82f6"}),
        ("REVIEW", "In Review", {"color": "#f59e0b"}),
        ("PENDING_APPROVAL", "Pending Approval", {"color": "#8b5cf6"}),
        ("ON_HOLD", "On Hold", {"color": "#6b7280"}),
        ("DONE", "Completed", {"color": "#10b981"}),
    ],
}


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table("option_lists"):
        op.create_table(
            "option_lists",
            sa.Column("id", app.database.base.GUID(), primary_key=True),
            sa.Column("group_key", sa.String(100), nullable=False),
            sa.Column("value", sa.String(200), nullable=False),
            sa.Column("label", sa.String(200), nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
            sa.Column("meta", sa.JSON(), nullable=True),
            sa.Column("status", sa.String(20), server_default="ACTIVE", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("group_key", "value", name="uq_option_lists_group_value"),
        )
        op.create_index(op.f("ix_option_lists_group_key"), "option_lists", ["group_key"], unique=False)
        op.create_index(op.f("ix_option_lists_status"), "option_lists", ["status"], unique=False)

    table = sa.table(
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
    )
    existing = {
        (r[0], r[1])
        for r in bind.execute(sa.text("SELECT group_key, value FROM option_lists WHERE deleted_at IS NULL")).fetchall()
    }
    now = datetime.now(timezone.utc)
    rows = []
    for group, items in SEED.items():
        for order, (value, label, meta) in enumerate(items, start=1):
            if (group, value) in existing:
                continue
            rows.append(
                {
                    "id": uuid.uuid4(), "group_key": group, "value": value, "label": label,
                    "sort_order": order, "meta": meta, "status": "ACTIVE",
                    "created_at": now, "updated_at": now, "version": 1,
                }
            )
    if rows:
        op.bulk_insert(table, rows)


def downgrade() -> None:
    op.drop_table("option_lists")
