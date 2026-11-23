"""add granular technician operations permissions for tabs, CTAs, action buttons, wallet cards, and warranty validator

Revision ID: z5d6e7f8a9b0
Revises: z4c5d6e7f8a9
Create Date: 2026-11-20 12:15:00.000000

Adds granular UI/action permissions to the Technician Gatepass & Wallet Management module:
- Tabs: technician_operations.gatepasses.view, technician_operations.wallets.view, technician_operations.warranty.view
- Header CTAs: technician_operations.gatepass.create, technician_operations.wallet.create, technician_operations.warranty.create
- Gatepass Actions: technician_operations.gatepass.return, draft_so, create_so, link_so, print, details
- Wallet Balances & Card Actions: technician_operations.wallet.balances.view, collect, handover, expense
- Warranty Validator: technician_operations.warranty.validate
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "z5d6e7f8a9b0"
down_revision: Union[str, None] = "z4c5d6e7f8a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    ("technician_operations.gatepasses.view", "technician_operations", "technician-operations", "view", "ALL", "View the Spare Parts Gatepass & Returns tab in Technician Operations."),
    ("technician_operations.gatepass.create", "technician_operations", "technician-operations", "create", "ALL", "Show + Issue Outward Gatepass button and create outward spare parts gatepasses."),
    ("technician_operations.gatepass.return", "technician_operations", "technician-operations", "update", "ALL", "View/use Return action button on gatepasses to reconcile returned and consumed parts."),
    ("technician_operations.gatepass.draft_so", "technician_operations", "technician-operations", "view", "ALL", "View/use Draft SO action button on gatepasses to inspect billable consumed items."),
    ("technician_operations.gatepass.create_so", "technician_operations", "technician-operations", "create", "ALL", "View/use Create SO action button to launch a Sales Order for consumed gatepass parts."),
    ("technician_operations.gatepass.link_so", "technician_operations", "technician-operations", "update", "ALL", "View/use Link SO action button to link an existing Sales Order to a gatepass."),
    ("technician_operations.gatepass.print", "technician_operations", "technician-operations", "view", "ALL", "View/use Print action button to print outward/return gatepass slips."),
    ("technician_operations.gatepass.details", "technician_operations", "technician-operations", "view", "ALL", "View/use Details action button to inspect full gatepass details."),
    ("technician_operations.wallets.view", "technician_operations", "technician-operations", "view", "ALL", "View the Technician Wallets & Field Collections tab and transaction ledger."),
    ("technician_operations.wallet.create", "technician_operations", "technician-operations", "create", "ALL", "Show Record Wallet Transaction header button and record any wallet transaction type."),
    ("technician_operations.wallet.balances.view", "technician_operations", "technician-operations", "view", "ALL", "View Technician Live Wallet Balances (Cash in Hand) cards section."),
    ("technician_operations.wallet.collect", "technician_operations", "technician-operations", "create", "ALL", "View/use + Collect action button on technician wallet cards to record field collections."),
    ("technician_operations.wallet.handover", "technician_operations", "technician-operations", "create", "ALL", "View/use Handover action button on technician wallet cards to record deposits to accounts."),
    ("technician_operations.wallet.expense", "technician_operations", "technician-operations", "create", "ALL", "View/use Expense action button on technician wallet cards to record field expenses."),
    ("technician_operations.warranty.view", "technician_operations", "technician-operations", "view", "ALL", "View the Machine Warranty Registry & Validator tab and warranty registry table."),
    ("technician_operations.warranty.create", "technician_operations", "technician-operations", "create", "ALL", "Show Register Machine Warranty button and create machine warranty policies."),
    ("technician_operations.warranty.validate", "technician_operations", "technician-operations", "view", "ALL", "View/use Live Machine Serial Warranty Validator widget and Verify Serial lookup."),
]

UPDATED_DESCRIPTIONS = {
    "technician_operations.view": "View Technician Gatepass & Wallet Management module, KPIs, and master lookups.",
    "technician_operations.create": "Legacy all-tabs create permission (gatepasses, wallet transactions, and machine warranties).",
    "technician_operations.update": "Legacy gatepass update permission (record spare parts returns and link Sales Orders).",
    "technician_operations.manage": "Full administrative control over Technician Gatepass, Wallet & Warranty Management, including all tabs, actions, wallet cards, and warranty validator.",
}

NEW_CODES = tuple(row[0] for row in NEW_PERMISSIONS)


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    now = datetime.now(timezone.utc)

    for code, desc in UPDATED_DESCRIPTIONS.items():
        bind.execute(
            sa.text(
                "UPDATE permissions SET description = :desc, updated_at = :updated_at WHERE code = :code"
            ),
            {"code": code, "desc": desc, "updated_at": now},
        )

    admin_role_ids: list[uuid.UUID] = []
    if insp.has_table("roles"):
        rows = bind.execute(
            sa.text(
                "SELECT id FROM roles WHERE LOWER(name) IN ('super_admin', 'admin') AND deleted_at IS NULL"
            )
        ).fetchall()
        admin_role_ids = [r[0] for r in rows]

    has_role_permissions = insp.has_table("role_permissions")

    for code, module, page, action, scope, desc in NEW_PERMISSIONS:
        perm_row = bind.execute(
            sa.text("SELECT id FROM permissions WHERE code = :code"),
            {"code": code},
        ).fetchone()

        if perm_row:
            perm_id = perm_row[0]
            bind.execute(
                sa.text(
                    "UPDATE permissions SET module = :module, page = :page, action = :action, "
                    "scope = :scope, description = :description, updated_at = :updated_at "
                    "WHERE id = :id"
                ),
                {
                    "id": perm_id,
                    "module": module,
                    "page": page,
                    "action": action,
                    "scope": scope,
                    "description": desc,
                    "updated_at": now,
                },
            )
        else:
            perm_id = uuid.uuid4()
            bind.execute(
                sa.text(
                    "INSERT INTO permissions (id, code, module, page, action, scope, description, created_at, updated_at) "
                    "VALUES (:id, :code, :module, :page, :action, :scope, :description, :created_at, :updated_at)"
                ),
                {
                    "id": perm_id,
                    "code": code,
                    "module": module,
                    "page": page,
                    "action": action,
                    "scope": scope,
                    "description": desc,
                    "created_at": now,
                    "updated_at": now,
                },
            )

        if has_role_permissions and admin_role_ids:
            for role_id in admin_role_ids:
                existing_rp = bind.execute(
                    sa.text(
                        "SELECT id FROM role_permissions WHERE role_id = :role_id AND permission_id = :perm_id"
                    ),
                    {"role_id": role_id, "perm_id": perm_id},
                ).fetchone()
                if not existing_rp:
                    bind.execute(
                        sa.text(
                            "INSERT INTO role_permissions (id, role_id, permission_id, granted_at) "
                            "VALUES (:id, :role_id, :perm_id, :granted_at)"
                        ),
                        {
                            "id": uuid.uuid4(),
                            "role_id": role_id,
                            "perm_id": perm_id,
                            "granted_at": now,
                        },
                    )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    placeholders = ", ".join(f":c{i}" for i in range(len(NEW_CODES)))
    params = {f"c{i}": code for i, code in enumerate(NEW_CODES)}

    for link_table in ("role_permissions", "user_permissions", "user_permission_overrides"):
        if insp.has_table(link_table):
            bind.execute(
                sa.text(
                    f"DELETE FROM {link_table} WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ({placeholders}))"
                ),
                params,
            )

    bind.execute(
        sa.text(f"DELETE FROM permissions WHERE code IN ({placeholders})"),
        params,
    )
