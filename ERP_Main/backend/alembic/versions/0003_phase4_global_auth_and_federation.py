"""phase4 global auth and federation (global_user_credentials, global_sessions, federation_signing_keys, federation_clients, federation_authorization_requests)

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-07

Phase 4: adds Global User authentication and the OIDC-flavored federation
layer on top of Phases 2-3. Purely additive -- does not alter, rename, or
drop any column on any table created by 0001 or 0002. No foreign key here
ever points outside ERP_Main's own database (mirrors Phase 3 Step 45).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _guid():
    """Return a UUID column type: native Postgres UUID, or CHAR(36) elsewhere."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.UUID(as_uuid=True)
    return sa.CHAR(36)


def upgrade() -> None:
    """Create global_user_credentials, global_sessions, federation_signing_keys, federation_clients, federation_authorization_requests."""
    guid = _guid()

    op.create_table(
        "global_user_credentials",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("global_user_id", guid, nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_login_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("mfa_totp_secret_encrypted", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["global_user_id"], ["global_users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("global_user_id", name="uq_global_user_credentials_user"),
    )
    op.create_index("ix_global_user_credentials_global_user_id", "global_user_credentials", ["global_user_id"])

    op.create_table(
        "global_sessions",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("global_user_id", guid, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["global_user_id"], ["global_users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_global_sessions_global_user_id", "global_sessions", ["global_user_id"])

    op.create_table(
        "federation_signing_keys",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("kid", sa.String(length=50), nullable=False),
        sa.Column(
            "status",
            sa.Enum("ACTIVE", "RETIRING", "RETIRED", name="signing_key_status", native_enum=False, length=20),
            nullable=False,
            server_default="ACTIVE",
        ),
        sa.Column("algorithm", sa.String(length=20), nullable=False, server_default="RS256"),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("kid", name="uq_federation_signing_keys_kid"),
    )
    op.create_index("ix_federation_signing_keys_kid", "federation_signing_keys", ["kid"])
    op.create_index("ix_federation_signing_keys_status", "federation_signing_keys", ["status"])

    op.create_table(
        "federation_clients",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("erp_instance_id", guid, nullable=False),
        sa.Column("client_id", sa.String(length=100), nullable=False),
        sa.Column("client_secret_hash", sa.String(length=255), nullable=False),
        sa.Column("redirect_uris", sa.JSON(), nullable=False),
        sa.Column("federation_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["erp_instance_id"], ["erp_instances.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("erp_instance_id", name="uq_federation_clients_erp_instance"),
        sa.UniqueConstraint("client_id", name="uq_federation_clients_client_id"),
    )
    op.create_index("ix_federation_clients_erp_instance_id", "federation_clients", ["erp_instance_id"])
    op.create_index("ix_federation_clients_client_id", "federation_clients", ["client_id"])

    op.create_table(
        "federation_authorization_requests",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("global_user_id", guid, nullable=False),
        sa.Column("federation_client_id", guid, nullable=False),
        sa.Column("authorization_code", sa.String(length=100), nullable=False),
        sa.Column("redirect_uri", sa.String(length=500), nullable=False),
        sa.Column("state", sa.String(length=255), nullable=False),
        sa.Column("nonce", sa.String(length=255), nullable=True),
        sa.Column("code_challenge", sa.String(length=255), nullable=True),
        sa.Column("code_challenge_method", sa.String(length=10), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("code_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["global_user_id"], ["global_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["federation_client_id"], ["federation_clients.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("authorization_code", name="uq_federation_auth_requests_code"),
    )
    op.create_index(
        "ix_federation_auth_requests_global_user_id", "federation_authorization_requests", ["global_user_id"]
    )
    op.create_index(
        "ix_federation_auth_requests_client_id", "federation_authorization_requests", ["federation_client_id"]
    )
    op.create_index("ix_federation_auth_requests_code", "federation_authorization_requests", ["authorization_code"])


def downgrade() -> None:
    """Drop every Phase 4 table, in FK-safe reverse order. Leaves all Phase 2/3 tables completely untouched."""
    op.drop_index("ix_federation_auth_requests_code", table_name="federation_authorization_requests")
    op.drop_index("ix_federation_auth_requests_client_id", table_name="federation_authorization_requests")
    op.drop_index("ix_federation_auth_requests_global_user_id", table_name="federation_authorization_requests")
    op.drop_table("federation_authorization_requests")

    op.drop_index("ix_federation_clients_client_id", table_name="federation_clients")
    op.drop_index("ix_federation_clients_erp_instance_id", table_name="federation_clients")
    op.drop_table("federation_clients")

    op.drop_index("ix_federation_signing_keys_status", table_name="federation_signing_keys")
    op.drop_index("ix_federation_signing_keys_kid", table_name="federation_signing_keys")
    op.drop_table("federation_signing_keys")

    op.drop_index("ix_global_sessions_global_user_id", table_name="global_sessions")
    op.drop_table("global_sessions")

    op.drop_index("ix_global_user_credentials_global_user_id", table_name="global_user_credentials")
    op.drop_table("global_user_credentials")