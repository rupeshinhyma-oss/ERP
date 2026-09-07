"""phase3 global identity (platform_admins, global_users, erp_memberships, erp_service_credentials, global_audit_logs)

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-07

Phase 3: adds the global-identity control-plane tables on top of the
Phase 2 ERP Registry. Purely additive -- does not alter, rename, or drop
any column on `erp_instances` or `erp_modules` (0001 is left completely
untouched, per the Phase 3 brief's Step 43). No foreign key here ever
points outside ERP_Main's own database (Phase 3 Step 45).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _guid():
    """Return a UUID column type: native Postgres UUID, or CHAR(36) elsewhere."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.UUID(as_uuid=True)
    return sa.CHAR(36)


def upgrade() -> None:
    """Create platform_admins, global_users, erp_memberships, erp_service_credentials, global_audit_logs."""
    guid = _guid()

    op.create_table(
        "platform_admins",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column(
            "role",
            sa.Enum("SUPER_ADMIN", "PLATFORM_ADMIN", name="platform_admin_role", native_enum=False, length=20),
            nullable=False,
            server_default="PLATFORM_ADMIN",
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("email", name="uq_platform_admins_email"),
    )
    op.create_index("ix_platform_admins_email", "platform_admins", ["email"])

    op.create_table(
        "global_users",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("primary_email", sa.String(length=255), nullable=False),
        sa.Column(
            "status",
            sa.Enum("ACTIVE", "SUSPENDED", "DISABLED", name="global_user_status", native_enum=False, length=20),
            nullable=False,
            server_default="ACTIVE",
        ),
        sa.Column("external_identity_id", sa.String(length=255), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("primary_email", name="uq_global_users_primary_email"),
    )
    op.create_index("ix_global_users_primary_email", "global_users", ["primary_email"])
    op.create_index("ix_global_users_status", "global_users", ["status"])
    op.create_index("ix_global_users_external_identity_id", "global_users", ["external_identity_id"])

    op.create_table(
        "erp_memberships",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("global_user_id", guid, nullable=False),
        sa.Column("erp_instance_id", guid, nullable=False),
        sa.Column("local_user_id", sa.String(length=255), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "PENDING", "ACTIVE", "SUSPENDED", "REVOKED", name="erp_membership_status", native_enum=False, length=20
            ),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["global_user_id"], ["global_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["erp_instance_id"], ["erp_instances.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("global_user_id", "erp_instance_id", name="uq_erp_memberships_user_erp"),
        sa.UniqueConstraint("erp_instance_id", "local_user_id", name="uq_erp_memberships_erp_local_user"),
    )
    op.create_index("ix_erp_memberships_global_user_id", "erp_memberships", ["global_user_id"])
    op.create_index("ix_erp_memberships_erp_instance_id", "erp_memberships", ["erp_instance_id"])
    op.create_index("ix_erp_memberships_status", "erp_memberships", ["status"])

    op.create_table(
        "erp_service_credentials",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("erp_instance_id", guid, nullable=False),
        sa.Column("credential_identifier", sa.String(length=50), nullable=False),
        sa.Column("secret_hash", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["erp_instance_id"], ["erp_instances.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("credential_identifier", name="uq_erp_service_credentials_identifier"),
    )
    op.create_index("ix_erp_service_credentials_erp_instance_id", "erp_service_credentials", ["erp_instance_id"])
    op.create_index("ix_erp_service_credentials_identifier", "erp_service_credentials", ["credential_identifier"])

    op.create_table(
        "global_audit_logs",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column(
            "event_type",
            sa.Enum(
                "ERP_REGISTERED", "ERP_UPDATED", "ERP_STATUS_CHANGED", "ERP_DECOMMISSIONED",
                "ERP_CREDENTIAL_CREATED", "ERP_CREDENTIAL_ROTATED", "ERP_CREDENTIAL_REVOKED",
                "GLOBAL_USER_CREATED", "GLOBAL_USER_UPDATED", "GLOBAL_USER_SUSPENDED",
                "MEMBERSHIP_CREATED", "MEMBERSHIP_VERIFIED", "MEMBERSHIP_SUSPENDED",
                "MEMBERSHIP_RESTORED", "MEMBERSHIP_REVOKED", "CAPABILITY_UPDATED",
                "PLATFORM_ADMIN_CREATED", "PLATFORM_ADMIN_LOGIN_SUCCEEDED", "PLATFORM_ADMIN_LOGIN_FAILED",
                "ERP_HEARTBEAT_RECEIVED",
                name="audit_event_type", native_enum=False, length=50,
            ),
            nullable=False,
        ),
        sa.Column(
            "actor_type",
            sa.Enum("HUMAN_ADMIN", "ERP_SERVICE", "SYSTEM", name="audit_actor_type", native_enum=False, length=20),
            nullable=False,
        ),
        sa.Column("actor_id", guid, nullable=True),
        sa.Column("actor_label", sa.String(length=200), nullable=True),
        sa.Column("target_type", sa.String(length=50), nullable=True),
        sa.Column("target_id", guid, nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_global_audit_logs_event_type", "global_audit_logs", ["event_type"])
    op.create_index("ix_global_audit_logs_actor_type", "global_audit_logs", ["actor_type"])
    op.create_index("ix_global_audit_logs_actor_id", "global_audit_logs", ["actor_id"])
    op.create_index("ix_global_audit_logs_target_type", "global_audit_logs", ["target_type"])
    op.create_index("ix_global_audit_logs_target_id", "global_audit_logs", ["target_id"])


def downgrade() -> None:
    """Drop every Phase 3 table, in FK-safe reverse order. Leaves 0001's tables completely untouched."""
    op.drop_index("ix_global_audit_logs_target_id", table_name="global_audit_logs")
    op.drop_index("ix_global_audit_logs_target_type", table_name="global_audit_logs")
    op.drop_index("ix_global_audit_logs_actor_id", table_name="global_audit_logs")
    op.drop_index("ix_global_audit_logs_actor_type", table_name="global_audit_logs")
    op.drop_index("ix_global_audit_logs_event_type", table_name="global_audit_logs")
    op.drop_table("global_audit_logs")

    op.drop_index("ix_erp_service_credentials_identifier", table_name="erp_service_credentials")
    op.drop_index("ix_erp_service_credentials_erp_instance_id", table_name="erp_service_credentials")
    op.drop_table("erp_service_credentials")

    op.drop_index("ix_erp_memberships_status", table_name="erp_memberships")
    op.drop_index("ix_erp_memberships_erp_instance_id", table_name="erp_memberships")
    op.drop_index("ix_erp_memberships_global_user_id", table_name="erp_memberships")
    op.drop_table("erp_memberships")

    op.drop_index("ix_global_users_external_identity_id", table_name="global_users")
    op.drop_index("ix_global_users_status", table_name="global_users")
    op.drop_index("ix_global_users_primary_email", table_name="global_users")
    op.drop_table("global_users")

    op.drop_index("ix_platform_admins_email", table_name="platform_admins")
    op.drop_table("platform_admins")
