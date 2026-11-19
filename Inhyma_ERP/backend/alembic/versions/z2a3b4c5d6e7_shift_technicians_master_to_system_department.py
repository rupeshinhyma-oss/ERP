"""shift technicians master to system department

Revision ID: z2a3b4c5d6e7
Revises: y1d2e3f4a5b6
Create Date: 2026-11-18 15:45:00.000000

Removes the standalone Technicians Master (``technicians`` table and
``technician.*`` Master permissions) and promotes ``technician`` to a
fixed ``SYSTEM`` department/role alongside ``super_admin`` (Admin) and
``user`` (User). Re-points ``technician_id`` foreign keys on
``technician_gatepasses`` and ``technician_wallet_transactions`` from
``technicians.id`` to ``users.id``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence, Union
import re
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "z2a3b4c5d6e7"
down_revision: Union[str, None] = "y1d2e3f4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MASTER_PERMISSIONS = [
    ("technician.view", "technician", "masters-technicians", "view", "ALL", "View technicians; use search, filters, and status tabs."),
    ("technician.create", "technician", "masters-technicians", "create", "ALL", "Create technicians."),
    ("technician.update", "technician", "masters-technicians", "update", "ALL", "Edit and activate/deactivate technicians."),
    ("technician.delete", "technician", "masters-technicians", "delete", "ALL", "Delete technicians."),
    ("technician.export", "technician", "masters-technicians", "export", "ALL", "Export technician data."),
    ("technician.import", "technician", "masters-technicians", "import", "ALL", "Import technician data."),
    ("technician.bulk_action", "technician", "masters-technicians", "manage", "ALL", "Use Bulk Actions in the technician list."),
]


def _normalize_phone(value: str | None) -> str:
    if not value:
        return ""
    digits = re.sub(r"\D+", "", value)
    return digits[-10:] if len(digits) >= 10 else digits


def _ensure_technician_system_role(bind: sa.Connection) -> uuid.UUID | None:
    insp = inspect(bind)
    if not insp.has_table("roles"):
        return None

    now = datetime.now(timezone.utc)
    existing = bind.execute(
        sa.text("SELECT id, name, is_system, deleted_at FROM roles WHERE lower(name) = 'technician' LIMIT 1")
    ).first()

    desc = (
        "Fixed system department for field service technicians. "
        "Users assigned to this department appear in Technical Tasks, "
        "Technician Gatepasses, and Technician Wallets."
    )

    if existing is not None:
        role_id = existing.id
        bind.execute(
            sa.text(
                "UPDATE roles SET name = 'technician', is_system = true, deleted_at = NULL, "
                "description = COALESCE(description, :desc), updated_at = :now WHERE id = :id"
            ),
            {"id": role_id, "desc": desc, "now": now},
        )
        return role_id

    role_id = uuid.uuid4()
    bind.execute(
        sa.text(
            "INSERT INTO roles (id, name, description, is_system, created_at, updated_at) "
            "VALUES (:id, 'technician', :desc, true, :now, :now)"
        ),
        {"id": role_id, "desc": desc, "now": now},
    )
    return role_id


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    now = datetime.now(timezone.utc)

    technician_role_id = _ensure_technician_system_role(bind)

    # 1. Build mapping from old technicians rows -> existing users (if tables exist)
    tech_to_user: dict[str, str] = {}
    if insp.has_table("technicians") and insp.has_table("users"):
        user_rows = bind.execute(
            sa.text(
                "SELECT id, phone, display_name, first_name, middle_name, last_name, username "
                "FROM users WHERE deleted_at IS NULL"
            )
        ).all()
        by_phone: dict[str, str] = {}
        by_name: dict[str, str] = {}
        for u in user_rows:
            uid = str(u.id)
            p = _normalize_phone(u.phone)
            if p and p not in by_phone:
                by_phone[p] = uid
            full = " ".join(part for part in (u.first_name, u.middle_name, u.last_name) if part).strip()
            for cand in (u.display_name, full, u.username):
                key = (cand or "").strip().lower()
                if key and key not in by_name:
                    by_name[key] = uid

        tech_rows = bind.execute(
            sa.text("SELECT id, name, mobile, deleted_at FROM technicians")
        ).all()
        for t in tech_rows:
            matched_uid = None
            norm_mob = _normalize_phone(t.mobile)
            if norm_mob and norm_mob in by_phone:
                matched_uid = by_phone[norm_mob]
            if matched_uid is None and t.name:
                matched_uid = by_name.get(t.name.strip().lower())
            if matched_uid:
                tech_to_user[str(t.id)] = matched_uid
                if t.deleted_at is None and technician_role_id is not None and insp.has_table("user_roles"):
                    exists_link = bind.execute(
                        sa.text(
                            "SELECT 1 FROM user_roles WHERE user_id = :uid AND role_id = :rid LIMIT 1"
                        ),
                        {"uid": matched_uid, "rid": technician_role_id},
                    ).first()
                    if exists_link is None:
                        bind.execute(
                            sa.text(
                                "INSERT INTO user_roles "
                                "(id, user_id, role_id, assigned_at, assignment_type, is_primary, status) "
                                "VALUES (:id, :uid, :rid, :now, 'PRIMARY', false, 'ACTIVE')"
                            ),
                            {
                                "id": str(uuid.uuid4()),
                                "uid": matched_uid,
                                "rid": technician_role_id,
                                "now": now,
                            },
                        )

    # 2. Drop old FKs referencing technicians, remap technician_id -> users.id, add new FKs
    for tbl in ("technician_gatepasses", "technician_wallet_transactions"):
        if not insp.has_table(tbl):
            continue
        for fk in insp.get_foreign_keys(tbl):
            if fk.get("referred_table") == "technicians" or "technician_id" in (fk.get("constrained_columns") or []):
                if fk.get("name"):
                    op.drop_constraint(fk["name"], tbl, type_="foreignkey")

        rows = bind.execute(
            sa.text(f"SELECT DISTINCT technician_id FROM {tbl} WHERE technician_id IS NOT NULL")
        ).all()
        for row in rows:
            old_tid = str(row.technician_id)
            new_uid = tech_to_user.get(old_tid)
            if new_uid:
                bind.execute(
                    sa.text(f"UPDATE {tbl} SET technician_id = :new_uid WHERE technician_id = :old_tid"),
                    {"new_uid": new_uid, "old_tid": row.technician_id},
                )
            elif insp.has_table("users"):
                valid_user = bind.execute(
                    sa.text("SELECT 1 FROM users WHERE id = :uid LIMIT 1"),
                    {"uid": row.technician_id},
                ).first()
                if valid_user is None:
                    bind.execute(
                        sa.text(f"UPDATE {tbl} SET technician_id = NULL WHERE technician_id = :old_tid"),
                        {"old_tid": row.technician_id},
                    )
            else:
                bind.execute(
                    sa.text(f"UPDATE {tbl} SET technician_id = NULL WHERE technician_id = :old_tid"),
                    {"old_tid": row.technician_id},
                )

        if insp.has_table("users"):
            op.create_foreign_key(
                f"fk_{tbl}_technician_id_users",
                tbl,
                "users",
                ["technician_id"],
                ["id"],
                ondelete="SET NULL",
            )

    # 3. Drop obsolete technicians table
    if insp.has_table("technicians"):
        op.drop_table("technicians")

    # 4. Remove obsolete technician.* Master permissions
    if insp.has_table("permissions"):
        if insp.has_table("user_permissions"):
            bind.execute(
                sa.text(
                    "DELETE FROM user_permissions WHERE permission_id IN ("
                    "  SELECT id FROM permissions WHERE code LIKE 'technician.%'"
                    ")"
                )
            )
        if insp.has_table("role_permissions"):
            bind.execute(
                sa.text(
                    "DELETE FROM role_permissions WHERE permission_id IN ("
                    "  SELECT id FROM permissions WHERE code LIKE 'technician.%'"
                    ")"
                )
            )
        bind.execute(sa.text("DELETE FROM permissions WHERE code LIKE 'technician.%'"))


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    now = datetime.now(timezone.utc)

    # 1. Restore technicians table
    if not insp.has_table("technicians"):
        op.create_table(
            "technicians",
            sa.Column("id", sa.UUID(), primary_key=True, nullable=False),
            sa.Column("name", sa.String(length=150), nullable=False),
            sa.Column("mobile", sa.String(length=50), nullable=True),
            sa.Column("city", sa.String(length=100), nullable=True),
            sa.Column("notes", sa.String(length=500), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_technicians_name", "technicians", ["name"])
        op.create_index("ix_technicians_status", "technicians", ["status"])

    # 2. Re-point gatepass & wallet FKs back to technicians (clearing user IDs)
    for tbl in ("technician_gatepasses", "technician_wallet_transactions"):
        if not insp.has_table(tbl):
            continue
        for fk in insp.get_foreign_keys(tbl):
            if "technician_id" in (fk.get("constrained_columns") or []):
                if fk.get("name"):
                    op.drop_constraint(fk["name"], tbl, type_="foreignkey")
        bind.execute(sa.text(f"UPDATE {tbl} SET technician_id = NULL"))
        op.create_foreign_key(
            f"{tbl}_technician_id_fkey",
            tbl,
            "technicians",
            ["technician_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # 3. Restore technician.* permissions
    if insp.has_table("permissions"):
        for code, module, page, action, scope, description in MASTER_PERMISSIONS:
            exists = bind.execute(
                sa.text("SELECT 1 FROM permissions WHERE code = :code LIMIT 1"),
                {"code": code},
            ).first()
            if exists is None:
                bind.execute(
                    sa.text(
                        "INSERT INTO permissions (id, code, module, page, action, scope, description, created_at, updated_at) "
                        "VALUES (:id, :code, :module, :page, :action, :scope, :desc, :now, :now)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "code": code,
                        "module": module,
                        "page": page,
                        "action": action,
                        "scope": scope,
                        "desc": description,
                        "now": now,
                    },
                )
