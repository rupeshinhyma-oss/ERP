"""phase5 platform authorization (platform_roles, platform_permissions, platform_role_permissions, platform_role_assignments)

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-07

Phase 5: adds the GlobalUser-based platform authorization layer
(PlatformRole / PlatformPermission / RolePermission /
PlatformRoleAssignment) on top of Phases 2-4. Purely additive -- does
not alter, rename, or drop any column on any table created by 0001,
0002, or 0003, and does NOT touch `platform_admins` (Phase 3's separate,
untouched PlatformAdmin table). No foreign key here ever points outside
ERP_Main's own database (mirrors Phase 3 Step 45 / Phase 4's own
migration note).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _guid():
    """Return a UUID column type: native Postgres UUID, or CHAR(36) elsewhere."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.UUID(as_uuid=True)
    return sa.CHAR(36)


def upgrade() -> None:
    """Create platform_roles, platform_permissions, platform_role_permissions, platform_role_assignments."""
    guid = _guid()

    op.create_table(
        "platform_roles",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("role_key", sa.String(length=50), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("role_key", name="uq_platform_roles_role_key"),
    )
    op.create_index("ix_platform_roles_role_key", "platform_roles", ["role_key"])

    op.create_table(
        "platform_permissions",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("permission_key", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("permission_key", name="uq_platform_permissions_permission_key"),
    )
    op.create_index("ix_platform_permissions_permission_key", "platform_permissions", ["permission_key"])

    op.create_table(
        "platform_role_permissions",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("role_id", guid, nullable=False),
        sa.Column("permission_id", guid, nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["platform_roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["permission_id"], ["platform_permissions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("role_id", "permission_id", name="uq_platform_role_permission"),
    )
    op.create_index("ix_platform_role_permissions_role_id", "platform_role_permissions", ["role_id"])
    op.create_index("ix_platform_role_permissions_permission_id", "platform_role_permissions", ["permission_id"])

    op.create_table(
        "platform_role_assignments",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("global_user_id", guid, nullable=False),
        sa.Column("role_id", guid, nullable=False),
        sa.Column(
            "scope",
            sa.Enum("GLOBAL", "ERP", name="platform_authz_scope", native_enum=False, length=10),
            nullable=False,
            server_default="GLOBAL",
        ),
        sa.Column("erp_instance_id", guid, nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("assigned_by", guid, nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", guid, nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["global_user_id"], ["global_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["platform_roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["erp_instance_id"], ["erp_instances.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "global_user_id", "role_id", "erp_instance_id", name="uq_platform_role_assignment_user_role_erp"
        ),
    )
    op.create_index("ix_platform_role_assignments_global_user_id", "platform_role_assignments", ["global_user_id"])
    op.create_index("ix_platform_role_assignments_role_id", "platform_role_assignments", ["role_id"])
    op.create_index(
        "ix_platform_role_assignments_erp_instance_id", "platform_role_assignments", ["erp_instance_id"]
    )
    op.create_index("ix_platform_role_assignments_is_active", "platform_role_assignments", ["is_active"])


def downgrade() -> None:
    """Drop every Phase 5 table, in FK-safe reverse order. Leaves all Phase 2/3/4 tables completely untouched."""
    op.drop_index("ix_platform_role_assignments_is_active", table_name="platform_role_assignments")
    op.drop_index("ix_platform_role_assignments_erp_instance_id", table_name="platform_role_assignments")
    op.drop_index("ix_platform_role_assignments_role_id", table_name="platform_role_assignments")
    op.drop_index("ix_platform_role_assignments_global_user_id", table_name="platform_role_assignments")
    op.drop_table("platform_role_assignments")

    op.drop_index("ix_platform_role_permissions_permission_id", table_name="platform_role_permissions")
    op.drop_index("ix_platform_role_permissions_role_id", table_name="platform_role_permissions")
    op.drop_table("platform_role_permissions")

    op.drop_index("ix_platform_permissions_permission_key", table_name="platform_permissions")
    op.drop_table("platform_permissions")

    op.drop_index("ix_platform_roles_role_key", table_name="platform_roles")
    op.drop_table("platform_roles")
